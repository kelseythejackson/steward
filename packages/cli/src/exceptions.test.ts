/**
 * steward-ignore and repeated colors, end to end: `steward scan` records
 * exceptions in system.json, and `steward check` honors the comments and
 * suggests a repeated color as a token. On a temp git copy of the fixture.
 */
import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSystemModel } from "@steward/model";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CheckJson } from "./check.js";
import { main } from "./main.js";
import { runScan } from "./scan.js";

const FIXTURE = fileURLToPath(new URL("../../../fixtures/messy-app", import.meta.url));
const IGNORE = "      {/* steward-ignore use-system-component: marketing hero needs a custom button */}";
const BUTTON = '      <button className="hero-cta">Start your trial</button>';
const VIOLET = '      <span className="bg-[#7c3aed] text-white">New</span>';

describe("exceptions and repeated colors", () => {
  let work: string;
  let app: string;
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args], { cwd: app, encoding: "utf8" });

  async function addLines(path: string, after: number, ...lines: string[]) {
    const all = (await readFile(join(app, path), "utf8")).split("\n");
    all.splice(after, 0, ...lines);
    await writeFile(join(app, path), all.join("\n"));
  }
  async function removeLines(path: string, ...lines: string[]) {
    const all = (await readFile(join(app, path), "utf8")).split("\n");
    await writeFile(join(app, path), all.filter((l) => !lines.includes(l)).join("\n"));
  }
  async function steward(...argv: string[]) {
    let stdout = "";
    let stderr = "";
    const code = await main(argv, { stdout: (t) => (stdout += t), stderr: (t) => (stderr += t), cwd: work });
    return { code, stdout, stderr };
  }
  const json = async (...argv: string[]) => JSON.parse((await steward(...argv, "--json")).stdout) as CheckJson;

  beforeEach(async () => {
    work = await mkdtemp(join(tmpdir(), "steward-exceptions-"));
    app = join(work, "app");
    await cp(FIXTURE, app, { recursive: true, filter: (src) => !src.includes("node_modules") });
  });
  afterEach(async () => {
    await rm(work, { recursive: true, force: true });
  });

  describe("steward scan", () => {
    it("records each steward-ignore in system.json with its reason, and says so in the report", async () => {
      await addLines("src/pages/Settings.tsx", 25, IGNORE, BUTTON);
      const run = await runScan(app, { now: "2026-11-17T10:00:00.000Z" });
      const model = parseSystemModel(await readFile(join(app, ".steward/system.json"), "utf8"));
      expect(model.exceptions).toEqual([
        { rule: "use-system-component", file: "src/pages/Settings.tsx", found: '<button className="hero-cta">', reason: "marketing hero needs a custom button", firstSeen: "2026-11-17" },
      ]);
      expect(run.output.summary.exceptions).toBe(1);
      const r = await steward("scan", "app"); // relative to the CLI's working folder, not where Node started
      expect(r.stderr).toBe("");
      expect(r.stdout).toContain("\nExceptions: 1 flag marked intentional in the code, each with a reason (recorded in system.json)\n");
    });

    it("keeps the day an exception was first seen, and drops it once the comment is gone", async () => {
      await addLines("src/pages/Settings.tsx", 25, IGNORE, BUTTON);
      await runScan(app, { now: "2026-11-17T10:00:00.000Z" });
      await runScan(app, { now: "2026-12-01T10:00:00.000Z" });
      const read = async () => parseSystemModel(await readFile(join(app, ".steward/system.json"), "utf8")).exceptions;
      expect((await read()).map((e) => e.firstSeen)).toEqual(["2026-11-17"]);

      await removeLines("src/pages/Settings.tsx", IGNORE);
      await runScan(app, { now: "2026-12-02T10:00:00.000Z" });
      expect(await read()).toEqual([]);
    });

    it("doesn't record an ignore with no reason", async () => {
      await addLines("src/pages/Settings.tsx", 25, "      {/* steward-ignore use-system-component */}", BUTTON);
      const run = await runScan(app, { now: "2026-11-17T10:00:00.000Z" });
      expect(run.output.model.exceptions).toEqual([]);
      expect(run.output.summary.exceptions).toBeUndefined();
    });
  });

  describe("steward check", () => {
    beforeEach(() => {
      git("init", "--quiet", "--initial-branch=main");
      git("add", ".");
      git("commit", "--quiet", "-m", "baseline");
      git("checkout", "--quiet", "-b", "feature");
    });

    it("honors a steward-ignore right away, before any scan, and lists it as intentional", async () => {
      await addLines("src/pages/Settings.tsx", 25, IGNORE, BUTTON);
      const r = await json("check", "app");
      expect(r.findings).toEqual([]);
      expect(r.exceptions.map((e) => `${e.finding.file}:${e.finding.line} ${e.finding.rule} (${e.reason})`)).toEqual([
        "src/pages/Settings.tsx:27 use-system-component (marketing hero needs a custom button)",
      ]);
      expect(r.summary).toMatchObject({ findings: 0, exceptions: 1, notes: 0 });
      expect((await steward("check", "app")).stdout).toContain("Marked intentional with steward-ignore (1 flag):\n  src/pages/Settings.tsx:27  use-system-component: marketing hero needs a custom button\n");
    });

    it("keeps flagging when the reason is missing, and says why", async () => {
      await addLines("src/pages/Settings.tsx", 25, "      {/* steward-ignore use-system-component */}", BUTTON);
      const r = await json("check", "app");
      expect(r.findings.map((f) => f.rule)).toEqual(["use-system-component"]);
      expect(r.notes.map((n) => `${n.file}:${n.line}`)).toEqual(["src/pages/Settings.tsx:26"]);
    });

    it("an exception doesn't fail error mode", async () => {
      await writeFile(join(app, ".steward/config.json"), '{ "mode": "error" }');
      await addLines("src/pages/Settings.tsx", 25, IGNORE, BUTTON);
      expect((await steward("check", "app")).code).toBe(0);
    });

    it("counts a color across the whole repo: the third use is suggested as a token, even if only it changed", async () => {
      await addLines("src/pages/Billing.tsx", 20, VIOLET, VIOLET);
      git("checkout", "--quiet", "main");
      git("commit", "--quiet", "-am", "two violet badges on main");
      git("checkout", "--quiet", "feature");
      git("rebase", "--quiet", "main");

      await addLines("src/pages/Settings.tsx", 25, VIOLET);
      const r = await json("check", "app");
      expect(r.files).toEqual(["src/pages/Settings.tsx"]);
      expect(r.findings.filter((f) => f.rule === "no-hardcoded-color")).toEqual([]);
      expect(r.tokenSuggestions.map((f) => `${f.file}:${f.line} ${f.pattern?.value} ${f.pattern?.uses}`)).toEqual(["src/pages/Settings.tsx:26 #7c3aed 3"]);
      expect((await steward("check", "app")).stdout).toContain("Could join your system: 1 color used in 3 or more places, so it's suggested as a token instead of flagged:");
    });

    it("with two uses, it's still a flag", async () => {
      await addLines("src/pages/Settings.tsx", 25, VIOLET, VIOLET);
      const r = await json("check", "app");
      expect(r.tokenSuggestions).toEqual([]);
      expect(r.findings.filter((f) => f.rule === "no-hardcoded-color")).toHaveLength(2);
    });
  });
});
