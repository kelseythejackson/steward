import { isColorSourceFile } from "../colors/collect.js";
import { listFiles, readSourceFiles } from "../colors/walk.js";
import { collectSpacing } from "./collect.js";
import type { SpacingExtraction } from "./types.js";

export * from "./types.js";
export { lengthPx, MIN_SPACING_PX, parseSpacingClass, type SpacingClass } from "./classes.js";
export { collectSpacing } from "./collect.js";
export { extractCssSpacing } from "./css.js";
export { DEFAULT_SPACING_SCALE, normalizeScale, snapToScale, spacingTokenPath, type Snap } from "./scale.js";
export { extractScriptSpacing } from "./script.js";
export {
  suggestSpacingScale,
  summarizeSpacingSuggestions,
  type ProposedSpacingToken,
  type SpacingSuggestionOptions,
  type SpacingSuggestions,
} from "./suggest.js";

/** Walks a repo and returns every spacing value it uses. The only part that touches the disk. */
export async function extractSpacing(repoRoot: string): Promise<SpacingExtraction> {
  const paths = await listFiles(repoRoot, isColorSourceFile);
  return collectSpacing(await readSourceFiles(repoRoot, paths));
}
