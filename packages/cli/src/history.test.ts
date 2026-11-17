/**
 * `steward check` (local) appends to .steward/history.jsonl, on a temp git
 * copy of the fixture. The --github cases are in github.test.ts.
 */
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "./main.js";

const FIXTURE = fileURLToPath(new URL("../../../fixtures/messy-app", import.meta.url));
const NOW = new Date("2026-11-17T10:00:00.000Z");

describe("steward check history (local)", () => {
  let work: string;
  let app: string;
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args], { cwd: app, encoding: "utf8" });
  async function steward(...argv: string[]) {
    let stdout = "";
    let stderr = "";
    const code = await main(argv, { stdout: (t) => (stdout += t), stderr: (t) => (stderr += t), cwd: work, now: () => NOW });
    return { code, stdout, stderr };
  }
  const lines = async () => (await readFile(join(app, ".steward/history.jsonl"), "utf8")).trim().split("\n");

  beforeEach(async () => {
    work = await mkdtemp(join(tmpdir(), "steward-history-"));
    app = join(work, "app");
    await cp(FIXTURE, app, { recursive: true, filter: (src) => !src.includes("node_modules") && !src.endsWith("history.jsonl") });
    git("init", "--quiet", "--initial-branch=main");
    git("add", ".");
    git("commit", "--quiet", "-m", "baseline");
    git("checkout", "--quiet", "-b", "feature");
    const settings = (await readFile(join(app, "src/pages/Settings.tsx"), "utf8")).split("\n");
    settings.splice(25, 0, '      <p className="mt-[13px] text-[#6b7280]">Saved.</p>', '      <button className="px-4">Reset</button>');
    await writeFile(join(app, "src/pages/Settings.tsx"), settings.join("\n"));
  });
  afterEach(async () => {
    await rm(work, { recursive: true, force: true });
  });

  it("appends one record per run, with no PR, an unknown source and no fixes count", async () => {
    expect((await steward("check", "app")).code).toBe(0);
    expect(JSON.parse((await lines())[0]!)).toEqual({
      v: 1,
      date: "2026-11-17T10:00:00.000Z",
      scope: "changes",
      pr: null,
      source: "unknown",
      files: 1,
      changedLines: 2,
      problems: {
        "a11y-accessible-name": 0,
        "a11y-focus-visible": 0,
        "a11y-img-alt": 0,
        "a11y-interactive-element": 0,
        "a11y-label-inputs": 0,
        "a11y-text-contrast": 0,
        "no-arbitrary-spacing": 1,
        "no-hardcoded-color": 1,
        "use-system-component": 1,
      },
      tokenSuggestions: 0,
      exceptions: 0,
      fixesAccepted: null,
      components: { system: 0, total: 1, share: 0 },
    });
  });

  it("only ever appends, with --json and --all too", async () => {
    await steward("check", "app");
    const first = await readFile(join(app, ".steward/history.jsonl"), "utf8");
    await steward("check", "app", "--json");
    await steward("check", "app", "--all");
    const all = await readFile(join(app, ".steward/history.jsonl"), "utf8");
    expect(all.startsWith(first)).toBe(true);
    expect((await lines()).map((l) => JSON.parse(l).scope)).toEqual(["changes", "changes", "all"]);
  });

  it("doesn't fail the check when history can't be written, and says so", async () => {
    await mkdir(join(app, ".steward/history.jsonl"));
    const r = await steward("check", "app");
    expect(r.code).toBe(0);
    expect(r.stderr).toMatch(/^Couldn't add this check to \.steward\/history\.jsonl \(.+\), so it isn't in the history\.\n$/);
  });
});
