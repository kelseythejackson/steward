import { compareStrings } from "@steward/model";
import { isColorSourceFile } from "../colors/collect.js";
import type { SourceFile } from "../colors/types.js";
import { rootPxOf, tailwindVersion, type TailwindVersion } from "../tailwind.js";
import { extractCssSpacing } from "./css.js";
import { extractScriptSpacing } from "./script.js";
import type { ExtractedSpacing, FoundSpacing, SpacingExtraction, SpacingLocation } from "./types.js";
import { pushTo } from "../collections.js";

const isStylesheet = (p: string) => p.endsWith(".css") || p.endsWith(".scss");

const compareLocations = (a: SpacingLocation, b: SpacingLocation) =>
  compareStrings(a.file, b.file) || a.line - b.line || compareStrings(a.raw, b.raw) || compareStrings(a.property, b.property);

function group(found: readonly FoundSpacing[]): ExtractedSpacing[] {
  const byPx = new Map<number, SpacingLocation[]>();
  for (const { px, category: _category, ...loc } of found) pushTo(byPx, px, loc);
  return [...byPx]
    .map(([px, locations]) => ({ px, uses: locations.length, locations: locations.sort(compareLocations) }))
    .sort((a, b) => a.px - b.px);
}

/**
 * Pure: takes file contents, returns every spacing value with its uses and
 * locations, smallest first. Widths and heights are kept apart as sizes.
 * Files that fail to parse are listed in `skipped` instead of stopping the scan.
 */
/**
 * `version` and `rootPx` default to what's found in `files`; pass them when
 * scanning a subset (like stories) without the CSS entry point.
 */
export function collectSpacing(files: readonly SourceFile[], version?: TailwindVersion, rootPx?: number): SpacingExtraction {
  const found: FoundSpacing[] = [];
  const skipped: SpacingExtraction["skipped"] = [];
  let filesScanned = 0;
  const sorted = [...files].sort((a, b) => compareStrings(a.path, b.path));
  const tw = version ?? tailwindVersion(sorted);
  const root = rootPx ?? rootPxOf(sorted);
  for (const f of sorted) {
    if (!isColorSourceFile(f.path)) continue;
    filesScanned++;
    try {
      found.push(...(isStylesheet(f.path) ? extractCssSpacing(f.content, f.path, tw, root) : extractScriptSpacing(f.content, f.path, tw, root)));
    } catch (err) {
      skipped.push({ file: f.path, reason: err instanceof Error ? err.message.split("\n")[0]! : String(err) });
    }
  }
  return {
    values: group(found.filter((f) => f.category === "spacing")),
    sizes: group(found.filter((f) => f.category === "size")),
    filesScanned,
    skipped,
    rootPx: root,
  };
}
