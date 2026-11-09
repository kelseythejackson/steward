import { collectColors, isColorSourceFile } from "./collect.js";
import type { ColorExtraction } from "./types.js";
import { listFiles, readSourceFiles } from "./walk.js";

export * from "./types.js";
export { clusterColors, DEFAULT_MAX_DELTA_E, deltaE, type ClusterOptions, type ColorCluster } from "./cluster.js";
export { collectColors, isColorSourceFile, summarizeColors } from "./collect.js";
export { colorFamily, GRAY_MAX_CHROMA, LIGHTNESS_STEPS, proposeColorPaths, stepsByFit } from "./naming.js";
export {
  colorToken,
  JUST_NOTICEABLE_DELTA_E,
  mergeReasonSummary,
  suggestColorTokens,
  summarizeColorSuggestions,
  type ColorSuggestionOptions,
  type ColorSuggestions,
  type ProposedColorToken,
} from "./suggest.js";
export { findArbitraryClassColors, findColors, normalizeColor } from "./normalize.js";
export { extractScriptColors, isTailwindConfig } from "./script.js";
export { extractStylesheetColors } from "./stylesheet.js";
export { IGNORED_DIRS, listFiles } from "./walk.js";

/** Walks a repo and returns every color it uses. The only part of the extractor that touches the disk. */
export async function extractColors(repoRoot: string): Promise<ColorExtraction> {
  const paths = await listFiles(repoRoot, isColorSourceFile);
  return collectColors(await readSourceFiles(repoRoot, paths));
}
