import { compareStrings } from "@steward/model";
import { isColorSourceFile } from "../colors/collect.js";
import type { SourceFile } from "../colors/types.js";
import { extractCssSpacing } from "./css.js";
import { extractScriptSpacing } from "./script.js";
import type { ExtractedSpacing, FoundSpacing, SpacingExtraction, SpacingLocation } from "./types.js";

const isStylesheet = (p: string) => p.endsWith(".css") || p.endsWith(".scss");

const compareLocations = (a: SpacingLocation, b: SpacingLocation) =>
  compareStrings(a.file, b.file) || a.line - b.line || compareStrings(a.raw, b.raw) || compareStrings(a.property, b.property);

function group(found: readonly FoundSpacing[]): ExtractedSpacing[] {
  const byPx = new Map<number, SpacingLocation[]>();
  for (const { px, category: _category, ...loc } of found) byPx.set(px, [...(byPx.get(px) ?? []), loc]);
  return [...byPx]
    .map(([px, locations]) => ({ px, uses: locations.length, locations: locations.sort(compareLocations) }))
    .sort((a, b) => a.px - b.px);
}

/**
 * Pure: takes file contents, returns every spacing value with its uses and
 * locations, smallest first. Widths and heights are kept apart as sizes.
 * Files that fail to parse are listed in `skipped` instead of stopping the scan.
 */
export function collectSpacing(files: readonly SourceFile[]): SpacingExtraction {
  const found: FoundSpacing[] = [];
  const skipped: SpacingExtraction["skipped"] = [];
  let filesScanned = 0;
  for (const f of [...files].sort((a, b) => compareStrings(a.path, b.path))) {
    if (!isColorSourceFile(f.path)) continue;
    filesScanned++;
    try {
      found.push(...(isStylesheet(f.path) ? extractCssSpacing(f.content, f.path) : extractScriptSpacing(f.content, f.path)));
    } catch (err) {
      skipped.push({ file: f.path, reason: err instanceof Error ? err.message.split("\n")[0]! : String(err) });
    }
  }
  return {
    values: group(found.filter((f) => f.category === "spacing")),
    sizes: group(found.filter((f) => f.category === "size")),
    filesScanned,
    skipped,
  };
}
