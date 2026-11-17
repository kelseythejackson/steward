/**
 * `steward check --github`: Steward Review inside a GitHub Actions run on a
 * pull request. Runs the diff-aware check, posts one comment per line with
 * findings (one-click suggestions where safe), and keeps one summary comment
 * up to date. In warn mode it never fails the check, whatever goes wrong.
 */
import { appendFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  acceptedSuggestions,
  componentUse,
  fingerprintOf,
  formatReview,
  historyRecord,
  lineComments,
  sourceType,
  SUMMARY_MARKER,
  summaryComment,
  type LineComment,
  type PostedComment,
} from "@steward/guard";
import { readStewardConfig, type ReviewMode, type SourceHints, type SourceType, type StewardConfig } from "@steward/model";
import { runCheck } from "./check.js";
import { writeHistory } from "./history.js";
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
  /** Where the code came from, from labels or a known AI bot account. The account itself isn't kept. */
  source: SourceType;
}

const PR_EVENTS = new Set(["pull_request", "pull_request_target"]);

/**
 * Reads the pull request from the Actions environment. Returns `null` when
 * the run isn't for a pull request (a push, say), so there's nothing to comment on.
 */
export async function readPullRequest(env: Env, hints: Partial<SourceHints> = {}): Promise<PullRequestContext | null> {
  if (!env["GITHUB_ACTIONS"]) throw new StewardError("--github is for GitHub Actions: it reads the pull request from the environment Actions sets. Run `steward check` without it locally.");
  if (!PR_EVENTS.has(env["GITHUB_EVENT_NAME"] ?? "")) return null;
  const eventPath = env["GITHUB_EVENT_PATH"];
  const repo = env["GITHUB_REPOSITORY"];
  if (!eventPath || !repo) throw new StewardError("GitHub Actions didn't say which pull request this is (GITHUB_EVENT_PATH or GITHUB_REPOSITORY is missing).");
  const token = env["GITHUB_TOKEN"];
  if (!token) throw new StewardError("There's no GITHUB_TOKEN, so I can't comment on the pull request. Pass `github-token` to the action, or set GITHUB_TOKEN for this step.");
  const event = JSON.parse(await readFile(eventPath, "utf8")) as {
    pull_request?: { number?: number; base?: { ref?: string }; head?: { sha?: string }; labels?: { name?: string }[]; user?: { login?: string } };
  };
  const pr = event.pull_request;
  if (!pr?.number || !pr.base?.ref || !pr.head?.sha) throw new StewardError("The pull_request event is missing its number, base branch or head commit.");
  // The author's account is only checked against known AI bots, then dropped: only the source type goes on.
  const labels = (pr.labels ?? []).map((l) => l.name ?? "").filter((n) => n !== "");
  const source = sourceType({ labels, ...(pr.user?.login ? { author: pr.user.login } : {}) }, hints);
  return { apiUrl: env["GITHUB_API_URL"] ?? "https://api.github.com", repo, token, number: pr.number, baseRef: pr.base.ref, headSha: pr.head.sha, source };
}

// ---------------------------------------------------------------------------
// A small GitHub REST client (Node's fetch; no SDK)
// ---------------------------------------------------------------------------

export class GithubApiError extends Error {
  override name = "GithubApiError";
  constructor(
    readonly status: number,
    message: string,
    /** GitHub's rate limit (429, or a 403 that says so): try again later, not a permissions problem. */
    readonly rateLimited = false,
  ) {
    super(message);
  }
}

interface Comment {
  id: number;
  body?: string | null;
  path?: string;
  line?: number | null;
  /** The line the comment was first made on, kept by GitHub after later pushes move or change it. */
  original_line?: number | null;
  user?: { type?: string } | null;
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
      const rateLimited = res.status === 429 || (res.status === 403 && (/rate limit/i.test(message) || res.headers.get("x-ratelimit-remaining") === "0"));
      throw new GithubApiError(res.status, message, rateLimited);
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
  /** Steward's line comments that were already on the pull request, for counting accepted suggestions. */
  earlier: PostedComment[];
  /** Why posting stopped partway (a rate limit, say), if it did. */
  problem?: string;
}

/**
 * Posts the line comments that aren't there yet as one review, then creates
 * or updates the one summary comment. Old comments are never deleted: people
 * may have replied to them.
 */
export async function publish(
  api: GithubApi,
  pr: PullRequestContext,
  comments: readonly LineComment[],
  summaryFor: (unposted: LineComment[], problem?: string) => string,
): Promise<PublishResult> {
  const posted = await api.all<Comment>(`/pulls/${pr.number}/comments`);
  const earlier: PostedComment[] = posted
    .filter((c) => fingerprintOf(c.body ?? "") !== null)
    .map((c) => ({ path: c.path ?? "", line: c.line ?? null, originalLine: c.original_line ?? null, body: c.body ?? "" }));
  const existing = new Set(earlier.map((c) => fingerprintOf(c.body)));
  const fresh = comments.filter((c) => !existing.has(c.fingerprint));
  const done = new Set<LineComment>();
  const unposted: LineComment[] = [];
  let problem: string | undefined;
  const asReviewComment = (c: LineComment) => ({ path: c.path, line: c.line, side: "RIGHT", body: c.body });

  if (fresh.length > 0) {
    try {
      await api.request("POST", `/pulls/${pr.number}/reviews`, { commit_id: pr.headSha, event: "COMMENT", comments: fresh.map(asReviewComment) });
      for (const c of fresh) done.add(c);
    } catch (err) {
      if (err instanceof GithubApiError && err.status === 422) {
        // GitHub refused a line (usually one outside the diff). Post one at a time to find which.
        for (const c of fresh) {
          try {
            await api.request("POST", `/pulls/${pr.number}/comments`, { commit_id: pr.headSha, ...asReviewComment(c) });
            done.add(c);
          } catch (e) {
            if (e instanceof GithubApiError && e.status === 422) {
              unposted.push(c);
              continue;
            }
            // Anything else (a rate limit, say) stops posting; what's left goes in the summary.
            problem = describePostingError(e, done.size);
            break;
          }
        }
      } else {
        problem = describePostingError(err, 0);
      }
    }
  }
  // Everything not posted, in the order it was found: refused lines and anything left after posting stopped.
  const left = fresh.filter((c) => !done.has(c));

  // Only a summary Steward wrote: the marker at the very start, preferring the bot's own comment.
  const candidates = (await api.all<Comment>(`/issues/${pr.number}/comments`)).filter((c) => (c.body ?? "").startsWith(SUMMARY_MARKER));
  const summary = candidates.find((c) => c.user?.type === "Bot") ?? candidates[0];
  const body = summaryFor(left, problem);
  if (summary) await api.request("PATCH", `/issues/comments/${summary.id}`, { body });
  else await api.request("POST", `/issues/${pr.number}/comments`, { body });
  const result: PublishResult = { posted: done.size, alreadyThere: comments.length - fresh.length, unposted: left, summary: summary ? "updated" : "created", earlier };
  if (problem) result.problem = problem;
  return result;
}

/** Pure: why posting failed, in words a person can act on. */
export function describePostingError(err: unknown, postedBefore = 0): string {
  if (err instanceof GithubApiError) {
    if (err.rateLimited) {
      return (
        `GitHub's rate limit for this token was reached${postedBefore > 0 ? ` after ${postedBefore === 1 ? "1 comment was" : `${postedBefore} comments were`} posted` : ""}. ` +
        "The rest are listed here, and the next push posts them."
      );
    }
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
export function annotation(level: "error" | "warning" | "notice", message: string): string {
  const data = message.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
  return `::${level} title=Steward Review::${data}\n`;
}

export interface GithubCheckIo {
  stdout: (text: string) => void;
  cwd: string;
  env: Env;
  fetch?: Fetch;
  now?: () => Date;
}

/** The config if it can be read; a broken one is reported by the check itself. */
async function configOf(root: string): Promise<StewardConfig | null> {
  try {
    return await readStewardConfig(root);
  } catch {
    return null;
  }
}

/**
 * The whole `--github` run. Returns the exit code: in warn mode always 0,
 * even when GitHub refuses a comment or Steward can't run; in error mode 1
 * when something is found, or when Steward couldn't check at all (no
 * system.json, base branch missing). API problems never fail it.
 */
export async function runGithubCheck(target: string, io: GithubCheckIo, options: { base?: string } = {}): Promise<number> {
  const root = resolve(io.cwd, target);
  const config = await configOf(root);
  const mode: ReviewMode = config?.mode ?? "warn";
  try {
    const pr = await readPullRequest(io.env, config?.source ?? {});
    const base = options.base ?? (pr ? `origin/${pr.baseRef}` : undefined);
    const run = await runCheck(root, { shownAs: target, ...(base === undefined ? {} : { base }) });
    io.stdout(formatReview(run.result));
    const record = (fixesAccepted: number | null) =>
      historyRecord(run.result, {
        date: (io.now?.() ?? new Date()).toISOString(),
        pr: pr?.number ?? null,
        source: pr?.source ?? "unknown",
        fixesAccepted,
        components: componentUse(run.files, run.model),
      });
    const history = { log: io.stdout, runnerTemp: io.env["RUNNER_TEMP"] };
    if (!pr) {
      io.stdout(annotation("notice", "This run isn't for a pull request, so there's nothing to comment on. The report is above."));
      await writeHistory(root, record(null), history);
      return run.result.failed ? 1 : 0;
    }

    const comments = lineComments(run.result, run.files, { pathPrefix: run.gitPrefix });
    const oneClick = comments.reduce((n, c) => n + c.oneClick, 0);
    const codeByPath = new Map(run.files.map((f) => [`${run.gitPrefix}${f.path}`, f.code]));
    let pageSummary: string;
    let fixesAccepted: number | null = null;
    try {
      const summaryOf = (unposted: LineComment[], problem?: string) => summaryComment(run.result, { oneClick, unposted, ...(problem ? { postingProblem: problem } : {}) });
      const result = await publish(githubApi(pr, io.fetch), pr, comments, summaryOf);
      fixesAccepted = acceptedSuggestions(result.earlier, (path) => codeByPath.get(path));
      pageSummary = summaryOf(result.unposted, result.problem);
      if (result.problem) io.stdout(annotation("warning", result.problem));
      io.stdout(
        `\nPosted ${result.posted === 1 ? "1 line comment" : `${result.posted} line comments`} on pull request #${pr.number}` +
          (result.alreadyThere > 0 ? ` (${result.alreadyThere} already there from an earlier push)` : "") +
          `, and ${result.summary} the summary comment.\n`,
      );
      if (result.unposted.length > 0 && !result.problem) {
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
    await writeHistory(root, record(fixesAccepted), history);
    return run.result.failed ? 1 : 0;
  } catch (err) {
    // Nothing was checked, so error mode can't call the change clean: it fails, and says why. Warn mode never fails.
    const message = err instanceof Error ? err.message : String(err);
    io.stdout(annotation(mode === "error" ? "error" : "warning", `Steward Review couldn't run: ${message}`));
    io.stdout(mode === "error" ? "Mode: error, so this fails the check until Steward can check the changes.\n" : "Mode: warn, so this doesn't fail the check.\n");
    return mode === "error" ? 1 : 0;
  }
}
