import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";
import { serializeHistoryRecord, type HistoryRecord } from "@steward/model";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { githubRepoOf, unzip } from "./history-import.js";
import { main } from "./main.js";

// No test here may reach the real network (or the real GitHub login): every request goes through a fake.
const realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (async (input: string | URL | Request) => {
    throw new Error(`A test tried to reach the real network: ${String(input)}`);
  }) as typeof globalThis.fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

const FIXTURE = fileURLToPath(new URL("../../../fixtures/messy-app", import.meta.url));

/** A minimal zip writer (stored or deflated entries), so the tests use real archives like GitHub's. */
function zip(files: Record<string, string>, method: 0 | 8 = 8): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text);
    const data = method === 8 ? deflateRawSync(raw) : raw;
    const n = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, n, data);
    centrals.push(central, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const record = (pr: number, date: string): HistoryRecord => ({
  v: 1,
  date,
  scope: "changes",
  pr,
  source: "ai-agent",
  files: 1,
  changedLines: 3,
  problems: { "no-hardcoded-color": 1 },
  tokenSuggestions: 0,
  exceptions: 0,
  fixesAccepted: 0,
  components: { system: 1, total: 2, share: 0.5 },
});
const line = (r: HistoryRecord) => `${serializeHistoryRecord(r)}\n`;

/** GitHub's artifacts API, in memory: two pages, one expired artifact, and the zips. */
function fakeGithub(artifacts: { name: string; expired?: boolean; files?: Record<string, string>; method?: 0 | 8 }[], status = 200) {
  const calls: string[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(url.pathname + url.search);
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer t0ken");
    if (status !== 200) return new Response("{}", { status });
    if (url.pathname === "/repos/acme/app/actions/artifacts") {
      const page = Number(url.searchParams.get("page"));
      const all = artifacts.map((a, i) => ({ name: a.name, expired: a.expired ?? false, archive_download_url: `https://api.github.test/download/${i}` }));
      // Page 1 holds 100 unrelated artifacts, so paging is exercised; page 2 holds ours.
      const body = page === 1 ? Array.from({ length: 100 }, (_, i) => ({ name: `build-${i}`, expired: false, archive_download_url: "x" })) : page === 2 ? all : [];
      return new Response(JSON.stringify({ artifacts: body }), { status: 200 });
    }
    const m = /^\/download\/(\d+)$/.exec(url.pathname);
    if (m) {
      const a = artifacts[Number(m[1])]!;
      return new Response(new Uint8Array(zip(a.files ?? {}, a.method ?? 8)), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

describe("unzip", () => {
  it("reads stored and deflated entries", () => {
    expect(unzip(zip({ "record.jsonl": "hello\n" }, 0)).get("record.jsonl")!.toString()).toBe("hello\n");
    expect(unzip(zip({ "a.txt": "x".repeat(500), "record.jsonl": "deflated\n" }, 8)).get("record.jsonl")!.toString()).toBe("deflated\n");
  });

  it("refuses something that isn't a zip", () => {
    expect(() => unzip(Buffer.from("not a zip at all, just some text that is long enough"))).toThrow(/not a zip archive/);
  });
});

describe("githubRepoOf", () => {
  it.each([
    ["https://github.com/acme/app.git", "acme/app"],
    ["git@github.com:acme/app.git", "acme/app"],
    ["https://github.com/acme/app", "acme/app"],
    ["https://gitlab.com/acme/app.git", null],
  ])("%s → %s", (remote, repo) => {
    expect(githubRepoOf(remote)).toBe(repo);
  });
});

describe("steward history import", () => {
  let work: string;
  let app: string;
  beforeEach(async () => {
    work = await mkdtemp(join(tmpdir(), "steward-import-"));
    app = join(work, "app");
    await cp(FIXTURE, app, { recursive: true, filter: (s) => !s.includes("node_modules") && !s.endsWith("history.jsonl") });
    execFileSync("git", ["init", "-q"], { cwd: app });
    execFileSync("git", ["remote", "add", "origin", "https://github.com/acme/app.git"], { cwd: app });
  });
  afterEach(async () => {
    await rm(work, { recursive: true, force: true });
  });

  async function steward(gh: ReturnType<typeof fakeGithub>, ...args: string[]) {
    let stdout = "";
    let stderr = "";
    const code = await main(["history", "import", "app", ...args], { stdout: (t) => (stdout += t), stderr: (t) => (stderr += t), cwd: work, env: { GITHUB_TOKEN: "t0ken", GITHUB_API_URL: "https://api.github.test" }, fetch: gh.fetch });
    return { code, stdout, stderr };
  }
  const history = async () => readFile(join(app, ".steward/history.jsonl"), "utf8");

  it("imports each artifact's records, from the repo's origin remote, and says what it did", async () => {
    const gh = fakeGithub([
      { name: "steward-history-3-1", files: { "record.jsonl": line(record(9, "2026-11-12T10:00:00.000Z")) } },
      { name: "steward-history-2-1", files: { "record.jsonl": line(record(8, "2026-11-11T10:00:00.000Z")) }, method: 0 },
      { name: "steward-history-1-1", expired: true },
      { name: "other-artifact" },
    ]);
    const r = await steward(gh);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(
      "Imported 2 records from 2 artifacts in acme/app into app/.steward/history.jsonl.\n1 artifact had expired on GitHub (they're kept 90 days).\n",
    );
    expect(await history()).toBe(line(record(8, "2026-11-11T10:00:00.000Z")) + line(record(9, "2026-11-12T10:00:00.000Z")));
    expect(gh.calls.filter((c) => c.startsWith("/download/"))).toEqual(["/download/1", "/download/0"]);
  });

  it("adds nothing the second time", async () => {
    const gh = fakeGithub([{ name: "steward-history-2-1", files: { "record.jsonl": line(record(8, "2026-11-11T10:00:00.000Z")) } }]);
    await steward(gh);
    const r = await steward(gh);
    expect(r.stdout).toBe("Imported 0 records from 1 artifact in acme/app into app/.steward/history.jsonl.\n1 record was already there, so it wasn't added again.\n");
    expect((await history()).trim().split("\n")).toHaveLength(1);
  });

  it("refuses records that aren't valid history, such as one carrying an author", async () => {
    const withAuthor = JSON.stringify({ ...record(8, "2026-11-11T10:00:00.000Z"), author: "jane-doe" });
    const gh = fakeGithub([{ name: "steward-history-2-1", files: { "record.jsonl": `${withAuthor}\n{ broken\n` } }]);
    const r = await steward(gh);
    expect(r.stdout).toMatch(/Imported 0 records[\s\S]*2 lines weren't valid history records, so they weren't imported\./);
    await expect(history()).rejects.toThrow();
  });

  it("explains a missing login, a repo it can't tell, and a refusal from GitHub", async () => {
    let stderr = "";
    const noToken = await main(["history", "import", "app"], { stdout: () => {}, stderr: (t) => (stderr += t), cwd: work, env: { PATH: "/nonexistent" } });
    expect(noToken).toBe(1);
    expect(stderr).toMatch(/needs your GitHub login/);
    execFileSync("git", ["remote", "set-url", "origin", "https://gitlab.com/acme/app.git"], { cwd: app });
    expect((await steward(fakeGithub([]))).stderr).toMatch(/I couldn't tell which GitHub repo app is: its origin remote isn't on GitHub\. Name it with --repo owner\/name\./);
    expect((await steward(fakeGithub([], 403), "--repo", "acme/app")).stderr).toMatch(/GitHub didn't let Steward read acme\/app's artifacts \(403\)/);
  });
});
