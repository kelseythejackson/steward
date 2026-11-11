import { listFiles, readSourceFiles } from "../colors/walk.js";
import { collectComponents, isComponentFile } from "./inventory.js";
import type { ComponentInventory } from "./types.js";

export * from "./types.js";
export {
  compareComponents,
  findDuplicates,
  MAX_BEHAVIOR_DIFFERENCES,
  MIN_CLASS_OVERLAP,
  MIN_SIGNALS,
  type ComponentComparison,
  type DuplicateOptions,
  type DuplicateReport,
  type Signal,
  type SimilarComponents,
} from "./duplicates.js";
export { collectComponents, inventoryFile, isComponentFile, nameFromFile } from "./inventory.js";
export { baseWord, nameWords } from "./names.js";
export { classPattern, classPatterns, patternOverlap } from "./patterns.js";
export { componentEntries } from "./summary.js";

/** Walks a repo and lists its React components. The only part that touches the disk. */
export async function extractComponents(repoRoot: string): Promise<ComponentInventory> {
  const paths = await listFiles(repoRoot, isComponentFile);
  return collectComponents(await readSourceFiles(repoRoot, paths));
}
