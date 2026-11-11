import { compareStrings } from "@steward/model";
import { tailwindSetup } from "../tailwind.js";
import { extractScriptColors } from "./script.js";
import { extractStylesheetColors } from "./stylesheet.js";
import { DEFINITION_SOURCES, type ColorExtraction, type ColorLocation, type ExtractedColor, type FoundColor, type SkippedFile, type SourceFile } from "./types.js";

export const SCRIPT_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"] as const;
export const STYLESHEET_EXTENSIONS = [".css", ".scss"] as const;

const isScript = (p: string) => SCRIPT_EXTENSIONS.some((e) => p.endsWith(e)) && !p.endsWith(".d.ts");
const isStylesheet = (p: string) => STYLESHEET_EXTENSIONS.some((e) => p.endsWith(e));

export function isColorSourceFile(path: string): boolean {
  return isScript(path) || isStylesheet(path) || /(^|\/)tailwind\.config\.(js|mjs|cjs)$/.test(path);
}

const compareLocations = (a: ColorLocation, b: ColorLocation) =>
  compareStrings(a.file, b.file) || a.line - b.line || compareStrings(a.raw, b.raw) || compareStrings(a.snippet, b.snippet);

/**
 * Pure: takes file contents, returns every unique color with its uses and
 * locations. Sorted by uses (most first), then value, so output is stable.
 * Files that fail to parse are listed in `skipped` instead of stopping the scan.
 */
export function collectColors(files: readonly SourceFile[]): ColorExtraction {
  const found: FoundColor[] = [];
  const skipped: SkippedFile[] = [];
  let filesScanned = 0;

  const sorted = [...files].sort((a, b) => compareStrings(a.path, b.path));
  const { theme } = tailwindSetup(sorted);
  for (const f of sorted) {
    if (!isColorSourceFile(f.path)) continue;
    filesScanned++;
    try {
      found.push(...(isStylesheet(f.path) ? extractStylesheetColors(f.content, f.path, theme) : extractScriptColors(f.content, f.path, theme)));
    } catch (err) {
      skipped.push({ file: f.path, reason: err instanceof Error ? err.message.split("\n")[0]! : String(err) });
    }
  }

  const byValue = new Map<string, { locations: ColorLocation[]; definitions: ColorLocation[] }>();
  for (const { value, ...loc } of found) {
    const entry = byValue.get(value) ?? { locations: [], definitions: [] };
    (DEFINITION_SOURCES.has(loc.source) ? entry.definitions : entry.locations).push(loc);
    byValue.set(value, entry);
  }

  const colors: ExtractedColor[] = [...byValue].map(([value, e]) => ({
    value,
    uses: e.locations.length,
    locations: e.locations.sort(compareLocations),
    definitions: e.definitions.sort(compareLocations),
  }));
  colors.sort((a, b) => b.uses - a.uses || compareStrings(a.value, b.value));

  return { colors, filesScanned, skipped };
}

/** One plain-English line, e.g. "Found 19 colors used 78 times across 16 files." */
export function summarizeColors(result: ColorExtraction): string {
  const used = result.colors.filter((c) => c.uses > 0);
  const uses = used.reduce((n, c) => n + c.uses, 0);
  const defs = result.colors.reduce((n, c) => n + c.definitions.length, 0);
  let line = `Found ${used.length} ${used.length === 1 ? "color" : "colors"} used ${uses} ${uses === 1 ? "time" : "times"} across ${result.filesScanned} files.`;
  if (defs > 0) line += ` The Tailwind config defines ${defs} ${defs === 1 ? "color" : "colors"}.`;
  if (result.skipped.length > 0) line += ` Skipped ${result.skipped.length} ${result.skipped.length === 1 ? "file" : "files"} that couldn't be parsed.`;
  return line;
}
