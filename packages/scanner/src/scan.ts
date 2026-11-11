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
import type { ColorExtraction, SkippedFile, SourceFile } from "./colors/types.js";
import { listFiles, readRepoFiles } from "./colors/walk.js";
import { findDuplicates, type DuplicateReport } from "./components/duplicates.js";
import { collectComponents, isComponentFile } from "./components/inventory.js";
import { componentEntries } from "./components/summary.js";
import type { ComponentInventory } from "./components/types.js";
import { checkContrast, contrastSuggestionId, type ContrastReport } from "./contrast/check.js";
import { SKIP_SEMI_TRANSPARENT, SKIP_UNKNOWN_TEXT } from "./contrast/jsx.js";
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
  /** Files not read at all, with why (e.g. over 1 MB, so probably generated). */
  notRead: SkippedFile[];
  /** The decisions the scan honored, so the summary can show what people chose to keep. */
  decisions: MergeDecision[];
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
  /** `keptApart`: rejected merges whose colors are still in the code, kept separate as decided. */
  colors: { found: number; suggested: number; merges: number; keptApart: number };
  /** `kept`: off-scale values a person chose to keep. */
  spacing: { found: number; scaleSteps: number; snapping: number; beyondScale: number; kept: number };
  /** `keptApart`: rejected component merges still present, kept separate as decided. */
  components: { found: number; duplicateGroups: number; duplicateComponents: number; keptApart: number };
  /**
   * Pairs are distinct foreground/background combinations, counted once even
   * if they pass in one place and fail in another. `fixDeclined`: failing
   * pairs whose fix a person rejected; they still fail. `assumedWhite`:
   * failing pairs where at least one place had no background in its file.
   * `notCheckable` places split by why.
   */
  accessibility: {
    pairsChecked: number;
    failingPairs: number;
    fixesSuggested: number;
    fixDeclined: number;
    noFixFound: number;
    assumedWhite: number;
    focusProblems: number;
    notCheckable: { total: number; textSetElsewhere: number; semiTransparent: number; other: number };
  };
  /** Files at least one extractor couldn't parse. */
  skippedFiles: string[];
  /** Files left out before parsing because they're too big to be hand-written. */
  tooLarge: string[];
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
    notRead: [],
    decisions: [...decisions],
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
  const { files, skipped } = await readRepoFiles(repoRoot, await listFiles(repoRoot, isScanned));
  return { ...scanFiles(files, options), notRead: skipped };
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

  // Distinct pairs: the checker keeps a pair's passing and failing uses apart, so count each combination once.
  const pairKey = (p: { foreground: string; background: string }) => `${p.foreground} ${p.background}`;
  const failing = contrast.pairs.filter((p) => !p.passes);
  const failingKeys = new Set(failing.map(pairKey));
  const declinedIds = new Set(result.decisions.filter((d) => d.kind === "contrast" && d.status === "rejected").map((d) => d.suggestionId));
  const fixDeclined = [...failingKeys].filter((k) => declinedIds.has(contrastSuggestionId(...(k.split(" ") as [string, string])))).length;
  const places = contrast.skipped.filter((s) => s.line !== 0);
  const textSetElsewhere = places.filter((s) => s.reason === SKIP_UNKNOWN_TEXT).length;
  const semiTransparent = places.filter((s) => s.reason === SKIP_SEMI_TRANSPARENT).length;

  // Rejected merges still relevant: at least two of their members are still in the code.
  const stillPresent = (kind: "color" | "component", present: Set<string>) =>
    result.decisions.filter((d) => d.kind === kind && d.status === "rejected" && d.members.filter((m) => present.has(m)).length >= 2).length;
  const componentLabels = new Set(components.components.flatMap((c) => [c.name, `${c.name} (${c.file})`]));

  const skippedFiles = [
    ...new Set([...colors.skipped, ...spacing.skipped, ...components.skipped].map((s) => s.file).concat(
      contrast.skipped.filter((s) => s.line === 0).map((s) => s.file),
    )),
  ].sort(compareStrings);

  return {
    filesScanned: result.files.length,
    colorFamilies,
    colors: {
      found: colors.colors.length,
      suggested: contrast.tokens.length,
      merges: contrast.colorSuggestions.length,
      keptApart: stillPresent("color", new Set(colors.colors.map((c) => c.value))),
    },
    spacing: {
      found: spacing.values.length,
      scaleSteps: spacingSuggestions.scale.length,
      snapping,
      beyondScale: spacingSuggestions.beyondScale.length,
      kept: spacingSuggestions.kept.length,
    },
    components: {
      found: components.components.length,
      duplicateGroups: duplicates.suggestions.length,
      duplicateComponents: duplicates.suggestions.reduce((n, s) => n + s.members.length, 0),
      keptApart: stillPresent("component", componentLabels),
    },
    accessibility: {
      pairsChecked: new Set(contrast.pairs.map(pairKey)).size,
      failingPairs: failingKeys.size,
      fixesSuggested: contrast.suggestions.length,
      fixDeclined,
      noFixFound: failingKeys.size - contrast.suggestions.length - fixDeclined,
      assumedWhite: new Set(failing.filter((p) => p.backgroundAssumed > 0).map(pairKey)).size,
      focusProblems: contrast.focus.length,
      notCheckable: { total: places.length, textSetElsewhere, semiTransparent, other: places.length - textSetElsewhere - semiTransparent },
    },
    skippedFiles,
    tooLarge: result.notRead.map((s) => s.file),
  };
}
