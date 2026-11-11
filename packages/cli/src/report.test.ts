import type { ScanSummary } from "@steward/scanner";
import { describe, expect, it } from "vitest";
import { formatScanReport } from "./report.js";

const clean: ScanSummary = {
  filesScanned: 1,
  colorFamilies: [],
  colors: { found: 3, suggested: 3, merges: 0 },
  spacing: { found: 4, scaleSteps: 8, snapping: 0, beyondScale: 0 },
  components: { found: 2, duplicateGroups: 0, duplicateComponents: 0 },
  accessibility: { pairsChecked: 1, failingPairs: 0, fixesSuggested: 0, focusProblems: 0, notCheckable: 0 },
  skippedFiles: [],
};

describe("formatScanReport", () => {
  it("says calmly when there's nothing to fix, and still notes the limits of static checks", () => {
    expect(formatScanReport(clean, ".steward/system.json")).toBe(
      [
        "Scanned 1 file",
        "Colors: 3 colors, no near-duplicates",
        "Spacing: 4 values → 8-step scale (all already on it)",
        "Components: 2 components, no likely duplicates",
        "Accessibility: 1 color pair passes contrast",
        "  These are static checks. They catch some accessibility problems, not all.",
        "Wrote .steward/system.json",
        "Next: open that file to see the suggestions. The review screen is coming soon.",
        "",
      ].join("\n"),
    );
  });

  it("uses singulars, partial fixes and skipped files", () => {
    const report = formatScanReport(
      {
        ...clean,
        colorFamilies: [{ family: "gray", found: 1, suggested: 1 }],
        colors: { found: 2, suggested: 1, merges: 1 },
        spacing: { found: 5, scaleSteps: 8, snapping: 1, beyondScale: 1 },
        components: { found: 2, duplicateGroups: 1, duplicateComponents: 2 },
        accessibility: { pairsChecked: 3, failingPairs: 2, fixesSuggested: 1, focusProblems: 1, notCheckable: 1 },
        skippedFiles: ["src/Broken.tsx"],
      },
      "x/system.json",
    );
    expect(report).toContain("Colors: 1 gray → 1\n");
    expect(report).toContain("Spacing: 5 values → 8-step scale (1 will snap), 1 larger than the scale left as is\n");
    expect(report).toContain("Components: 1 group of likely duplicates (2 components)\n");
    expect(report).toContain("Accessibility: 2 color pairs fail contrast (fixes suggested for 1), 1 element has no visible focus style\n");
    expect(report).toContain("1 place couldn't be checked without rendering.");
    expect(report).toContain("Couldn't read 1 file, so it was skipped: src/Broken.tsx\n");
  });
});
