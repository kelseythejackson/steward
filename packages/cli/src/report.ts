import type { ScanSummary } from "@steward/scanner";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "; 1 merge you declined stays separate", or "" when there's none. Declined merges are a healthy choice, so they read as settled. */
const declined = (n: number) => (n === 0 ? "" : `; ${plural(n, "merge")} you declined ${n === 1 ? "stays" : "stay"} separate`);

function colorsLine(s: ScanSummary): string {
  const { found, suggested, merges, keptApart } = s.colors;
  if (found === 0) return "Colors: no colors found";
  const head = `Colors: ${plural(found, "color")} → ${plural(suggested, "token")}`;
  const kept = declined(keptApart);
  if (merges === 0) return `${head}, no near-duplicates${kept}`;
  const families = s.colorFamilies.map((f) => `${plural(f.found, f.family)} → ${f.suggested}`);
  return `${head} (${families.join(", ")})${kept}`;
}

function spacingLine(s: ScanSummary): string {
  const { found, scaleSteps, snapping, beyondScale, kept } = s.spacing;
  if (found === 0) return "Spacing: no spacing values found";
  let line = `Spacing: ${plural(found, "value")} → ${scaleSteps}-step scale`;
  if (snapping === 0) line += " (all already on it)";
  else line += ` (${snapping} ${snapping === 1 ? "is" : "are"} off the scale and could snap to it)`;
  if (beyondScale > 0) line += `, ${beyondScale} larger than the scale left as is`;
  if (kept > 0) line += `; ${plural(kept, "value")} you chose to keep ${kept === 1 ? "stays" : "stay"} as is`;
  return line;
}

function componentsLine(s: ScanSummary): string {
  const { found, duplicateGroups, duplicateComponents, keptApart } = s.components;
  const kept = declined(keptApart);
  if (duplicateGroups === 0) return `Components: ${plural(found, "component")}, no likely duplicates${kept}`;
  return `Components: ${plural(found, "component")}, ${plural(duplicateGroups, "group")} of likely duplicates (${duplicateComponents} components)${kept}`;
}

function accessibilityLines(s: ScanSummary): string[] {
  const { pairsChecked, failingPairs, fixesSuggested, fixDeclined, noFixFound, assumedWhite, focusProblems, notCheckable } = s.accessibility;
  const parts: string[] = [];
  if (failingPairs === 0) {
    parts.push(
      pairsChecked === 0 ? "no color pairs found to check" : pairsChecked === 1 ? "1 color pair passes contrast" : `all ${pairsChecked} color pairs pass contrast`,
    );
  } else {
    const how: string[] = [];
    if (fixesSuggested > 0) how.push(fixesSuggested === failingPairs ? "fixes suggested" : `fixes suggested for ${fixesSuggested}`);
    if (fixDeclined > 0) how.push(`you declined the fix for ${fixDeclined}`);
    if (noFixFound > 0) how.push(`no passing shade found for ${noFixFound}`);
    parts.push(`${failingPairs} of ${plural(pairsChecked, "color pair")} ${failingPairs === 1 ? "fails" : "fail"} contrast (${how.join(", ")})`);
  }
  if (focusProblems > 0) parts.push(`${plural(focusProblems, "element")} ${focusProblems === 1 ? "has" : "have"} no visible focus style`);

  const lines = [`Accessibility: ${parts.join(", ")}`];
  if (assumedWhite > 0) {
    const who =
      failingPairs === 1 ? "The failing pair assumes" : assumedWhite === failingPairs ? `All ${failingPairs} failing pairs assume` : `${assumedWhite} of the failing pairs ${assumedWhite === 1 ? "assumes" : "assume"}`;
    lines.push(`  ${who} a white background in some places, because the real one is set by a parent component.`);
  }
  if (notCheckable.total > 0) {
    const reasons: [number, string][] = [
      [notCheckable.textSetElsewhere, "their text color comes from another file"],
      [notCheckable.semiTransparent, "they use a semi-transparent color, so contrast depends on what's behind"],
      [notCheckable.other, "of other reasons"],
    ];
    const present = reasons.filter(([n]) => n > 0);
    const why =
      present.length === 1
        ? ` because ${present[0]![1]}`
        : `: ${present.map(([n, text]) => `${n} because ${text}`).join("; ")}`;
    lines.push(`  ${plural(notCheckable.total, "place")} couldn't be checked${why}.`);
  }
  lines.push("  These are static checks. They catch some accessibility problems, not all.");
  return lines;
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
  if (summary.tooLarge.length > 0) {
    const n = summary.tooLarge.length;
    lines.push(`Skipped ${plural(n, "file")} over 1 MB, probably generated: ${summary.tooLarge.join(", ")}`);
  }
  lines.push(`Wrote ${wrotePath}`);
  lines.push("Next: open that file to see the suggestions. The review screen is coming soon.");
  return `${lines.join("\n")}\n`;
}
