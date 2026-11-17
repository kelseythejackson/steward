import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadRepo, repoPath } from "./steward.ts";

const FIXTURE = fileURLToPath(new URL("../../../fixtures/messy-app", import.meta.url));
const RECORD = {
  v: 1,
  date: "2026-11-17T10:00:00.000Z",
  scope: "changes",
  pr: 7,
  source: "ai-agent",
  files: 1,
  changedLines: 2,
  problems: { "no-hardcoded-color": 1 },
  tokenSuggestions: 0,
  exceptions: 0,
  fixesAccepted: 0,
  components: { system: 1, total: 2, share: 0.5 },
};

describe("repoPath", () => {
  it("is null when STEWARD_REPO isn't set or is blank", () => {
    expect(repoPath({})).toBeNull();
    expect(repoPath({ STEWARD_REPO: "  " })).toBeNull();
  });

  it("takes a relative path from where the command was run (INIT_CWD)", () => {
    expect(repoPath({ STEWARD_REPO: "fixtures/messy-app", INIT_CWD: "/work/steward" })).toBe("/work/steward/fixtures/messy-app");
    expect(repoPath({ STEWARD_REPO: "/abs/app", INIT_CWD: "/work" })).toBe("/abs/app");
  });
});

describe("loadRepo", () => {
  let work: string;
  beforeEach(async () => {
    work = await mkdtemp(join(tmpdir(), "steward-web-"));
  });
  afterEach(async () => {
    await rm(work, { recursive: true, force: true });
  });

  it("explains each problem instead of throwing", async () => {
    expect(await loadRepo({})).toEqual({ kind: "not-set" });
    expect(await loadRepo({ STEWARD_REPO: join(work, "nope") })).toEqual({ kind: "missing", path: join(work, "nope") });
    expect(await loadRepo({ STEWARD_REPO: work })).toEqual({ kind: "no-system", path: work });
    await mkdir(join(work, ".steward"));
    await writeFile(join(work, ".steward/system.json"), "{ not json");
    const broken = await loadRepo({ STEWARD_REPO: work });
    expect(broken).toMatchObject({ kind: "broken", path: work });
    expect(broken.kind === "broken" && broken.message).toMatch(/isn't valid JSON/);
  });

  it("reads the system, history and whether design.md exists", async () => {
    const app = join(work, "app");
    await cp(FIXTURE, app, { recursive: true, filter: (src) => !src.includes("node_modules") && !src.endsWith("history.jsonl") && !src.endsWith("FIXTURE_NOTES.md") });
    await writeFile(join(app, ".steward/history.jsonl"), `${JSON.stringify(RECORD)}\n`);
    const repo = await loadRepo({ STEWARD_REPO: app });
    expect(repo.kind).toBe("ready");
    if (repo.kind !== "ready") return;
    expect(repo.model.components.length).toBeGreaterThan(0);
    expect(repo.history).toHaveLength(1);
    expect(repo.hasDesignMd).toBe(true);
    expect(repo.readOnly).toBe(false);
    expect(repo.historyProblem).toBeUndefined();
  });

  it("treats Steward's own fixture as read-only", async () => {
    const repo = await loadRepo({ STEWARD_REPO: FIXTURE });
    expect(repo.kind === "ready" && repo.readOnly).toBe(true);
  });

  it("keeps the readable history when a line can't be read, and says which", async () => {
    const app = join(work, "app");
    await cp(FIXTURE, app, { recursive: true, filter: (src) => !src.includes("node_modules") && !src.endsWith("history.jsonl") });
    await writeFile(join(app, ".steward/history.jsonl"), `{"author":"jane"}\n${JSON.stringify(RECORD)}\n`);
    const repo = await loadRepo({ STEWARD_REPO: app });
    expect(repo.kind === "ready" && repo.history).toHaveLength(1);
    expect(repo.kind === "ready" && repo.historyProblem).toBe(
      `1 line of .steward/history.jsonl couldn't be read, so it's left out (line 1 has a field history doesn't keep). The rest are counted.`,
    );
  });
});
