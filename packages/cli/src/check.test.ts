/**
 * `steward check` on a real git repo: a temp copy of fixtures/messy-app
 * (with its system.json) committed on main, then changed on a branch.
 */
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isReviewable, type CheckJson } from "./check.js";
import { main } from "./main.js";

const FIXTURE = fileURLToPath(new URL("../../../fixtures/messy-app", import.meta.url));

async function steward(argv: string[], cwd: string) {
  let stdout = "";
  let stderr = "";
  const code = await main(argv, { stdout: (t) => (stdout += t), stderr: (t) => (stderr += t), cwd });
  return { code, stdout, stderr };
}

const BAD_LINE = '      <p className="text-[#ff0000] p-[13px]">New line</p>';

describe("steward check", () => {
  let work: string;
  let app: string;
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args], { cwd: app, encoding: "utf8" });

  /** Puts a new line after line `after` of a fixture file. */
  async function addLine(path: string, after: number, line: string) {
    const lines = (await readFile(join(app, path), "utf8")).split("\n");
    lines.splice(after, 0, line);
    await writeFile(join(app, path), lines.join("\n"));
  }

  beforeEach(async () => {
    work = await mkdtemp(join(tmpdir(), "steward-check-"));
    app = join(work, "app");
    await cp(FIXTURE, app, { recursive: true, filter: (src) => !src.includes("node_modules") });
    git("init", "--quiet", "--initial-branch=main");
    git("add", ".");
    git("commit", "--quiet", "-m", "baseline");
    git("checkout", "--quiet", "-b", "feature");
  });
  afterEach(async () => {
    await rm(work, { recursive: true, force: true });
  });

  it("with no changes, says there's nothing to check and passes", async () => {
    const r = await steward(["check", "app"], work);
    expect(r).toMatchObject({ code: 0, stderr: "" });
    expect(r.stdout).toMatch(/^No TSX or JSX files changed since main, so there was nothing to check\.\n/);
  });

  it("checks only the changed lines, committed or not, compared with main", async () => {
    await addLine("src/pages/Settings.tsx", 25, BAD_LINE);
    git("commit", "--quiet", "-am", "add a line");
    await addLine("src/pages/Billing.tsx", 20, '      <img src="/logo.png" />');
    const r = await steward(["check", "app", "--json"], work);
    expect(r.code).toBe(0);
    const json = JSON.parse(r.stdout) as CheckJson;
    expect(json.scope).toEqual({ kind: "changes", base: "main" });
    expect(json.files).toEqual(["src/pages/Billing.tsx", "src/pages/Settings.tsx"]);
    expect(json.changedLines).toBe(2);
    expect(json.findings.map((f) => `${f.file}:${f.line} ${f.rule}`)).toEqual([
      "src/pages/Billing.tsx:21 a11y-img-alt",
      "src/pages/Settings.tsx:26 a11y-text-contrast",
      "src/pages/Settings.tsx:26 no-hardcoded-color",
      "src/pages/Settings.tsx:26 no-arbitrary-spacing",
    ]);
    expect(Object.keys(json.summary.byRule)).toEqual(["no-hardcoded-color", "no-arbitrary-spacing", "a11y-img-alt", "a11y-text-contrast"]);
    expect(json.summary).toEqual({
      files: 2,
      changedLines: 2,
      findings: 4,
      exactFixes: 1,
      byRule: { "no-hardcoded-color": 1, "no-arbitrary-spacing": 1, "a11y-img-alt": 1, "a11y-text-contrast": 1 },
    });
  });

  it("counts every line of a new, untracked file, and leaves out stories and tests", async () => {
    await writeFile(join(app, "src/pages/New.tsx"), 'export const New = () => <img src="/a.png" />;\n');
    await writeFile(join(app, "src/pages/New.test.tsx"), 'export const T = () => <img src="/a.png" />;\n');
    const json = JSON.parse((await steward(["check", "app", "--json"], work)).stdout) as CheckJson;
    expect(json.files).toEqual(["src/pages/New.tsx"]);
    expect(json.findings.map((f) => f.rule)).toEqual(["a11y-img-alt"]);
  });

  it("prints a readable summary", async () => {
    await addLine("src/pages/Settings.tsx", 25, BAD_LINE);
    const r = await steward(["check", "app"], work);
    expect(r.stdout).toMatch(/^Checked 1 changed line in 1 file, compared with main\.\n\nsrc\/pages\/Settings\.tsx\n {2}26:\d+ /);
    expect(r.stdout).toContain("\nFound 3 things to change in 1 file (1 with an exact fix).\n");
    expect(r.stdout).toContain("\nMode: warn, so this never fails the build.\n");
  });

  it("--all checks every file, old problems included", async () => {
    const r = await steward(["check", "app", "--all", "--json"], work);
    const json = JSON.parse(r.stdout) as CheckJson;
    expect(r.code).toBe(0);
    expect(json.scope).toEqual({ kind: "all" });
    expect(json.files).toContain("src/components/Navbar.tsx");
    expect(json.files.every(isReviewable)).toBe(true);
    expect(json.findings.length).toBeGreaterThan(100);
  });

  it('mode "error" fails the build when something is found, and passes when nothing is', async () => {
    await writeFile(join(app, ".steward/config.json"), '{ "mode": "error" }\n');
    expect((await steward(["check", "app"], work)).code).toBe(0);
    await addLine("src/pages/Settings.tsx", 25, BAD_LINE);
    const r = await steward(["check", "app"], work);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("Mode: error, so this fails the build.");
  });

  it("turns rules off from config.json", async () => {
    await writeFile(join(app, ".steward/config.json"), JSON.stringify({ rules: { "no-hardcoded-color": "off" } }));
    await addLine("src/pages/Settings.tsx", 25, BAD_LINE);
    const r = await steward(["check", "app", "--json"], work);
    const json = JSON.parse(r.stdout) as CheckJson;
    expect(json.findings.map((f) => f.rule)).toEqual(["a11y-text-contrast", "no-arbitrary-spacing"]);
    expect(json.skipped).toEqual(["colors outside the system"]);
  });

  it("compares with the base from config.json, and --base wins over it", async () => {
    git("branch", "release");
    await addLine("src/pages/Settings.tsx", 25, BAD_LINE);
    git("commit", "--quiet", "-am", "add a line");
    await writeFile(join(app, ".steward/config.json"), '{ "base": "release" }');
    const fromConfig = JSON.parse((await steward(["check", "app", "--json"], work)).stdout) as CheckJson;
    expect(fromConfig.scope).toEqual({ kind: "changes", base: "release" });
    const fromFlag = JSON.parse((await steward(["check", "app", "--json", "--base", "HEAD"], work)).stdout) as CheckJson;
    expect(fromFlag.scope).toEqual({ kind: "changes", base: "HEAD" });
    expect(fromFlag.files).toEqual([]);
  });

  it.each([
    ["an unknown rule in config.json", '{ "rules": { "no-colour": "off" } }', /mentions "no-colour", which isn't a Review rule\. The rules are: no-hardcoded-color, /],
    ["a broken config.json", '{ "mode": "strict" }', /\.steward\/config\.json has mode "strict"\. Use "warn"/],
  ])("explains %s instead of checking", async (_, config, message) => {
    await writeFile(join(app, ".steward/config.json"), config);
    const r = await steward(["check", "app"], work);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(message);
  });

  it("explains a base it can't find", async () => {
    const r = await steward(["check", "app", "--base", "nope"], work);
    expect(r.code).toBe(1);
    expect(r.stderr).toBe('I couldn\'t find "nope" in this repo to compare with. Check the name, or fetch it first (for example `git fetch origin nope`).\n');
  });

  it("explains when there's no main or master to compare with", async () => {
    git("branch", "-m", "main", "trunk");
    const r = await steward(["check", "app"], work);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^I couldn't tell which branch to compare with: there's no main or master here\./);
  });

  it("explains a folder that isn't a git repo", async () => {
    const plain = join(work, "plain");
    await mkdir(join(plain, ".steward"), { recursive: true });
    await cp(join(app, ".steward/system.json"), join(plain, ".steward/system.json"));
    const r = await steward(["check", "plain"], work);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/isn't in a git repo/);
  });

  it("refuses --all with --base", async () => {
    const r = await steward(["check", "app", "--all", "--base", "main"], work);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^Use --all or --base, not both/);
  });
});
