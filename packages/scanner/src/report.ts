import type { ScanSummary } from "./scan.js";

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
  const { found, scaleSteps, scaleBasis, snapping, beyondScale, kept, sizes } = s.spacing;
  if (found === 0) return "Spacing: no spacing values found";
  const scale = {
    repo: `${scaleSteps}-step scale from the Tailwind values you use most`,
    default: `Steward's default ${scaleSteps}-step scale, as too few standard values are used to build yours`,
    custom: `${scaleSteps}-step scale`,
  }[scaleBasis];
  let line = `Spacing: ${plural(found, "value")} → ${scale}`;
  if (snapping === 0) line += " (all already on it)";
  else line += ` (${snapping} ${snapping === 1 ? "is" : "are"} off the scale and could snap to it)`;
  if (beyondScale > 0) line += `, ${beyondScale} larger than the scale left as is`;
  if (kept > 0) line += `; ${plural(kept, "value")} you chose to keep ${kept === 1 ? "stays" : "stay"} as is`;
  if (sizes > 0) line += `; ${plural(sizes, "width or height", "widths and heights")} not checked yet`;
  return line;
}

function componentsLine(s: ScanSummary): string {
  const { found, duplicateGroups, duplicateComponents, similar, keptApart } = s.components;
  let line = `Components: ${plural(found, "component")}, `;
  line += duplicateGroups === 0 ? "no likely duplicates" : `${plural(duplicateGroups, "group")} of likely duplicates (${duplicateComponents} components)`;
  if (similar > 0) line += `; ${plural(similar, "pair")} ${similar === 1 ? "looks" : "look"} alike but ${similar === 1 ? "behaves" : "behave"} differently, so ${similar === 1 ? "it isn't" : "they aren't"} flagged`;
  return line + declined(keptApart);
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
      [notCheckable.tooManyCombinations, "their classes have more combinations than Steward checks (it checked the first 64)"],
      [notCheckable.other, "of other reasons"],
    ];
    const present = reasons.filter(([n]) => n > 0);
    const why =
      present.length === 1
        ? ` because ${present[0]![1]}`
        : `: ${present.map(([n, text]) => `${n} because ${text}`).join("; ")}`;
    lines.push(`  ${plural(notCheckable.total, "place")} couldn't be checked${why}.`);
  }
  const variants = s.accessibility.variantsNotChecked;
  if (variants > 0) lines.push(`  Colors under dark:, disabled: and similar variants aren't checked yet (${plural(variants, "place")}).`);
  lines.push("  These are static checks. They catch some accessibility problems, not all.");
  return lines;
}

function rulesLine(s: ScanSummary): string {
  const { basics, fromAccepted, yours, off } = s.rules;
  const starter = basics + fromAccepted;
  let line =
    fromAccepted === 0
      ? `Rules: ${plural(starter, "starter rule")} for accessibility basics (more come as you accept suggestions)`
      : `Rules: ${plural(starter, "starter rule")} (${basics} accessibility basics, ${fromAccepted} from changes you accepted)`;
  if (yours > 0) line += `; ${plural(yours, "rule")} of your own kept as ${yours === 1 ? "it is" : "they are"}`;
  if (off > 0) line += `; ${off} turned off`;
  return line;
}

/**
 * Pure: the plain-English findings of a scan, one line per area, plus notes
 * on what static checks can't see. The single source of Steward Setup's
 * wording: the CLI prints these lines and the web app can show the same ones.
 */
export function describeScan(summary: ScanSummary): string[] {
  const lines = [
    `Scanned ${plural(summary.filesScanned, "file")}`,
    colorsLine(summary),
    spacingLine(summary),
    componentsLine(summary),
    ...accessibilityLines(summary),
    rulesLine(summary),
  ];
  const st = summary.storiesAndTests;
  if (st.files > 0) {
    const off: string[] = [];
    if (st.offSystemColors > 0) off.push(plural(st.offSystemColors, "color"));
    if (st.offScaleSpacing > 0) off.push(plural(st.offScaleSpacing, "spacing value"));
    const what = off.length === 0 ? "everything in them matches it" : `${off.join(" and ")} in them ${st.offSystemColors + st.offScaleSpacing === 1 ? "isn't" : "aren't"} in it`;
    lines.push(`Stories and tests: ${plural(st.files, "file")}, kept out of your system; ${what}`);
  }
  if (summary.skippedFiles.length > 0) {
    const n = summary.skippedFiles.length;
    lines.push(`Couldn't read ${plural(n, "file")}, so ${n === 1 ? "it was" : "they were"} skipped: ${summary.skippedFiles.join(", ")}`);
  }
  if (summary.tooLarge.length > 0) {
    const n = summary.tooLarge.length;
    lines.push(`Skipped ${plural(n, "file")} over 1 MB, probably generated: ${summary.tooLarge.join(", ")}`);
  }
  if (summary.linksOutside.length > 0) {
    const n = summary.linksOutside.length;
    lines.push(`Didn't follow ${plural(n, "link")} that ${n === 1 ? "points" : "point"} outside the repo or ${n === 1 ? "is" : "are"} broken: ${summary.linksOutside.join(", ")}`);
  }
  return lines;
}
