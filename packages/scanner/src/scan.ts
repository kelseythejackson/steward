import {
  compareStrings,
  emptySystemModel,
  isToken,
  type MergeDecision,
  type Suggestion,
  type SystemModel,
  type Token,
  type TokenGroup,
} from "@steward/model";
import { collectColors, isColorSourceFile } from "./colors/collect.js";
import { colorFamily } from "./colors/naming.js";
import { suggestColorTokens } from "./colors/suggest.js";
import type { ColorExtraction, SourceFile } from "./colors/types.js";
import { listFiles, readSourceFiles } from "./colors/walk.js";
import { findDuplicates, type DuplicateReport } from "./components/duplicates.js";
import { collectComponents, isComponentFile } from "./components/inventory.js";
import { componentEntries } from "./components/summary.js";
import type { ComponentInventory } from "./components/types.js";
import { checkContrast, type ContrastReport } from "./contrast/check.js";
import { collectContrast } from "./contrast/index.js";
import { collectSpacing } from "./spacing/collect.js";
import { suggestSpacingScale, type SpacingSuggestions } from "./spacing/suggest.js";
import type { SpacingExtraction } from "./spacing/types.js";

export interface ScanOptions {
  /** Past decisions, so rejected suggestions are never made again. */
  decisions?: readonly MergeDecision[];
}

/** Everything one scan found and suggested. Plain data, safe to print as JSON. */
export interface ScanResult {
  /** Distinct files read (TS/TSX/JS, CSS and Tailwind config), repo-relative and sorted. */
  files: string[];
  colors: ColorExtraction;
  spacing: SpacingExtraction;
  spacingSuggestions: SpacingSuggestions;
  components: ComponentInventory;
  duplicates: DuplicateReport;
  /** Contrast report. Its `tokens` and `colorSuggestions` are the color suggestions with contrast marks applied. */
  contrast: ContrastReport;
}

/** Counts behind the printed report, so the CLI and web app say the same thing. */
export interface ScanSummary {
  filesScanned: number;
  /** One row per color family that has merges, most colors first. */
  colorFamilies: { family: string; found: number; suggested: number }[];
  colors: { found: number; suggested: number; merges: number };
  spacing: { found: number; scaleSteps: number; snapping: number; beyondScale: number };
  components: { found: number; duplicateGroups: number; duplicateComponents: number };
  accessibility: { pairsChecked: number; failingPairs: number; fixesSuggested: number; focusProblems: number; notCheckable: number };
  /** Files at least one extractor couldn't read. */
  skippedFiles: string[];
}

const isScanned = (path: string) => isColorSourceFile(path) || isComponentFile(path);

/** Pure: runs every extractor and suggester over a set of files. */
export function scanFiles(files: readonly SourceFile[], options: ScanOptions = {}): ScanResult {
  const decisions = options.decisions ?? [];
  const sorted = [...files].sort((a, b) => compareStrings(a.path, b.path));

  const colors = collectColors(sorted);
  const spacing = collectSpacing(sorted);
  const components = collectComponents(sorted);
  const contrastPairs = collectContrast(sorted);

  const colorSuggestions = suggestColorTokens(colors.colors, { decisions });
  return {
    files: sorted.map((f) => f.path),
    colors,
    spacing,
    spacingSuggestions: suggestSpacingScale(spacing.values, { decisions }),
    components,
    duplicates: findDuplicates(components.components, { decisions }),
    contrast: checkContrast(contrastPairs, colorSuggestions, { decisions }),
  };
}

/** Walks a repo and scans it. The only part that touches the disk. */
export async function scanRepo(repoRoot: string, options: ScanOptions = {}): Promise<ScanResult> {
  const paths = await listFiles(repoRoot, isScanned);
  return scanFiles(await readSourceFiles(repoRoot, paths), options);
}

/** Puts a token at a dot-separated path, e.g. `color.gray.500`. */
function setToken(group: TokenGroup, path: string, token: Token): void {
  const parts = path.split(".");
  let node = group;
  for (const part of parts.slice(0, -1)) {
    const next = node[part];
    if (next !== undefined && isToken(next)) throw new Error(`Token path ${path} runs through the token ${part}`);
    node = (next as TokenGroup | undefined) ?? (node[part] = {});
  }
  const leaf = parts[parts.length - 1]!;
  if (node[leaf] !== undefined) throw new Error(`Two tokens share the path ${path}`);
  node[leaf] = token;
}

/**
 * Pure: builds the system model from a scan. Tokens, components and
 * suggestions come from the scan; decisions and rules are kept from the
 * previous model, so a re-scan never forgets what a person decided.
 */
export function buildSystemModel(result: ScanResult, previous: SystemModel | null = null): SystemModel {
  const model = emptySystemModel();
  for (const t of result.contrast.tokens) setToken(model.tokens, t.path, t.token);
  for (const t of result.spacingSuggestions.tokens) setToken(model.tokens, t.path, t.token);
  model.components = componentEntries(result.components.components);
  const suggestions: Suggestion[] = [
    ...result.contrast.colorSuggestions,
    ...result.spacingSuggestions.suggestions,
    ...result.duplicates.suggestions,
    ...result.contrast.suggestions,
  ];
  model.suggestions = suggestions;
  if (previous) {
    model.decisions = previous.decisions;
    model.rules = previous.rules;
  }
  return model;
}

/** Pure: the counts behind the scan report. */
export function summarizeScan(result: ScanResult): ScanSummary {
  const { colors, spacing, spacingSuggestions, components, duplicates, contrast } = result;

  const families = new Map<string, { found: number; suggested: number }>();
  const row = (family: string) => families.get(family) ?? families.set(family, { found: 0, suggested: 0 }).get(family)!;
  for (const c of colors.colors) row(colorFamily(c.value)).found++;
  for (const t of contrast.tokens) row(colorFamily(t.token.$value.hex)).suggested++;
  const colorFamilies = [...families]
    .filter(([, r]) => r.found > r.suggested)
    .map(([family, r]) => ({ family, ...r }))
    .sort((a, b) => b.found - a.found || compareStrings(a.family, b.family));

  const snapping = spacingSuggestions.suggestions.reduce(
    (n, s) => n + s.members.filter((m) => m !== `${s.proposed.token.$value.value}px`).length,
    0,
  );

  const skippedFiles = [
    ...new Set([...colors.skipped, ...spacing.skipped, ...components.skipped].map((s) => s.file).concat(
      contrast.skipped.filter((s) => s.line === 0).map((s) => s.file),
    )),
  ].sort(compareStrings);

  return {
    filesScanned: result.files.length,
    colorFamilies,
    colors: { found: colors.colors.length, suggested: contrast.tokens.length, merges: contrast.colorSuggestions.length },
    spacing: {
      found: spacing.values.length,
      scaleSteps: spacingSuggestions.scale.length,
      snapping,
      beyondScale: spacingSuggestions.beyondScale.length,
    },
    components: {
      found: components.components.length,
      duplicateGroups: duplicates.suggestions.length,
      duplicateComponents: duplicates.suggestions.reduce((n, s) => n + s.members.length, 0),
    },
    accessibility: {
      pairsChecked: contrast.pairs.length,
      failingPairs: contrast.pairs.filter((p) => !p.passes).length,
      fixesSuggested: contrast.suggestions.length,
      focusProblems: contrast.focus.length,
      notCheckable: contrast.skipped.filter((s) => s.line !== 0).length,
    },
    skippedFiles,
  };
}
