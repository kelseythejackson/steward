import { describeScan } from "./report.js";
import type { ScanSummary } from "./scan.js";
import { describe, expect, it } from "vitest";

const clean: ScanSummary = {
  filesScanned: 1,
  colorFamilies: [],
  colors: { found: 3, suggested: 3, merges: 0, keptApart: 0 },
  spacing: { found: 4, scaleSteps: 8, scaleBasis: "repo", snapping: 0, beyondScale: 0, kept: 0, sizes: 0 },
  components: { found: 2, duplicateGroups: 0, duplicateComponents: 0, similar: 0, keptApart: 0 },
  accessibility: {
    pairsChecked: 1,
    failingPairs: 0,
    fixesSuggested: 0,
    fixDeclined: 0,
    noFixFound: 0,
    assumedWhite: 0,
    focusProblems: 0,
    notCheckable: { total: 0, textSetElsewhere: 0, semiTransparent: 0, tooManyCombinations: 0, other: 0 },
    variantsNotChecked: 0,
  },
  storiesAndTests: { files: 0, offSystemColors: 0, offScaleSpacing: 0 },
  skippedFiles: [],
  tooLarge: [],
};

const report = (summary: ScanSummary) => `${describeScan(summary).join("\n")}\n`;
const lineOf = (report: string, prefix: string) => report.split("\n").find((l) => l.startsWith(prefix));

describe("describeScan", () => {
  it("says calmly when there's nothing to fix, and still notes the limits of static checks", () => {
    expect(report(clean)).toBe(
      [
        "Scanned 1 file",
        "Colors: 3 colors → 3 tokens, no near-duplicates",
        "Spacing: 4 values → 8-step scale from the Tailwind values you use most (all already on it)",
        "Components: 2 components, no likely duplicates",
        "Accessibility: 1 color pair passes contrast",
        "  These are static checks. They catch some accessibility problems, not all.",
        "",
      ].join("\n"),
    );
  });

  it("says what the color numbers are, with the per-family breakdown in brackets", () => {
    const r = report(
      { ...clean, colors: { found: 24, suggested: 17, merges: 6, keptApart: 0 }, colorFamilies: [{ family: "gray", found: 14, suggested: 9 }, { family: "blue", found: 4, suggested: 2 }] });
    expect(lineOf(r, "Colors:")).toBe("Colors: 24 colors → 17 tokens (14 grays → 9, 4 blues → 2)");
  });

  it("says where the scale came from", () => {
    const r = report({ ...clean, spacing: { ...clean.spacing, scaleBasis: "default" } });
    expect(lineOf(r, "Spacing:")).toBe("Spacing: 4 values → Steward's default 8-step scale, as too few standard values are used to build yours (all already on it)");
  });

  it("never says a value will change on its own", () => {
    const r = report({ ...clean, spacing: { found: 16, scaleSteps: 8, scaleBasis: "repo", snapping: 10, beyondScale: 1, kept: 0, sizes: 0 } });
    expect(lineOf(r, "Spacing:")).toBe("Spacing: 16 values → 8-step scale from the Tailwind values you use most (10 are off the scale and could snap to it), 1 larger than the scale left as is");
    expect(r).not.toMatch(/\bwill\b/);
  });

  it("shows what people chose to keep as settled, not as drift", () => {
    const r = report(
      {
        ...clean,
        colors: { found: 3, suggested: 3, merges: 0, keptApart: 1 },
        spacing: { found: 4, scaleSteps: 8, scaleBasis: "repo", snapping: 1, beyondScale: 0, kept: 2, sizes: 0 },
        components: { found: 5, duplicateGroups: 1, duplicateComponents: 3, similar: 0, keptApart: 2 },
      });
    expect(lineOf(r, "Colors:")).toBe("Colors: 3 colors → 3 tokens, no near-duplicates; 1 merge you declined stays separate");
    expect(lineOf(r, "Spacing:")).toBe("Spacing: 4 values → 8-step scale from the Tailwind values you use most (1 is off the scale and could snap to it); 2 values you chose to keep stay as is");
    expect(lineOf(r, "Components:")).toBe("Components: 5 components, 1 group of likely duplicates (3 components); 2 merges you declined stay separate");
  });

  it("keeps a declined contrast fix counted as failing, and says why there's no suggestion", () => {
    const r = report(
      { ...clean, accessibility: { ...clean.accessibility, pairsChecked: 16, failingPairs: 9, fixesSuggested: 7, fixDeclined: 1, noFixFound: 1, focusProblems: 1 } });
    expect(lineOf(r, "Accessibility:")).toBe(
      "Accessibility: 9 of 16 color pairs fail contrast (fixes suggested for 7, you declined the fix for 1, no passing shade found for 1), 1 element has no visible focus style",
    );
  });

  it("says when failing pairs assumed a white background", () => {
    const failing = { ...clean.accessibility, pairsChecked: 16, failingPairs: 9, fixesSuggested: 9 };
    expect(report({ ...clean, accessibility: { ...failing, assumedWhite: 3 } })).toContain(
      "\n  3 of the failing pairs assume a white background in some places, because the real one is set by a parent component.\n",
    );
    expect(report({ ...clean, accessibility: { ...failing, assumedWhite: 1 } })).toContain("\n  1 of the failing pairs assumes a white background");
    expect(report({ ...clean, accessibility: { ...failing, assumedWhite: 9 } })).toContain("\n  All 9 failing pairs assume a white background");
  });

  it("explains why places couldn't be checked instead of blaming rendering", () => {
    const one = report({ ...clean, accessibility: { ...clean.accessibility, notCheckable: { total: 10, textSetElsewhere: 10, semiTransparent: 0, tooManyCombinations: 0, other: 0 } } });
    expect(one).toContain("\n  10 places couldn't be checked because their text color comes from another file.\n");
    const mixed = report({ ...clean, accessibility: { ...clean.accessibility, notCheckable: { total: 3, textSetElsewhere: 2, semiTransparent: 1, tooManyCombinations: 0, other: 0 } } });
    expect(mixed).toContain(
      "\n  3 places couldn't be checked: 2 because their text color comes from another file; 1 because they use a semi-transparent color, so contrast depends on what's behind.\n",
    );
    expect(mixed).not.toContain("rendering");
  });

  it("mentions look-alike components and unchecked sizes", () => {
    const r = report({ ...clean, components: { ...clean.components, similar: 1 }, spacing: { ...clean.spacing, sizes: 6 } });
    expect(lineOf(r, "Components:")).toBe("Components: 2 components, no likely duplicates; 1 pair looks alike but behaves differently, so it isn't flagged");
    expect(lineOf(r, "Spacing:")).toBe("Spacing: 4 values → 8-step scale from the Tailwind values you use most (all already on it); 6 widths and heights not checked yet");
  });

  it("says when classes had too many combinations, and when variant colors weren't checked", () => {
    const r = report({
      ...clean,
      accessibility: { ...clean.accessibility, notCheckable: { total: 1, textSetElsewhere: 0, semiTransparent: 0, tooManyCombinations: 1, other: 0 }, variantsNotChecked: 4 },
    });
    expect(r).toContain("\n  1 place couldn't be checked because their classes have more combinations than Steward checks (it checked the first 64).\n");
    expect(r).toContain("\n  Colors under dark:, disabled: and similar variants aren't checked yet (4 places).\n");
  });

  it("lists files it couldn't read or skipped for size", () => {
    const r = report({ ...clean, skippedFiles: ["src/Broken.tsx"], tooLarge: ["src/generated/graphql.ts"] });
    expect(r).toContain("Couldn't read 1 file, so it was skipped: src/Broken.tsx\n");
    expect(r).toContain("Skipped 1 file over 1 MB, probably generated: src/generated/graphql.ts\n");
  });
});
