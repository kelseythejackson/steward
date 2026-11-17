/**
 * `steward check --github` against a fake GitHub API, on a real git repo:
 * the fixture in a subfolder (`app/`), committed on main, with
 * `origin/main` pointing at it, then a pull request branch that adds lines.
 */
import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { annotation, describePostingError, GithubApiError } from "./github.js";
import { main } from "./main.js";

const FIXTURE = fileURLToPath(new URL("../../../fixtures/messy-app", import.meta.url));

interface Comment {
  id: number;
  body: string;
  path?: string;
  line?: number;
}

/** Just enough of GitHub's REST API, in memory. */
function fakeGithub(options: { failReview?: number; rejectLines?: number[] } = {}) {
  const reviewComments: Comment[] = [];
  const issueComments: Comment[] = [];
  const calls: { method: string; path: string; body?: Record<string, unknown> }[] = [];
  let nextId = 1;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const path = url.pathname.replace("/repos/acme/app", "");
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    calls.push({ method, path, ...(body ? { body } : {}) });
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer t0ken");
    const page = Number(url.searchParams.get("page") ?? "1");

    if (method === "GET" && path === "/pulls/7/comments") return json(page === 1 ? reviewComments : []);
    if (method === "GET" && path === "/issues/7/comments") return json(page === 1 ? issueComments : []);
    if (method === "POST" && path === "/pulls/7/reviews") {
      if (options.failReview) return json({ message: "Resource not accessible by integration" }, options.failReview);
      const comments = body!["comments"] as { path: string; line: number; body: string }[];
      if (comments.some((c) => options.rejectLines?.includes(c.line))) return json({ message: "Unprocessable Entity" }, 422);
      for (const c of comments) reviewComments.push({ id: nextId++, ...c });
      return json({ id: nextId++ });
    }
    if (method === "POST" && path === "/pulls/7/comments") {
      const c = body as unknown as { path: string; line: number; body: string };
      if (options.rejectLines?.includes(c.line)) return json({ message: "line must be part of the diff" }, 422);
      reviewComments.push({ id: nextId++, ...c });
      return json({ id: nextId - 1 }, 201);
    }
    if (method === "POST" && path === "/issues/7/comments") {
      issueComments.push({ id: nextId++, body: body!["body"] as string });
      return json({ id: nextId - 1 }, 201);
    }
    const patch = /^\/issues\/comments\/(\d+)$/.exec(path);
    if (method === "PATCH" && patch) {
      issueComments.find((c) => c.id === Number(patch[1]))!.body = body!["body"] as string;
      return json({});
    }
    return json({ message: `fake GitHub doesn't know ${method} ${path}` }, 404);
  }) as typeof globalThis.fetch;

  return { fetch, reviewComments, issueComments, calls };
}

describe("steward check --github", () => {
  let work: string;
  let repo: string;
  let env: Record<string, string>;
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args], { cwd: repo, encoding: "utf8" }).trim();

  async function addLine(path: string, after: number, line: string) {
    const lines = (await readFile(join(repo, "app", path), "utf8")).split("\n");
    lines.splice(after, 0, line);
    await writeFile(join(repo, "app", path), lines.join("\n"));
  }

  async function steward(gh: ReturnType<typeof fakeGithub>, extra: string[] = []) {
    let stdout = "";
    let stderr = "";
    const code = await main(["check", "app", "--github", ...extra], { stdout: (t) => (stdout += t), stderr: (t) => (stderr += t), cwd: repo, env, fetch: gh.fetch });
    return { code, stdout, stderr };
  }

  beforeEach(async () => {
    work = await mkdtemp(join(tmpdir(), "steward-github-"));
    repo = join(work, "repo");
    await cp(FIXTURE, join(repo, "app"), { recursive: true, filter: (src) => !src.includes("node_modules") });
    git("init", "--quiet", "--initial-branch=main");
    git("add", ".");
    git("commit", "--quiet", "-m", "baseline");
    git("update-ref", "refs/remotes/origin/main", "main");
    git("checkout", "--quiet", "-b", "feature");
    await addLine("src/pages/Settings.tsx", 25, '      <p className="mt-[13px] text-[#6b7280]">Saved for everyone.</p>');
    await addLine("src/pages/Settings.tsx", 26, '      <img src="/team.png" />');
    git("commit", "--quiet", "-am", "add lines");

    const event = join(work, "event.json");
    await writeFile(event, JSON.stringify({ pull_request: { number: 7, base: { ref: "main" }, head: { sha: git("rev-parse", "HEAD") } } }));
    env = {
      GITHUB_ACTIONS: "true",
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_EVENT_PATH: event,
      GITHUB_REPOSITORY: "acme/app",
      GITHUB_TOKEN: "t0ken",
      GITHUB_API_URL: "https://api.github.test",
      GITHUB_STEP_SUMMARY: join(work, "step-summary.md"),
    };
    await writeFile(env["GITHUB_STEP_SUMMARY"]!, "");
  });
  afterEach(async () => {
    await rm(work, { recursive: true, force: true });
  });

  it("posts one review with a comment on each changed line, and one summary comment", async () => {
    const gh = fakeGithub();
    const r = await steward(gh);
    expect(r.code).toBe(0);
    const review = gh.calls.find((c) => c.path === "/pulls/7/reviews")!;
    expect(review.body).toMatchObject({ commit_id: git("rev-parse", "HEAD"), event: "COMMENT" });
    const comments = review.body!["comments"] as { path: string; line: number; side: string; body: string }[];
    expect(comments.map((c) => `${c.path}:${c.line} ${c.side}`)).toEqual(["app/src/pages/Settings.tsx:26 RIGHT", "app/src/pages/Settings.tsx:27 RIGHT"]);
    expect(comments[0]!.body).toContain('```suggestion\n      <p className="mt-3 text-gray-500">Saved for everyone.</p>\n```');
    expect(comments[1]!.body).toMatch(/^This image has no alt text/);

    expect(gh.issueComments).toHaveLength(1);
    expect(gh.issueComments[0]!.body).toContain("### Steward Review found 2 off-system values and 1 accessibility issue · 2 can be fixed in one click");
    expect(r.stdout).toContain("Posted 2 line comments on pull request #7, and created the summary comment.");
    expect(await readFile(env["GITHUB_STEP_SUMMARY"]!, "utf8")).toMatch(/^### Steward Review found 2 off-system values/);
  });

  it("on a new push, doesn't repeat comments that are already there, and updates the summary instead of adding one", async () => {
    const gh = fakeGithub();
    await steward(gh);
    await addLine("src/pages/Settings.tsx", 27, '      <span className="p-[7px]">New</span>');
    git("commit", "--quiet", "-am", "another line");
    await writeFile(env["GITHUB_EVENT_PATH"]!, JSON.stringify({ pull_request: { number: 7, base: { ref: "main" }, head: { sha: git("rev-parse", "HEAD") } } }));

    const r = await steward(gh);
    expect(r.code).toBe(0);
    const reviews = gh.calls.filter((c) => c.path === "/pulls/7/reviews");
    expect(reviews).toHaveLength(2);
    expect((reviews[1]!.body!["comments"] as { line: number }[]).map((c) => c.line)).toEqual([28]);
    expect(gh.reviewComments).toHaveLength(3);
    expect(gh.issueComments).toHaveLength(1);
    expect(gh.issueComments[0]!.body).toContain("found 3 off-system values and 1 accessibility issue · 3 can be fixed in one click");
    expect(r.stdout).toContain("Posted 1 line comment on pull request #7 (2 already there from an earlier push), and updated the summary comment.");
  });

  it("with nothing new to say, posts no review and still updates the summary", async () => {
    const gh = fakeGithub();
    await steward(gh);
    await steward(gh);
    expect(gh.calls.filter((c) => c.path === "/pulls/7/reviews")).toHaveLength(1);
    expect(gh.calls.filter((c) => c.method === "PATCH")).toHaveLength(1);
  });

  it("in warn mode, a token that can't comment (like on a fork) doesn't fail the check; the findings go to the run summary", async () => {
    const gh = fakeGithub({ failReview: 403 });
    const r = await steward(gh);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("::warning title=Steward Review::GitHub didn't let this workflow's token comment on the pull request (403");
    const page = await readFile(env["GITHUB_STEP_SUMMARY"]!, "utf8");
    expect(page).toContain("2 comments couldn't be posted on their lines");
    expect(page).toContain("```suggestion");
    expect(gh.issueComments).toHaveLength(0);
  });

  it("in error mode, fails when something is found, but never because of the API", async () => {
    // config.json isn't committed, and doesn't need to be: check reads the working tree.
    await writeFile(join(repo, "app/.steward/config.json"), '{ "mode": "error" }');
    expect((await steward(fakeGithub({ failReview: 403 }))).code).toBe(1);

    git("reset", "--quiet", "--hard", "main");
    const clean = await steward(fakeGithub({ failReview: 500 }));
    expect(clean.code).toBe(0);
    expect(clean.stdout).toContain("No TSX or JSX files changed since origin/main");
  });

  it("when GitHub refuses a line, posts the rest one by one and lists the refused one in the summary", async () => {
    const gh = fakeGithub({ rejectLines: [27] });
    const r = await steward(gh);
    expect(r.code).toBe(0);
    expect(gh.reviewComments.map((c) => c.line)).toEqual([26]);
    expect(gh.issueComments[0]!.body).toContain("<details><summary>1 comment couldn't be posted on its line</summary>");
    expect(gh.issueComments[0]!.body).toContain("**app/src/pages/Settings.tsx:27**");
    expect(r.stdout).toContain("::warning title=Steward Review::1 comment couldn't go on its line, so it's in the summary comment.");
  });

  it("on a push (not a pull request), prints the report and comments on nothing", async () => {
    env["GITHUB_EVENT_NAME"] = "push";
    const gh = fakeGithub();
    const r = await steward(gh, ["--base", "main"]);
    expect(r.code).toBe(0);
    expect(gh.calls).toEqual([]);
    expect(r.stdout).toContain("Checked 2 changed lines in 1 file, compared with main.");
    expect(r.stdout).toContain("::notice title=Steward Review::This run isn't for a pull request");
  });

  it("in warn mode, doesn't fail the check even when Steward can't run at all", async () => {
    await rm(join(repo, "app/.steward/system.json"));
    const r = await steward(fakeGithub());
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("::warning title=Steward Review::Steward Review couldn't run: There's no Steward system in app yet.");
  });

  it("refuses --github with --all or --json", async () => {
    const r = await main(["check", "--github", "--json"], { stdout: () => {}, stderr: () => {}, cwd: repo, env });
    expect(r).toBe(1);
  });
});

describe("helpers", () => {
  it("escapes annotation text so it stays on one line", () => {
    expect(annotation("warning", "50% done\nnext")).toBe("::warning title=Steward Review::50%25 done%0Anext\n");
  });

  it("explains API errors in words a person can act on", () => {
    expect(describePostingError(new GithubApiError(403, "nope"))).toMatch(/permissions: pull-requests: write/);
    expect(describePostingError(new GithubApiError(404, "Not Found"))).toMatch(/^GitHub couldn't find this pull request/);
    expect(describePostingError(new TypeError("fetch failed"))).toBe("I couldn't reach GitHub's API: fetch failed.");
  });
});
