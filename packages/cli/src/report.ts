import type { ScanSummary } from "@steward/scanner";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function colorsLine(s: ScanSummary): string {
  if (s.colors.merges === 0) return `Colors: ${plural(s.colors.found, "color")}, no near-duplicates`;
  const families = s.colorFamilies.map((f) => `${plural(f.found, f.family)} → ${f.suggested}`);
  return `Colors: ${families.join(", ")}`;
}

function spacingLine(s: ScanSummary): string {
  const { found, scaleSteps, snapping, beyondScale } = s.spacing;
  if (found === 0) return "Spacing: no spacing values found";
  let line = `Spacing: ${plural(found, "value")} → ${scaleSteps}-step scale`;
  line += snapping === 0 ? " (all already on it)" : ` (${snapping} will snap)`;
  if (beyondScale > 0) line += `, ${beyondScale} larger than the scale left as is`;
  return line;
}

function componentsLine(s: ScanSummary): string {
  const { found, duplicateGroups, duplicateComponents } = s.components;
  if (duplicateGroups === 0) return `Components: ${plural(found, "component")}, no likely duplicates`;
  return `Components: ${plural(duplicateGroups, "group")} of likely duplicates (${duplicateComponents} components)`;
}

function accessibilityLines(s: ScanSummary): string[] {
  const { pairsChecked, failingPairs, fixesSuggested, focusProblems, notCheckable } = s.accessibility;
  const parts: string[] = [];
  if (failingPairs === 0) {
    parts.push(
      pairsChecked === 0 ? "no color pairs found to check" : pairsChecked === 1 ? "1 color pair passes contrast" : `all ${pairsChecked} color pairs pass contrast`,
    );
  } else {
    const fixes = fixesSuggested === failingPairs ? "fixes suggested" : `fixes suggested for ${fixesSuggested}`;
    parts.push(`${plural(failingPairs, "color pair")} ${failingPairs === 1 ? "fails" : "fail"} contrast (${fixes})`);
  }
  if (focusProblems > 0) parts.push(`${plural(focusProblems, "element")} ${focusProblems === 1 ? "has" : "have"} no visible focus style`);

  let note = "  These are static checks. They catch some accessibility problems, not all.";
  if (notCheckable > 0) note += ` ${plural(notCheckable, "place")} couldn't be checked without rendering.`;
  return [`Accessibility: ${parts.join(", ")}`, note];
}

/** Pure: the short, plain-English report `steward scan` prints. */
export function formatScanReport(summary: ScanSummary, wrotePath: string): string {
  const lines = [
    `Scanned ${plural(summary.filesScanned, "file")}`,
    colorsLine(summary),
    spacingLine(summary),
    componentsLine(summary),
    ...accessibilityLines(summary),
  ];
  if (summary.skippedFiles.length > 0) {
    const n = summary.skippedFiles.length;
    lines.push(`Couldn't read ${plural(n, "file")}, so ${n === 1 ? "it was" : "they were"} skipped: ${summary.skippedFiles.join(", ")}`);
  }
  lines.push(`Wrote ${wrotePath}`);
  lines.push("Next: open that file to see the suggestions. The review screen is coming soon.");
  return `${lines.join("\n")}\n`;
}
