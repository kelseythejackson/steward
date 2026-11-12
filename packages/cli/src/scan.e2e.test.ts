/**
 * End to end: builds the packages, then runs the real `steward` binary on a
 * copy of fixtures/messy-app (so `.steward/` never lands in the fixture).
 */
import { execFile, execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parseSystemModel, serializeSystemModel, type MergeDecision, type Rule } from "@steward/model";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ScanOutput } from "./scan.js";

const REPO = fileURLToPath(new URL("../../..", import.meta.url));
const FIXTURE = join(REPO, "fixtures/messy-app");
const BIN = join(REPO, "packages/cli/dist/bin.js");

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

async function steward(args: string[], cwd: string): Promise<Run> {
  try {
    const { stdout, stderr } = await promisify(execFile)(process.execPath, [BIN, ...args], { cwd, maxBuffer: 16 * 1024 * 1024 });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code: number; stdout: string; stderr: string };
    return { code: e.code, stdout: e.stdout, stderr: e.stderr };
  }
}

describe("steward scan (end to end)", () => {
  let work: string;
  let app: string;
  let first: Run;
  let systemJson: string;

  beforeAll(async () => {
    execFileSync(join(REPO, "node_modules/.bin/tsc"), ["-b", "packages/cli"], { cwd: REPO, stdio: "inherit" });
    work = await mkdtemp(join(tmpdir(), "steward-e2e-"));
    app = join(work, "messy-app");
    await cp(FIXTURE, app, { recursive: true, filter: (src) => !src.includes("/.steward") && !src.includes("node_modules") });
    first = await steward(["scan", "messy-app"], work);
    systemJson = await readFile(join(app, ".steward/system.json"), "utf8");
  }, 120_000);

  afterAll(async () => {
    if (work) await rm(work, { recursive: true, force: true });
  });

  it("prints the short report and exits 0", () => {
    expect(first.stderr).toBe("");
    expect(first.code).toBe(0);
    const lines = first.stdout.split("\n");
    expect(lines.slice(0, 9)).toEqual([
      "Scanned 17 files",
      "Colors: 24 colors → 17 tokens (14 grays → 9, 4 blues → 2)",
      "Spacing: 16 values → 7-step scale from the Tailwind values you use most (9 are off the scale and could snap to it); 6 widths and heights not checked yet",
      "Components: 13 components, 2 groups of likely duplicates (5 components); 1 pair looks alike but behaves differently, so it isn't flagged",
      "Accessibility: 9 of 16 color pairs fail contrast (fixes suggested), 2 elements have no visible focus style",
      "  3 of the failing pairs assume a white background in some places, because the real one is set by a parent component.",
      "  10 places couldn't be checked because their text color comes from another file.",
      "  These are static checks. They catch some accessibility problems, not all.",
      "Rules: 6 starter rules for accessibility basics (more come as you accept suggestions)",
    ]);
    expect(lines.slice(9)).toEqual([
      "Wrote messy-app/.steward/system.json",
      "Next: open that file to see the suggestions. The review screen is coming soon.",
      "",
    ]);
  });

  it("writes a valid, canonical system.json with every kind of suggestion", () => {
    const model = parseSystemModel(systemJson, "system.json");
    expect(serializeSystemModel(model)).toBe(systemJson);
    expect(Object.keys(model.tokens).sort()).toEqual(["color", "spacing"]);
    expect(model.components).toHaveLength(13);
    expect([...new Set(model.suggestions.map((s) => s.kind))].sort()).toEqual(["color", "component", "contrast", "spacing"]);
  });

  it("prints the full result with --json, matching the file it wrote", async () => {
    const run = await steward(["scan", app, "--json"], work);
    expect(run.code).toBe(0);
    const out = JSON.parse(run.stdout) as ScanOutput;
    expect(out.systemModelPath).toBe(".steward/system.json");
    expect(serializeSystemModel(out.model)).toBe(systemJson);
    expect(out.summary.filesScanned).toBe(17);
    expect(out.details.contrast.focus).toHaveLength(2);
    expect(run.stdout).not.toContain(work); // no machine-specific paths
  });

  it("gives byte-identical output on a second run", async () => {
    const again = await steward(["scan", "messy-app"], work);
    expect(again.stdout).toBe(first.stdout);
    expect(await readFile(join(app, ".steward/system.json"), "utf8")).toBe(systemJson);
  });

  it("keeps a person's decisions on re-scan and doesn't re-suggest a rejected merge", async () => {
    const model = parseSystemModel(systemJson, "system.json");
    const merge = model.suggestions.find((s) => s.kind === "component")!;
    const decision: MergeDecision = { suggestionId: merge.id, kind: merge.kind, members: merge.members, status: "rejected", decidedAt: "2026-11-01T00:00:00.000Z" };
    await writeFile(join(app, ".steward/system.json"), serializeSystemModel({ ...model, decisions: [decision] }));

    const run = await steward(["scan", "messy-app"], work);
    expect(run.code).toBe(0);
    expect(run.stdout).toContain("Components: 13 components, 1 group of likely duplicates (3 components); 1 pair looks alike but behaves differently, so it isn't flagged; 1 merge you declined stays separate\n");
    const after = parseSystemModel(await readFile(join(app, ".steward/system.json"), "utf8"), "system.json");
    expect(after.decisions).toEqual([decision]);
    expect(after.suggestions.map((s) => s.id)).not.toContain(merge.id);
  });

  it("adds starter rules for accepted suggestions and keeps a person's own rule and choices", async () => {
    const model = parseSystemModel(systemJson, "system.json");
    const button = model.suggestions.find((s) => s.kind === "component" && s.members.includes("PrimaryBtn"))!;
    const decision: MergeDecision = { suggestionId: button.id, kind: button.kind, members: button.members, status: "accepted", decidedAt: "2026-11-12T10:00:00.000Z" };
    const own: Rule = {
      id: "headings-sentence-case",
      text: "Headings use sentence case.",
      category: "component",
      appliesTo: [{ kind: "element", name: "h2" }],
      examples: { right: "<h2>Billing details</h2>", wrong: "<h2>Billing Details</h2>" },
      source: "user",
      severity: "warn",
      enabled: true,
    };
    const imgAltOff = { ...model.rules.find((r) => r.id === "a11y-img-alt")!, enabled: false };
    const rules = [...model.rules.filter((r) => r.id !== "a11y-img-alt"), imgAltOff, own];
    await writeFile(join(app, ".steward/system.json"), serializeSystemModel({ ...model, decisions: [decision], rules }));

    const run = await steward(["scan", "messy-app"], work);
    expect(run.code).toBe(0);
    expect(run.stdout).toContain("Rules: 8 starter rules (6 accessibility basics, 2 from changes you accepted); 1 rule of your own kept as it is; 1 turned off\n");
    const after = parseSystemModel(await readFile(join(app, ".steward/system.json"), "utf8"), "system.json");
    expect(after.rules.map((r) => r.id)).toEqual([
      "a11y-click-target",
      "a11y-focus-visible",
      "a11y-icon-button-label",
      "a11y-img-alt",
      "a11y-input-label",
      "a11y-text-contrast",
      "headings-sentence-case",
      "no-raw-button",
      "use-component-button",
    ]);
    expect(after.rules.find((r) => r.id === "a11y-img-alt")!.enabled).toBe(false);
    expect(after.rules.find((r) => r.id === "headings-sentence-case")).toEqual(own);
    expect(after.rules.find((r) => r.id === "use-component-button")!.basedOn).toEqual([button.id]);
  });

  it("leaves a broken system.json alone and says how to fix it", async () => {
    const path = join(app, ".steward/system.json");
    await writeFile(path, "{ not json");
    const run = await steward(["scan", "messy-app"], work);
    expect(run.code).toBe(1);
    expect(run.stderr).toContain("I couldn't read the existing .steward/system.json, so I left it as is.");
    expect(await readFile(path, "utf8")).toBe("{ not json");
  });

  it("explains a missing folder instead of crashing", async () => {
    const run = await steward(["scan", "no-such-app"], work);
    expect(run.code).toBe(1);
    expect(run.stderr).toBe("I couldn't find a folder at no-such-app. Check the path and try again.\n");
    expect(run.stdout).toBe("");
  });
});
