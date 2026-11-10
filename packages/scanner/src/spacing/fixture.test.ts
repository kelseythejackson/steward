import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { extractSpacing, suggestSpacingScale, summarizeSpacingSuggestions, type SpacingExtraction, type SpacingSuggestions } from "./index.js";

const FIXTURE = fileURLToPath(new URL("../../../../fixtures/messy-app", import.meta.url));

/** Reads `| \`gap-[10px]\` | 7 |` rows from the spacing table in FIXTURE_NOTES.md. */
async function arbitraryClassesFromNotes(): Promise<Map<string, number>> {
  const notes = await readFile(`${FIXTURE}/FIXTURE_NOTES.md`, "utf8");
  const rows = [...notes.matchAll(/^\| `([a-z-]+-\[\d+px\])`\s*\|\s*(\d+) \|/gm)];
  return new Map(rows.map((m) => [m[1]!, Number(m[2])]));
}

/** How many times a class is used, across spacing and sizes. */
function usesOfClass(ex: SpacingExtraction, cls: string): number {
  return [...ex.values, ...ex.sizes].flatMap((v) => v.locations).filter((l) => l.raw === cls).length;
}

describe("spacing on fixtures/messy-app", () => {
  let ex: SpacingExtraction;
  let result: SpacingSuggestions;
  beforeAll(async () => {
    ex = await extractSpacing(FIXTURE);
    result = suggestSpacingScale(ex.values);
  });

  it("parses every file", () => {
    expect(ex.skipped).toEqual([]);
  });

  it("finds every arbitrary class in FIXTURE_NOTES §2 with the right count", async () => {
    const expected = await arbitraryClassesFromNotes();
    expect(expected.size).toBe(9);
    for (const [cls, uses] of expected) expect(usesOfClass(ex, cls), cls).toBe(uses);
  });

  it("treats h-[42px] and width: 302px as sizes, not spacing", () => {
    expect(ex.sizes.find((v) => v.px === 42)?.locations.map((l) => l.raw)).toEqual(["h-[42px]"]);
    expect(ex.sizes.find((v) => v.px === 302)?.locations.map((l) => l.raw)).toEqual(["width: 302px"]);
    expect(ex.values.some((v) => v.px === 42 || v.px === 302)).toBe(false);
  });

  it("reads the raw CSS paddings", () => {
    const css = ex.values.flatMap((v) => v.locations).filter((l) => l.file === "src/styles.css").map((l) => l.raw);
    expect([...new Set(css)].sort()).toEqual(["padding: 11px 13px", "padding: 2px 7px", "padding: 9px 13px"]);
  });

  it("does not flag the Billing usage bar's dynamic width", () => {
    const billing = [...ex.values, ...ex.sizes].flatMap((v) => v.locations).filter((l) => l.file === "src/pages/Billing.tsx");
    expect(billing.some((l) => l.source === "inline-style")).toBe(false);
  });

  it("snaps each off-scale value to its nearest step", () => {
    expect(result.suggestions.map((s) => [s.proposed.path, s.members])).toEqual([
      ["spacing.1", ["2px", "4px"]],
      ["spacing.2", ["7px", "8px", "9px"]],
      ["spacing.3", ["10px", "11px", "12px", "13px"]],
      ["spacing.4", ["16px", "18px"]],
      ["spacing.6", ["20px", "22px", "24px"]],
      ["spacing.8", ["28px", "32px"]],
    ]);
    expect(result.beyondScale).toEqual([]);
  });

  it("lists where each snapping value is used", () => {
    const eight = result.suggestions.find((s) => s.proposed.path === "spacing.2")!;
    expect(eight.locations).toHaveLength(10);
    expect(eight.locations).toContainEqual({ file: "src/components/Card.tsx", line: 12, value: "mb-[7px]" });
    expect(eight.reason.summary).toBe(
      "7px and 9px are 1px from 8px, the nearest step on the scale. Used 10 times in 7 files. 8px is already used 5 times.",
    );
  });

  it("prints a readable summary", () => {
    expect(summarizeSpacingSuggestions(ex, result)).toBe(
      "Found 16 spacing values used 67 times → suggest a scale of 8 steps. 10 values (34 uses) would snap to it. 6 sizes (widths and heights) aren't checked yet.",
    );
  });
});
