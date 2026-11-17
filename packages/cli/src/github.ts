/**
 * `steward check --github`: Steward Review inside a GitHub Actions run on a
 * pull request. Runs the diff-aware check, posts one comment per line with
 * findings (one-click suggestions where safe), and keeps one summary comment
 * up to date. In warn mode it never fails the check, whatever goes wrong.
 */
import { appendFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fingerprintOf, formatReview, lineComments, SUMMARY_MARKER, summaryComment, type LineComment } from "@steward/guard";
import { readStewardConfig, type ReviewMode } from "@steward/model";
import { runCheck } from "./check.js";
import { StewardError } from "./scan.js";

export type Env = Readonly<Record<string, string | undefined>>;
export type Fetch = typeof globalThis.fetch;

/** The pull request this run is for, read from the environment GitHub Actions sets. */
export interface PullRequestContext {
  apiUrl: string;
  /** `owner/name`. */
  repo: string;
  token: string;
  number: number;
  baseRef: string;
  headSha: string;
}

const PR_EVENTS = new Set(["pull_request", "pull_request_target"]);

/**
 * Reads the pull request from the Actions environment. Returns `null` when
 * the run isn't for a pull request (a push, say), so there's nothing to comment on.
 */
export async function readPullRequest(env: Env): Promise<PullRequestContext | null> {
  if (!env["GITHUB_ACTIONS"]) throw new StewardError("--github is for GitHub Actions: it reads the pull request from the environment Actions sets. Run `steward check` without it locally.");
  if (!PR_EVENTS.has(env["GITHUB_EVENT_NAME"] ?? "")) return null;
  const eventPath = env["GITHUB_EVENT_PATH"];
  const repo = env["GITHUB_REPOSITORY"];
  if (!eventPath || !repo) throw new StewardError("GitHub Actions didn't say which pull request this is (GITHUB_EVENT_PATH or GITHUB_REPOSITORY is missing).");
  const token = env["GITHUB_TOKEN"];
  if (!token) throw new StewardError("There's no GITHUB_TOKEN, so I can't comment on the pull request. Pass `github-token` to the action, or set GITHUB_TOKEN for this step.");
  const event = JSON.parse(await readFile(eventPath, "utf8")) as { pull_request?: { number?: number; base?: { ref?: string }; head?: { sha?: string } } };
  const pr = event.pull_request;
  if (!pr?.number || !pr.base?.ref || !pr.head?.sha) throw new StewardError("The pull_request event is missing its number, base branch or head commit.");
  return { apiUrl: env["GITHUB_API_URL"] ?? "https://api.github.com", repo, token, number: pr.number, baseRef: pr.base.ref, headSha: pr.head.sha };
}

// ---------------------------------------------------------------------------
// A small GitHub REST client (Node's fetch; no SDK)
// ---------------------------------------------------------------------------

export class GithubApiError extends Error {
  override name = "GithubApiError";
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

interface Comment {
  id: number;
  body?: string | null;
}

export function githubApi(pr: PullRequestContext, fetchImpl: Fetch = globalThis.fetch) {
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetchImpl(`${pr.apiUrl}/repos/${pr.repo}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${pr.token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "steward-review",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!res.ok) {
      let message = res.statusText;
      try {
        message = ((await res.json()) as { message?: string }).message ?? message;
      } catch {
        // not JSON; keep the status text
      }
      throw new GithubApiError(res.status, message);
    }
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  async function all<T>(path: string): Promise<T[]> {
    const out: T[] = [];
    for (let page = 1; ; page++) {
      const batch = await request<T[]>("GET", `${path}?per_page=100&page=${page}`);
      out.push(...batch);
      if (batch.length < 100) return out;
    }
  }

  return { request, all };
}

export type GithubApi = ReturnType<typeof githubApi>;

export interface PublishResult {
  posted: number;
  /** Comments already on the pull request from an earlier push, so not posted again. */
  alreadyThere: number;
  /** Comments GitHub wouldn't place on their line (it only allows lines in the diff); listed in the summary instead. */
  unposted: LineComment[];
  summary: "created" | "updated";
}

/**
 * Posts the line comments that aren't there yet as one review, then creates
 * or updates the one summary comment. Old comments are never deleted: people
 * may have replied to them.
 */
export async function publish(api: GithubApi, pr: PullRequestContext, comments: readonly LineComment[], summaryFor: (unposted: LineComment[]) => string): Promise<PublishResult> {
  const existing = new Set((await api.all<Comment>(`/pulls/${pr.number}/comments`)).map((c) => fingerprintOf(c.body ?? "")).filter((f) => f !== null));
  const fresh = comments.filter((c) => !existing.has(c.fingerprint));
  const unposted: LineComment[] = [];
  const asReviewComment = (c: LineComment) => ({ path: c.path, line: c.line, side: "RIGHT", body: c.body });

  if (fresh.length > 0) {
    try {
      await api.request("POST", `/pulls/${pr.number}/reviews`, { commit_id: pr.headSha, event: "COMMENT", comments: fresh.map(asReviewComment) });
    } catch (err) {
      // 422: GitHub refused a line (usually one outside the diff). Post one at a time to find which.
      if (!(err instanceof GithubApiError) || err.status !== 422) throw err;
      for (const c of fresh) {
        try {
          await api.request("POST", `/pulls/${pr.number}/comments`, { commit_id: pr.headSha, ...asReviewComment(c) });
        } catch (e) {
          if (!(e instanceof GithubApiError) || e.status !== 422) throw e;
          unposted.push(c);
        }
      }
    }
  }

  const body = summaryFor(unposted);
  const summary = (await api.all<Comment>(`/issues/${pr.number}/comments`)).find((c) => (c.body ?? "").includes(SUMMARY_MARKER));
  if (summary) await api.request("PATCH", `/issues/comments/${summary.id}`, { body });
  else await api.request("POST", `/issues/${pr.number}/comments`, { body });
  return { posted: fresh.length - unposted.length, alreadyThere: comments.length - fresh.length, unposted, summary: summary ? "updated" : "created" };
}

/** Pure: why posting failed, in words a person can act on. */
export function describePostingError(err: unknown): string {
  if (err instanceof GithubApiError) {
    if (err.status === 401 || err.status === 403) {
      return (
        `GitHub didn't let this workflow's token comment on the pull request (${err.status}: ${err.message}). ` +
        "Give the job `permissions: pull-requests: write`. Pull requests from forks only get a read-only token, so for those the findings are on the run's summary page instead."
      );
    }
    if (err.status === 404) return `GitHub couldn't find this pull request through the API (404: ${err.message}). Check the token can see this repo.`;
    return `GitHub's API answered ${err.status}: ${err.message}.`;
  }
  return `I couldn't reach GitHub's API: ${err instanceof Error ? err.message : String(err)}.`;
}

/** A GitHub Actions log command: shows as a warning on the run. */
export function annotation(level: "warning" | "notice", message: string): string {
  const data = message.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
  return `::${level} title=Steward Review::${data}\n`;
}

export interface GithubCheckIo {
  stdout: (text: string) => void;
  cwd: string;
  env: Env;
  fetch?: Fetch;
}

async function modeOf(root: string): Promise<ReviewMode> {
  try {
    return (await readStewardConfig(root)).mode;
  } catch {
    return "warn";
  }
}

/**
 * The whole `--github` run. Returns the exit code: in warn mode always 0,
 * even when GitHub refuses a comment or Steward can't run; in error mode 1
 * only when something is found (or Steward couldn't check at all).
 */
export async function runGithubCheck(target: string, io: GithubCheckIo, options: { base?: string } = {}): Promise<number> {
  const root = resolve(io.cwd, target);
  const mode = await modeOf(root);
  try {
    const pr = await readPullRequest(io.env);
    const base = options.base ?? (pr ? `origin/${pr.baseRef}` : undefined);
    const run = await runCheck(root, { shownAs: target, ...(base === undefined ? {} : { base }) });
    io.stdout(formatReview(run.result));
    if (!pr) {
      io.stdout(annotation("notice", "This run isn't for a pull request, so there's nothing to comment on. The report is above."));
      return run.result.failed ? 1 : 0;
    }

    const comments = lineComments(run.result, run.files, { pathPrefix: run.gitPrefix });
    const oneClick = comments.reduce((n, c) => n + c.oneClick, 0);
    let pageSummary: string;
    try {
      const result = await publish(githubApi(pr, io.fetch), pr, comments, (unposted) => summaryComment(run.result, { oneClick, unposted }));
      pageSummary = summaryComment(run.result, { oneClick, unposted: result.unposted });
      io.stdout(
        `\nPosted ${result.posted === 1 ? "1 line comment" : `${result.posted} line comments`} on pull request #${pr.number}` +
          (result.alreadyThere > 0 ? ` (${result.alreadyThere} already there from an earlier push)` : "") +
          `, and ${result.summary} the summary comment.\n`,
      );
      if (result.unposted.length > 0) {
        const n = result.unposted.length;
        io.stdout(annotation("warning", `${n === 1 ? "1 comment" : `${n} comments`} couldn't go on ${n === 1 ? "its line" : "their lines"}, so ${n === 1 ? "it's" : "they're"} in the summary comment.`));
      }
    } catch (err) {
      const problem = describePostingError(err);
      pageSummary = summaryComment(run.result, { oneClick, unposted: comments, postingProblem: problem });
      io.stdout(annotation("warning", problem));
    }
    const summaryFile = io.env["GITHUB_STEP_SUMMARY"];
    if (summaryFile) await appendFile(summaryFile, pageSummary.replace(`${SUMMARY_MARKER}\n`, ""));
    return run.result.failed ? 1 : 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    io.stdout(annotation("warning", `Steward Review couldn't run: ${message}`));
    if (mode === "warn") io.stdout("Mode: warn, so this doesn't fail the check.\n");
    return mode === "error" ? 1 : 0;
  }
}
