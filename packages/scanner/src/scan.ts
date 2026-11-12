import {
  compareStrings,
  emptySystemModel,
  STEWARD_EXTENSION,
  isToken,
  type MergeDecision,
  type Rule,
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
import { SKIP_SEMI_TRANSPARENT, SKIP_TOO_MANY, SKIP_UNKNOWN_TEXT, SKIP_VARIANTS } from "./contrast/jsx.js";
import { collectContrast } from "./contrast/index.js";
import { collectSpacing } from "./spacing/collect.js";
import { suggestSpacingScale, type SpacingSuggestions } from "./spacing/suggest.js";
import type { SpacingExtraction } from "./spacing/types.js";
import { generateRules, mergeRules } from "./rules/generate.js";
import { tailwindSetup } from "./tailwind.js";

export interface ScanOptions {
  /** Past decisions, so rejected suggestions are never made again. */
  decisions?: readonly MergeDecision[];
  /** Rules already in the model. Generated ones are rebuilt; the rest are kept as they are. */
  rules?: readonly Rule[];
}

/** Everything one scan found and suggested. Plain data, safe to print as JSON. */
export interface ScanResult {
  /** Distinct files read (TS/TSX/JS, CSS and Tailwind config), repo-relative and sorted. */
  files: string[];
  /** Files not read at all, with why (e.g. over 1 MB, so probably generated). */
  notRead: SkippedFile[];
  /** Symlinks not followed because they point outside the repo or are broken, repo-relative. */
  linksOutside: string[];
  /** The decisions the scan honored, so the summary can show what people chose to keep. */
  decisions: MergeDecision[];
  colors: ColorExtraction;
  spacing: SpacingExtraction;
  spacingSuggestions: SpacingSuggestions;
  components: ComponentInventory;
  duplicates: DuplicateReport;
  /** Contrast report. Its `tokens` and `colorSuggestions` are the color suggestions with contrast marks applied. */
  contrast: ContrastReport;
  /** The system's rules: starter rules from this scan merged with the ones already in the model. */
  rules: Rule[];
  /**
   * Stories and tests, scanned on their own. They never shape the system
   * (tokens, merges, the scale, component usage); this says what in them
   * isn't in it.
   */
  storiesAndTests: {
    files: string[];
    colors: ColorExtraction;
    spacing: SpacingExtraction;
    /** Colors used in stories and tests that aren't a token or merged into one. */
    offSystemColors: string[];
    /** Spacing values in stories and tests that aren't on the suggested scale, in px. */
    offScaleSpacing: number[];
  };
}

/** Storybook stories and tests: `*.stories.tsx`, `*.test.ts`, `*.spec.tsx`, and anything under `__tests__/` or `.storybook/`. */
export function isStoryOrTest(path: string): boolean {
  return /\.(?:stories|story|test|spec)\.[cm]?[jt]sx?$/.test(path) || /(?:^|\/)(?:__tests__|__stories__|\.storybook)\//.test(path);
}

/** A color token's canonical key, including alpha, so it compares with extracted values. */
function tokenKey(t: { token: { $value: { hex: string; alpha?: number } } }): string {
  const { hex, alpha } = t.token.$value;
  return alpha === undefined ? hex : `${hex}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`;
}

/**
 * `basics`: the accessibility rules every system starts with.
 * `fromAccepted`: generated from suggestions a person accepted.
 * `yours`: written by a person or learned. `off`: turned off by a person.
 */
export interface RuleSummary {
  total: number;
  basics: number;
  fromAccepted: number;
  yours: number;
  off: number;
}

/** Pure: the counts behind the report's rules line. */
export function summarizeRules(rules: readonly Rule[]): RuleSummary {
  return {
    total: rules.length,
    basics: rules.filter((r) => r.source === "generated" && !r.basedOn?.length).length,
    fromAccepted: rules.filter((r) => r.source === "generated" && (r.basedOn?.length ?? 0) > 0).length,
    yours: rules.filter((r) => r.source !== "generated").length,
    off: rules.filter((r) => !r.enabled).length,
  };
}

/** Counts behind the printed report, so the CLI and web app say the same thing. */
export interface ScanSummary {
  filesScanned: number;
  /** One row per color family that has merges, most colors first. */
  colorFamilies: { family: string; found: number; suggested: number }[];
  /** `keptApart`: rejected merges whose colors are still in the code, kept separate as decided. */
  colors: { found: number; suggested: number; merges: number; keptApart: number };
  /** `kept`: off-scale values a person chose to keep. `sizes`: distinct widths and heights, not checked yet. */
  spacing: { found: number; scaleSteps: number; scaleBasis: SpacingSuggestions["scaleBasis"]; snapping: number; beyondScale: number; kept: number; sizes: number };
  /** `similar`: pairs that look alike but behave differently, so aren't flagged. `keptApart`: rejected merges still present. */
  components: { found: number; duplicateGroups: number; duplicateComponents: number; similar: number; keptApart: number };
  /**
   * Pairs are distinct foreground/background combinations, counted once even
   * if they pass in one place and fail in another. `fixDeclined`: failing
   * pairs whose fix a person rejected; they still fail. `assumedWhite`:
   * failing pairs where at least one place had no background in its file.
   * `notCheckable` places split by why. `variantsNotChecked`: places whose
   * base colors were checked but whose `dark:`/`disabled:` colors weren't.
   */
  accessibility: {
    pairsChecked: number;
    failingPairs: number;
    fixesSuggested: number;
    fixDeclined: number;
    noFixFound: number;
    assumedWhite: number;
    focusProblems: number;
    notCheckable: { total: number; textSetElsewhere: number; semiTransparent: number; tooManyCombinations: number; other: number };
    variantsNotChecked: number;
  };
  rules: RuleSummary;
  /** Stories and tests: how many, and what in them isn't in the system. They never shape it. */
  storiesAndTests: { files: number; offSystemColors: number; offScaleSpacing: number };
  /** Files at least one extractor couldn't parse. */
  skippedFiles: string[];
  /** Files left out before parsing because they're too big to be hand-written. */
  tooLarge: string[];
  /** Symlinks not followed because they point outside the repo or are broken. */
  linksOutside: string[];
}

const isScanned = (path: string) => isColorSourceFile(path) || isComponentFile(path);

/** Pure: runs every extractor and suggester over a set of files. */
export function scanFiles(files: readonly SourceFile[], options: ScanOptions = {}): ScanResult {
  const decisions = options.decisions ?? [];
  const all = [...files].sort((a, b) => compareStrings(a.path, b.path));
  const sorted = all.filter((f) => !isStoryOrTest(f.path));
  const stories = all.filter((f) => isStoryOrTest(f.path));
  // Stories use the product's Tailwind config and CSS, so read the setup from every file.
  const setup = tailwindSetup(all);

  const colors = collectColors(sorted, setup.theme);
  const spacing = collectSpacing(sorted, setup.version, setup.rootPx);
  const components = collectComponents(sorted);
  const contrastPairs = collectContrast(sorted);

  const colorSuggestions = suggestColorTokens(colors.colors, { decisions });
  const spacingSuggestions = suggestSpacingScale(spacing.values, { decisions, rootPx: setup.rootPx });
  const contrast = checkContrast(contrastPairs, colorSuggestions, { decisions });

  const storyColors = collectColors(stories, setup.theme);
  const storySpacing = collectSpacing(stories, setup.version, setup.rootPx);
  const inSystem = new Set(contrast.tokens.flatMap((t) => [tokenKey(t), ...(t.token.$extensions?.[STEWARD_EXTENSION]?.mergedFrom ?? [])]));
  const onScale = new Set(spacingSuggestions.scale);
  const duplicates = findDuplicates(components.components, { decisions });
  const generated = generateRules({
    decisions,
    suggestions: [...contrast.colorSuggestions, ...spacingSuggestions.suggestions, ...duplicates.suggestions, ...contrast.suggestions],
    colorTokens: contrast.tokens,
    spacingTokens: spacingSuggestions.tokens,
    components: componentEntries(components.components),
  });
  return {
    files: sorted.map((f) => f.path),
    notRead: [],
    linksOutside: [],
    decisions: [...decisions],
    colors,
    spacing,
    spacingSuggestions,
    components,
    duplicates,
    contrast,
    rules: mergeRules(generated, options.rules ?? [], decisions),
    storiesAndTests: {
      files: stories.map((f) => f.path),
      colors: storyColors,
      spacing: storySpacing,
      offSystemColors: storyColors.colors.filter((c) => c.uses > 0 && !inSystem.has(c.value)).map((c) => c.value).sort(compareStrings),
      offScaleSpacing: storySpacing.values.filter((v) => !onScale.has(v.px)).map((v) => v.px),
    },
  };
}

/** Walks a repo and scans it. The only part that touches the disk. */
export async function scanRepo(repoRoot: string, options: ScanOptions = {}): Promise<ScanResult> {
  const linksOutside: string[] = [];
  const { files, skipped } = await readRepoFiles(repoRoot, await listFiles(repoRoot, isScanned, linksOutside));
  return { ...scanFiles(files, options), notRead: skipped, linksOutside };
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
 * Pure: builds the system model from a scan. Tokens, components,
 * suggestions and rules come from the scan (pass the previous rules to it
 * as `options.rules`); decisions are kept from the previous model, so a
 * re-scan never forgets what a person decided.
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
  model.rules = result.rules;
  if (previous) model.decisions = previous.decisions;
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
  const variantPlaces = contrast.skipped.filter((s) => s.reason === SKIP_VARIANTS).length;
  const places = contrast.skipped.filter((s) => s.line !== 0 && s.reason !== SKIP_VARIANTS);
  const textSetElsewhere = places.filter((s) => s.reason === SKIP_UNKNOWN_TEXT).length;
  const semiTransparent = places.filter((s) => s.reason === SKIP_SEMI_TRANSPARENT).length;
  const tooManyCombinations = places.filter((s) => s.reason === SKIP_TOO_MANY).length;

  // Rejected merges still relevant: at least two of their members are still in the code.
  const stillPresent = (kind: "color" | "component", present: Set<string>) =>
    result.decisions.filter((d) => d.kind === kind && d.status === "rejected" && d.members.filter((m) => present.has(m)).length >= 2).length;
  const componentLabels = new Set(components.components.flatMap((c) => [c.name, `${c.name} (${c.file})`]));

  const skippedFiles = [
    ...new Set([...colors.skipped, ...spacing.skipped, ...components.skipped, ...result.storiesAndTests.colors.skipped].map((s) => s.file).concat(
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
      scaleBasis: spacingSuggestions.scaleBasis,
      snapping,
      beyondScale: spacingSuggestions.beyondScale.length,
      kept: spacingSuggestions.kept.length,
      sizes: spacing.sizes.length,
    },
    components: {
      found: components.components.length,
      duplicateGroups: duplicates.suggestions.length,
      duplicateComponents: duplicates.suggestions.reduce((n, s) => n + s.members.length, 0),
      similar: duplicates.similar.length,
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
      notCheckable: {
        total: places.length,
        textSetElsewhere,
        semiTransparent,
        tooManyCombinations,
        other: places.length - textSetElsewhere - semiTransparent - tooManyCombinations,
      },
      variantsNotChecked: variantPlaces,
    },
    rules: summarizeRules(result.rules),
    storiesAndTests: {
      files: result.storiesAndTests.files.length,
      offSystemColors: result.storiesAndTests.offSystemColors.length,
      offScaleSpacing: result.storiesAndTests.offScaleSpacing.length,
    },
    skippedFiles,
    tooLarge: result.notRead.map((s) => s.file),
    linksOutside: result.linksOutside,
  };
}
