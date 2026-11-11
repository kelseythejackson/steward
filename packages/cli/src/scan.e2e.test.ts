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
import { parseSystemModel, serializeSystemModel, type MergeDecision } from "@steward/model";
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
    expect(lines[0]).toBe("Scanned 17 files");
    expect(lines[1]).toBe("Colors: 14 grays → 9, 4 blues → 2");
    expect(lines[2]).toMatch(/^Spacing: \d+ values → 8-step scale \(\d+ will snap\)$/);
    expect(lines[3]).toBe("Components: 2 groups of likely duplicates (5 components)");
    expect(lines[4]).toBe("Accessibility: 9 color pairs fail contrast (fixes suggested), 2 elements have no visible focus style");
    expect(lines[5]).toMatch(/^ {2}These are static checks\. They catch some accessibility problems, not all\./);
    expect(lines.slice(6)).toEqual([
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
    expect(run.stdout).toContain("Components: 1 group of likely duplicates");
    const after = parseSystemModel(await readFile(join(app, ".steward/system.json"), "utf8"), "system.json");
    expect(after.decisions).toEqual([decision]);
    expect(after.suggestions.map((s) => s.id)).not.toContain(merge.id);
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
