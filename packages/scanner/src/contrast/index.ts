import { compareStrings } from "@steward/model";
import { isColorSourceFile } from "../colors/collect.js";
import type { SourceFile } from "../colors/types.js";
import { listFiles, readSourceFiles } from "../colors/walk.js";
import { extractCssContrast } from "./css.js";
import { extractJsxContrast } from "./jsx.js";
import { tailwindSetup } from "../tailwind.js";
import type { ContrastExtraction, InteractionState } from "./types.js";

export * from "./types.js";
export { parseClassList, resolveColorName, type ClassListStyle, type ResolvedColor, type StateStyle, type ThemeColors } from "./classes.js";
export { checkContrast, contrastSuggestionId, summarizeContrast, tokenLabel, type CheckedPair, type ContrastOptions, type ContrastReport, type PairLocation } from "./check.js";
export { extractCssContrast } from "./css.js";
export { chooseFix, nearestPassingShade, type Fix, type Shade, type TokenRef } from "./fix.js";
export { classAlternatives, extractJsxContrast, SKIP_SEMI_TRANSPARENT, SKIP_UNKNOWN_TEXT } from "./jsx.js";
export { TAILWIND_PALETTE } from "./palette.js";
export { TAILWIND_V4_PALETTE } from "./palette-v4.js";
export { themeColorsFromConfig, type ConfigColorResolver } from "./theme.js";
export { contrastRatio, formatRatio, isLargeText, REQUIRED_RATIO } from "./wcag.js";

const STATE_ORDER: Readonly<Record<InteractionState, number>> = { base: 0, hover: 1, focus: 2 };

/**
 * Pure: finds contrast pairs and focus problems across a set of files. Theme
 * colors from any Tailwind config in the set are used to resolve classes.
 * Files that fail to parse are listed in `skipped` instead of stopping the check.
 */
export function collectContrast(files: readonly SourceFile[]): ContrastExtraction {
  const sorted = [...files].sort((a, b) => compareStrings(a.path, b.path));
  const { theme } = tailwindSetup(sorted);

  const out: ContrastExtraction = { pairs: [], focus: [], skipped: [] };
  for (const f of sorted) {
    const isJsx = f.path.endsWith(".tsx");
    const isCss = f.path.endsWith(".css") || f.path.endsWith(".scss");
    if (!isJsx && !isCss) continue;
    try {
      const r = isJsx ? extractJsxContrast(f.content, f.path, theme) : extractCssContrast(f.content, f.path);
      out.pairs.push(...r.pairs);
      out.focus.push(...r.focus);
      out.skipped.push(...r.skipped);
    } catch (err) {
      out.skipped.push({ file: f.path, line: 0, reason: `couldn't parse the file: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}` });
    }
  }
  // Files are already in order; keep each file's own ordering.
  const byFile = (a: { file: string }, b: { file: string }) => compareStrings(a.file, b.file);
  out.pairs.sort((a, b) => byFile(a, b) || a.line - b.line || STATE_ORDER[a.state] - STATE_ORDER[b.state]);
  out.focus.sort((a, b) => byFile(a, b) || a.line - b.line);
  out.skipped.sort((a, b) => byFile(a, b) || a.line - b.line || compareStrings(a.reason, b.reason));
  return out;
}

/** Walks a repo and finds contrast pairs and focus problems. The only part that touches the disk. */
export async function extractContrast(repoRoot: string): Promise<ContrastExtraction> {
  const paths = await listFiles(repoRoot, isColorSourceFile);
  return collectContrast(await readSourceFiles(repoRoot, paths));
}
