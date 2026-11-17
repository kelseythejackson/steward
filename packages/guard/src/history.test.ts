import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkHistoryRecord, HISTORY_RULE_IDS, parseSystemModel } from "@steward/model";
import { describe, expect, it } from "vitest";
import { checkContext } from "./context.js";
import { acceptedSuggestions } from "./github.js";
import { componentUse, historyRecord, sourceType } from "./history.js";
import { reviewFiles } from "./review.js";
import { RULES } from "./rules/index.js";

const FIXTURE = fileURLToPath(new URL("../../../fixtures/messy-app", import.meta.url));
const ctx = checkContext(parseSystemModel(readFileSync(join(FIXTURE, ".steward/system.json"), "utf8")));

describe("sourceType", () => {
  it("reads a label", () => {
    expect(sourceType({ labels: ["AI-Agent", "bug"] })).toBe("ai-agent");
    expect(sourceType({ labels: ["human"] })).toBe("human");
  });

  it("knows AI coding agents' bot accounts", () => {
    expect(sourceType({ labels: [], author: "copilot-swe-agent[bot]" })).toBe("ai-agent");
    expect(sourceType({ labels: [], author: "Claude[bot]" })).toBe("ai-agent");
  });

  it("never assumes a person's account means human", () => {
    expect(sourceType({ labels: [], author: "jane-doe" })).toBe("unknown");
    expect(sourceType({ labels: [], author: "dependabot[bot]" })).toBe("unknown");
    expect(sourceType({ labels: [] })).toBe("unknown");
  });

  it("calls conflicting labels unknown, and takes labels from config", () => {
    expect(sourceType({ labels: ["ai-agent", "human"] })).toBe("unknown");
    expect(sourceType({ labels: ["generated"] }, { aiLabels: ["generated"] })).toBe("ai-agent");
    expect(sourceType({ labels: [], author: "our-agent[bot]" }, { aiBots: ["our-agent[bot]"] })).toBe("ai-agent");
  });
});

const CODE = [
  'import { Button } from "../components/Button";',
  'import { PrimaryBtn } from "../components/PrimaryBtn";',
  "export const X = () => (",
  "  <div>",
  "    <Button>Save</Button>",
  "    <button>Reset</button>",
  '    <PrimaryBtn label="Go" />',
  "    {/* steward-ignore use-system-component: marketing hero */}",
  "    <button>Hero</button>",
  "  </div>",
  ");",
  "",
].join("\n");

describe("componentUse", () => {
  it("counts system components out of elements the system has a component for; divs don't count", () => {
    // Button (system) out of Button, a raw button, PrimaryBtn (merged into Button) and an ignored raw button.
    expect(componentUse([{ path: "src/X.tsx", code: CODE }], ctx)).toEqual({ system: 1, total: 4 });
  });

  it("only counts the checked lines", () => {
    expect(componentUse([{ path: "src/X.tsx", code: CODE, lines: new Set([5, 6]) }], ctx)).toEqual({ system: 1, total: 2 });
    expect(componentUse([{ path: "src/X.tsx", code: CODE, lines: new Set([4]) }], ctx)).toEqual({ system: 0, total: 0 });
  });

  it("skips files it can't read", () => {
    expect(componentUse([{ path: "src/B.tsx", code: "<div className=" }], ctx)).toEqual({ system: 0, total: 0 });
  });
});

describe("historyRecord", () => {
  const files = [{ path: "src/X.tsx", code: CODE, lines: new Set([5, 6, 7, 9]) }];
  const result = reviewFiles(files, ctx, { mode: "warn", rules: {} }, { kind: "changes", base: "origin/main" });
  const record = historyRecord(result, { date: "2026-11-17T10:00:00.000Z", pr: 7, source: "ai-agent", fixesAccepted: 1, components: componentUse(files, ctx) });

  it("holds counts and the source type, and passes the history checks", () => {
    expect(checkHistoryRecord(record)).toBe(record);
    expect(record).toMatchObject({ v: 1, scope: "changes", pr: 7, source: "ai-agent", files: 1, changedLines: 4, exceptions: 1, fixesAccepted: 1 });
    expect(record.components).toEqual({ system: 1, total: 4, share: 0.25 });
  });

  it("lists every rule, accessibility included, with 0 for those that found nothing", () => {
    expect(Object.keys(record.problems)).toEqual(RULES.map((r) => r.id));
    expect(record.problems["use-system-component"]).toBe(2);
    expect(record.problems["a11y-img-alt"]).toBe(0);
  });

  it("has no share when nothing on the checked lines has a system version", () => {
    const empty = reviewFiles([], ctx, { mode: "warn", rules: {} }, { kind: "all" });
    expect(historyRecord(empty, { date: "2026-11-17T10:00:00.000Z", pr: null, source: "unknown", fixesAccepted: null, components: { system: 0, total: 0 } }).components).toEqual({ system: 0, total: 0, share: null });
  });
});

describe("acceptedSuggestions", () => {
  const body = (line: string, fp: string) => `Use mt-3\n\nOne-click fix:\n\n\`\`\`suggestion\n${line}\n\`\`\`\n\n<!-- steward-review:fp=${fp} -->\n`;
  const now = '      <p className="mt-3 text-gray-500">Saved.</p>\n      <img src="/a.png" />\n';

  it("counts an outdated suggestion whose line is now in the file", () => {
    expect(acceptedSuggestions([{ path: "src/S.tsx", line: null, body: body('      <p className="mt-3 text-gray-500">Saved.</p>', "aaaa") }], () => now)).toBe(1);
  });

  it("doesn't count a suggestion still on its line, one changed some other way, or the same comment twice", () => {
    const comments = [
      { path: "src/S.tsx", line: 26, body: body('      <p className="mt-3 text-gray-500">Saved.</p>', "bbbb") },
      { path: "src/S.tsx", line: null, body: body('      <button className="bg-blue-600">Go</button>', "cccc") },
      { path: "src/S.tsx", line: null, body: body('      <p className="mt-3 text-gray-500">Saved.</p>', "dddd") },
      { path: "src/S.tsx", line: null, body: body('      <p className="mt-3 text-gray-500">Saved.</p>', "dddd") },
      { path: "src/S.tsx", line: null, body: "A person's comment, no suggestion" },
    ];
    expect(acceptedSuggestions(comments, () => now)).toBe(1);
    expect(acceptedSuggestions(comments, () => undefined)).toBe(0);
  });
});

describe("acceptedSuggestions near the comment's line", () => {
  const body = (line: string, fp: string) => `Use mt-3\n\nOne-click fix:\n\n\`\`\`suggestion\n${line}\n\`\`\`\n\n<!-- steward-review:fp=${fp} -->\n`;
  const file = (at: number, line: string) => Array.from({ length: 60 }, (_, i) => (i + 1 === at ? line : `  <div>${i}</div>`)).join("\n");
  const fixed = '      <p className="mt-3">Saved.</p>';

  it("counts the suggestion when it's at or near its original line", () => {
    expect(acceptedSuggestions([{ path: "a.tsx", line: null, originalLine: 20, body: body(fixed, "a1") }], () => file(22, fixed))).toBe(1);
  });

  it("doesn't count an identical line far from where the comment was made", () => {
    expect(acceptedSuggestions([{ path: "a.tsx", line: null, originalLine: 20, body: body(fixed, "a2") }], () => file(55, fixed))).toBe(0);
  });

  it("never counts an empty suggestion (a line removed), which would match any blank line", () => {
    expect(acceptedSuggestions([{ path: "a.tsx", line: null, originalLine: 2, body: body("", "a3") }], () => "a\n\nb")).toBe(0);
  });
});

describe("history's allowed rule ids", () => {
  it("include every Review rule, so a new rule's counts are never refused (add its id to HISTORY_RULE_IDS in packages/model)", () => {
    const missing = RULES.map((r) => r.id).filter((id) => !HISTORY_RULE_IDS.includes(id));
    expect(missing).toEqual([]);
  });
});
