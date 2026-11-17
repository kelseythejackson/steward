import { join } from "node:path";
import { allLines, checkContext, parseAddedLines } from "@steward/guard";
import { readSystemModel, type SystemModel } from "@steward/model";
import { beforeAll, describe, expect, it } from "vitest";
import { promptOf, scoreFile, totalsOf, type RunResult } from "./score.js";
import { summarize } from "./summary.js";

const FIXTURE = join(import.meta.dirname, "../../fixtures/messy-app");
let model: SystemModel;
beforeAll(async () => {
  model = (await readSystemModel(FIXTURE))!;
});

describe("parseAddedLines", () => {
  const diff = [
    "diff --git a/src/pages/Billing.tsx b/src/pages/Billing.tsx",
    "--- a/src/pages/Billing.tsx",
    "+++ b/src/pages/Billing.tsx",
    "@@ -10,0 +11,3 @@ export function Billing() {",
    "+a",
    "+b",
    "+c",
    "@@ -20 +23 @@",
    "-old",
    "+new",
    "@@ -30,2 +33,0 @@",
    "-gone",
    "-gone",
    "diff --git a/src/old.tsx b/src/old.tsx",
    "--- a/src/old.tsx",
    "+++ /dev/null",
    "@@ -1,2 +0,0 @@",
    "diff --git a/src/only-deletes.tsx b/src/only-deletes.tsx",
    "--- a/src/only-deletes.tsx",
    "+++ b/src/only-deletes.tsx",
    "@@ -4,1 +3,0 @@",
  ].join("\n");

  it("keeps the new-file line numbers of added lines only", () => {
    const added = parseAddedLines(diff);
    expect([...added.keys()]).toEqual(["src/pages/Billing.tsx"]);
    expect([...added.get("src/pages/Billing.tsx")!]).toEqual([11, 12, 13, 23]);
  });

  it("counts every line of a new file", () => {
    expect([...allLines("a\nb\nc\n")]).toEqual([1, 2, 3]);
    expect(allLines("").size).toBe(0);
  });
});

describe("scoreFile", () => {
  const code = [
    'import { Card } from "../components/Card";', // 1
    "export function Old() {", // 2
    '  return <div className="p-[13px]">old</div>;', // 3: pre-existing problem, not added
    "}", // 4
    "export function New() {", // 5
    "  return (", // 6
    '    <Card className="bg-[#3b82f6] p-4">', // 7
    '      <img src="/plan.svg" />', // 8
    "      <button onClick={() => {}}>Start free trial</button>", // 9
    "    </Card>", // 10
    "  );", // 11
    "}", // 12
  ].join("\n");
  const added = new Set([5, 6, 7, 8, 9, 10, 11, 12]);

  it("counts guard findings, including merged-away components, on added lines only", () => {
    const score = scoreFile("src/pages/Billing.tsx", code, added, checkContext(model));
    expect(score.parseError).toBeUndefined();
    expect(score.addedLines).toBe(8);
    expect(score.findings.map((f) => [f.line, f.check])).toEqual([
      [7, "use-system-component"],
      [7, "no-hardcoded-color"],
      [8, "a11y-img-alt"],
      [9, "use-system-component"],
    ]);
  });

  it("reports a file it can't read instead of failing the run", () => {
    const score = scoreFile("src/broken.tsx", "export const X = () => <div>", allLines("x"), checkContext(model));
    expect(score.parseError).toBeDefined();
    expect(score.findings).toEqual([]);
    expect(totalsOf([score]).parseErrors).toBe(1);
  });
});

describe("summarize", () => {
  const run = (condition: string, label: string, problems: number, lines: number): RunResult => {
    const files = [
      {
        path: "src/x.tsx",
        addedLines: lines,
        findings: Array.from({ length: problems }, (_, i) => ({ check: "use-system-component" as const, line: i + 1, column: 1, found: "<button>", message: "" })),
      },
    ];
    return { condition, label, prompt: promptOf(label), files, totals: totalsOf(files) };
  };

  it("compares conditions overall and by prompt", () => {
    const out = summarize([run("with", "pricing-1", 1, 50), run("without", "pricing-1", 4, 50), run("without", "pricing-2", 2, 50)]);
    expect(out).toContain("Scored 3 runs across 2 conditions");
    expect(out).toMatch(/with\s+1\s+50\s+1\s+2\s/);
    expect(out).toMatch(/without\s+2\s+100\s+6\s+6\s/);
    expect(out).toMatch(/pricing\s+1 \(1 run\)\s+3 \(2 runs\)/);
    expect(out).toContain("fewer than 3 runs");
  });

  it("says what to do when nothing is saved", () => {
    expect(summarize([])).toContain("pnpm eval:score");
  });

  it("is deterministic regardless of input order", () => {
    const a = [run("with", "pricing-1", 1, 50), run("without", "dialog-1", 2, 40)];
    expect(summarize(a)).toBe(summarize([...a].reverse()));
  });
});
