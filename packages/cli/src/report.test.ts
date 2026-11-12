import { describeScan, type ScanSummary } from "@steward/scanner";
import { describe, expect, it } from "vitest";
import { formatScanReport } from "./report.js";

const summary: ScanSummary = {
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
  rules: { total: 6, basics: 6, fromAccepted: 0, yours: 0, off: 0 },
  storiesAndTests: { files: 0, offSystemColors: 0, offScaleSpacing: 0 },
  skippedFiles: [],
  tooLarge: [],
  linksOutside: [],
};

describe("formatScanReport", () => {
  it("prints the scanner's findings, then where the model went and what to do next", () => {
    expect(formatScanReport(summary, ".steward/system.json")).toBe(
      [...describeScan(summary), "Wrote .steward/system.json", "Next: open that file to see the suggestions. The review screen is coming soon.", ""].join("\n"),
    );
  });
});
