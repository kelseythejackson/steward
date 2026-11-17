/**
 * New colors on a re-scan, end to end on a copy of the fixture (which has
 * a system.json already, so every scan here is a re-scan): a color used in
 * 3+ places becomes a token suggestion, not a token; a person accepts or
 * rejects it with `steward review`; Review follows the decision.
 */
import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { decideSuggestions, parseSystemModel, pendingSuggestions, serializeSystemModel, undoDecision, type SystemModel } from "@steward/model";
import { colorsInModel } from "@steward/scanner";
import { colorTokenGroups as colorTokenGroupsOf } from "@steward/model";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CheckJson } from "./check.js";
import { main } from "./main.js";
import { runScan } from "./scan.js";

const FIXTURE = fileURLToPath(new URL("../../../fixtures/messy-app", import.meta.url));
const VIOLET = '      <span className="bg-[#7c3aed] text-white">New</span>';
const NOW = "2026-11-17T10:00:00.000Z";

describe("token suggestions for new colors", () => {
  let work: string;
  let app: string;
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args], { cwd: app, encoding: "utf8" });
  const model = async (): Promise<SystemModel> => parseSystemModel(await readFile(join(app, ".steward/system.json"), "utf8"));
  async function addLines(path: string, after: number, ...lines: string[]) {
    const all = (await readFile(join(app, path), "utf8")).split("\n");
    all.splice(after, 0, ...lines);
    await writeFile(join(app, path), all.join("\n"));
  }
  async function steward(...argv: string[]) {
    let stdout = "";
    const code = await main(argv, { stdout: (t) => (stdout += t), stderr: (t) => (stdout += t), cwd: work });
    return { code, stdout };
  }

  beforeEach(async () => {
    work = await mkdtemp(join(tmpdir(), "steward-tokens-"));
    app = join(work, "app");
    await cp(FIXTURE, app, { recursive: true, filter: (src) => !src.includes("node_modules") });
  });
  afterEach(async () => {
    await rm(work, { recursive: true, force: true });
  });

  it("re-scanning unchanged code changes nothing: every color is already in the system", async () => {
    const before = await model();
    const run = await runScan(app, { now: NOW });
    expect(run.output.summary.newColors).toBeUndefined();
    expect(colorsInModel(run.output.model.tokens)).toEqual(colorsInModel(before.tokens));
  });

  it("a new color in 3 places becomes a suggestion for a person, not a token", async () => {
    await addLines("src/pages/Billing.tsx", 20, VIOLET, VIOLET);
    await addLines("src/pages/Settings.tsx", 25, VIOLET);
    const run = await runScan(app, { now: NOW });
    const m = await model();
    expect(colorsInModel(m.tokens)).not.toContain("#7c3aed");
    const s = m.suggestions.filter((x) => x.kind === "token");
    expect(s.map((x) => x.members)).toEqual([["#7c3aed"]]);
    expect(s[0]!.kind === "token" && s[0]!.locations.map((l) => l.file)).toEqual(["src/pages/Billing.tsx", "src/pages/Billing.tsx", "src/pages/Settings.tsx"]);
    expect(run.output.summary.newColors).toEqual({ held: 1, suggested: 1, families: [{ family: "purple", count: 1 }] });

    const scan = await steward("scan", app);
    expect(scan.stdout).toMatch(/^Colors: .*; 1 new color waits for a decision \(1 purple\)$/m);
    expect(scan.stdout).not.toMatch(/purple → 0/);
    expect(scan.stdout).toContain("\nNew colors since the last scan: 1 color kept out of your system for now; 1 is used in 3+ places, so it's suggested as a token for you to accept or reject\n");
    expect((await steward("review", "app")).stdout).toMatch(/1 new color token/);
  });

  it("a new color in 2 places stays off-system, with no suggestion", async () => {
    await addLines("src/pages/Billing.tsx", 20, VIOLET, VIOLET);
    const run = await runScan(app, { now: NOW });
    expect(run.output.model.suggestions.filter((x) => x.kind === "token")).toEqual([]);
    expect(colorsInModel(run.output.model.tokens)).not.toContain("#7c3aed");
    expect((await steward("scan", app)).stdout).toContain("New colors since the last scan: 1 color kept out of your system for now; it stays off-system, and Review flags it\n");
  });

  it("accepted, it joins the system on the next scan", async () => {
    await addLines("src/pages/Billing.tsx", 20, VIOLET, VIOLET, VIOLET);
    await runScan(app, { now: NOW });
    const r = await steward("review", "app", "--accept-all");
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/Accepted 1 suggestion: 1 new color token\./);

    // `decide --accept-all` re-scans, so it's a token at once; another scan keeps it.
    expect(colorsInModel((await model()).tokens)).toContain("#7c3aed");
    await runScan(app, { now: NOW });
    const m = await model();
    expect(colorsInModel(m.tokens)).toContain("#7c3aed");
    // Its suggestion stays, decided, so it can be undone; nothing is waiting.
    expect(pendingSuggestions(m).filter((x) => x.kind === "token")).toEqual([]);
  });

  it("accepted and then undone, it leaves the system and waits for a decision again", async () => {
    await addLines("src/pages/Billing.tsx", 20, VIOLET, VIOLET, VIOLET);
    await runScan(app, { now: NOW });
    await steward("review", "app", "--accept-all");
    const accepted = await model();
    expect(colorsInModel(accepted.tokens)).toContain("#7c3aed");
    const id = accepted.suggestions.find((x) => x.kind === "token" && x.members.includes("#7c3aed"))!.id;

    await writeFile(join(app, ".steward/system.json"), serializeSystemModel(undoDecision(accepted, id)));
    await runScan(app, { now: NOW });
    const m = await model();
    expect(colorsInModel(m.tokens)).not.toContain("#7c3aed");
    expect(pendingSuggestions(m).map((x) => x.id)).toContain(id);
  });

  it("accepted, it keeps the name it was accepted as, even when it's close to another token", async () => {
    // #3c83f8 is nearly blue-500 (#3b82f6): without its accepted name pinned, the next scan would fold it into blue-500.
    const NEAR_BLUE = '      <span className="text-[#3c83f8]">New</span>';
    await addLines("src/pages/Billing.tsx", 20, NEAR_BLUE, NEAR_BLUE, NEAR_BLUE);
    await runScan(app, { now: NOW });
    const suggestion = (await model()).suggestions.find((x) => x.kind === "token" && x.members.includes("#3c83f8"))!;
    expect(suggestion).toBeDefined();
    await steward("review", "app", "--accept-all");
    await runScan(app, { now: NOW });
    const m = await model();
    const owner = (hex: string) => colorTokenGroupsOf(m).find((g) => g.members.includes(hex))?.path;
    expect(owner("#3c83f8")).toBe(suggestion.proposed.path);
    expect(owner("#3b82f6")).toBe("color.blue.500");
    // Nothing about it waits again: no merge, and its token suggestion is kept as decided.
    // (A contrast fix may: it's used as text on white, below 4.5:1.)
    expect(pendingSuggestions(m).filter((x) => (x.kind === "color" || x.kind === "token") && x.members.includes("#3c83f8"))).toEqual([]);
  });

  it("rejected, it's never suggested again, and Review flags it as drift", async () => {
    await addLines("src/pages/Billing.tsx", 20, VIOLET, VIOLET, VIOLET);
    await runScan(app, { now: NOW });
    const pending = await model();
    await writeFile(join(app, ".steward/system.json"), serializeSystemModel(decideSuggestions(pending, pending.suggestions.filter((s) => s.kind === "token"), "rejected", NOW)));

    await runScan(app, { now: NOW });
    const m = await model();
    expect(m.suggestions.filter((x) => x.kind === "token")).toEqual([]);
    expect(colorsInModel(m.tokens)).not.toContain("#7c3aed");

    await writeFile(join(app, ".gitignore"), ".steward/history.jsonl\n"); // as a set-up repo has it; history.test.ts covers the reminder
    git("init", "--quiet", "--initial-branch=main");
    const check = JSON.parse((await steward("check", "app", "--all", "--json")).stdout) as CheckJson;
    expect(check.tokenSuggestions).toEqual([]);
    expect(check.findings.filter((f) => f.rule === "no-hardcoded-color" && f.found.includes("#7c3aed"))).toHaveLength(3);
  });

  it("while it's waiting, Review suggests it rather than flags it, and points to the Setup screen", async () => {
    await addLines("src/pages/Billing.tsx", 20, VIOLET, VIOLET, VIOLET);
    await runScan(app, { now: NOW });
    await writeFile(join(app, ".gitignore"), ".steward/history.jsonl\n"); // as a set-up repo has it; history.test.ts covers the reminder
    git("init", "--quiet", "--initial-branch=main");
    const check = JSON.parse((await steward("check", "app", "--all", "--json")).stdout) as CheckJson;
    expect(check.tokenSuggestions).toHaveLength(3);
    expect(check.tokenSuggestions[0]!.fix.description).toMatch(/^It's already suggested as a token and waiting for a decision on the Setup screen\./);
  });
});
