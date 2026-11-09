import {
  compareStrings,
  STEWARD_EXTENSION,
  suggestionId,
  type ColorMergeSuggestion,
  type ColorToken,
  type ContrastSuggestion,
  type ContrastUse,
  type MergeDecision,
} from "@steward/model";
import { converter, parse } from "culori";
import { colorFamily } from "../colors/naming.js";
import { colorToken, type ColorSuggestions, type ProposedColorToken } from "../colors/suggest.js";
import { chooseFix, type Fix } from "./fix.js";
import { TAILWIND_PALETTE } from "./palette.js";
import type { ContrastExtraction, ContrastSkip, FocusFinding, InteractionState } from "./types.js";
import { contrastRatio, floorTo, formatRatio, REQUIRED_RATIO, USE_STRICTNESS } from "./wcag.js";

export interface PairLocation {
  file: string;
  line: number;
  state: InteractionState;
  component?: string;
  backgroundAssumed: boolean;
}

/** One foreground/background token pair and every place it's used. */
export interface CheckedPair {
  foreground: string;
  background: string;
  /** The strictest way the pair is used. */
  use: ContrastUse;
  ratio: number;
  required: number;
  passes: boolean;
  /** Distinct file:line places. */
  places: number;
  files: string[];
  /** Places where no background was set in the same file, so white was assumed. */
  backgroundAssumed: number;
  locations: PairLocation[];
}

export interface ContrastReport {
  /** Every pair found, failing first. */
  pairs: CheckedPair[];
  suggestions: ContrastSuggestion[];
  focus: FocusFinding[];
  skipped: ContrastSkip[];
  /** The color tokens, with `contrastIssues` set on any that fail. */
  tokens: ProposedColorToken[];
  /** The color merge suggestions, with the same marks on their proposed tokens. */
  colorSuggestions: ColorMergeSuggestion[];
}

export interface ContrastOptions {
  /** Past decisions. A rejected contrast fix is not suggested again (the pair is still reported). */
  decisions?: readonly MergeDecision[];
}

/** Stable id: the same pair always gets the same id, and swapping foreground and background gives a different one. */
export function contrastSuggestionId(foreground: string, background: string): string {
  return suggestionId("contrast", [`foreground ${foreground}`, `background ${background}`]);
}

const USE_PHRASE: Readonly<Record<ContrastUse, string>> = {
  text: "normal text needs",
  "large-text": "large text needs",
  ui: "form borders and icons need",
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const toOklch = converter("oklch");
const lightness = (hex: string) => toOklch(parse(hex)!).l;

/** Palette names by hex, so non-token colors read as `red-600`. First name alphabetically wins. */
const PALETTE_NAMES = new Map<string, string>();
for (const name of Object.keys(TAILWIND_PALETTE).sort(compareStrings)) {
  const hex = TAILWIND_PALETTE[name]!;
  if (!PALETTE_NAMES.has(hex)) PALETTE_NAMES.set(hex, name);
}

/** `color.gray.400` → `gray-400`, `color.white` → `white`. */
export function tokenLabel(path: string): string {
  return path.replace(/^color\./, "").replaceAll(".", "-");
}

function fixPhrase(fix: Fix, original: string): string {
  const ratio = formatRatio(fix.ratio);
  const bgWord = fix.replaces === "background";
  if (fix.existing) {
    const name = tokenLabel(fix.path);
    return `${bgWord ? `a ${name} background` : name} (${fix.hex}, ${ratio}), already in your system`;
  }
  const direction = lightness(fix.hex) < lightness(original) ? "darker" : "lighter";
  return `${bgWord ? `a ${fix.hex} background` : fix.hex} (${ratio}), a ${direction} ${colorFamily(fix.hex)} in the same hue`;
}

function withIssues(token: ColorToken, ids: readonly string[] | undefined): ColorToken {
  if (!ids || ids.length === 0) return token;
  const ext = token.$extensions?.[STEWARD_EXTENSION] ?? {};
  return {
    ...token,
    $extensions: { ...token.$extensions, [STEWARD_EXTENSION]: { ...ext, contrastIssues: [...ids].sort(compareStrings) } },
  };
}

/**
 * Pure: checks every color pair against WCAG AA, using the proposed tokens
 * (so near-duplicates are checked as the token they merge into). Each failing
 * pair gets a suggestion with the nearest passing alternative and a plain
 * reason. Failing tokens are marked so they aren't made official as they are.
 */
export function checkContrast(extraction: ContrastExtraction, colors: ColorSuggestions, options: ContrastOptions = {}): ContrastReport {
  const decisions = options.decisions ?? [];

  // Raw color → token it belongs to.
  const tokenOf = new Map<string, ProposedColorToken>();
  for (const t of colors.tokens) {
    tokenOf.set(t.token.$value.hex, t);
    for (const raw of t.token.$extensions?.[STEWARD_EXTENSION]?.mergedFrom ?? []) tokenOf.set(raw, t);
  }
  const canonical = (hex: string) => tokenOf.get(hex)?.token.$value.hex ?? hex;
  const label = (hex: string) => {
    const t = tokenOf.get(hex);
    return t ? tokenLabel(t.path) : (PALETTE_NAMES.get(hex) ?? hex);
  };
  const tokenRefs = colors.tokens.map((t) => ({ path: t.path, hex: t.token.$value.hex }));

  // Group occurrences by token pair, and by whether each use meets its own requirement:
  // a pair can fail as text (4.5:1) and still pass as a UI border (3:1) elsewhere.
  type Group = { fg: string; bg: string; ratio: number; passes: boolean; uses: Set<ContrastUse>; locations: Map<string, PairLocation> };
  const groups = new Map<string, Group>();
  for (const o of extraction.pairs) {
    const fg = canonical(o.foreground);
    const bg = canonical(o.background);
    if (fg === bg) continue;
    const ratio = contrastRatio(fg, bg);
    const passes = ratio >= REQUIRED_RATIO[o.use];
    const key = `${fg} ${bg} ${passes}`;
    const g = groups.get(key) ?? { fg, bg, ratio, passes, uses: new Set(), locations: new Map() };
    g.uses.add(o.use);
    const locKey = `${o.file}:${o.line}:${o.state}`;
    const prev = g.locations.get(locKey);
    const loc: PairLocation = { file: o.file, line: o.line, state: o.state, backgroundAssumed: o.backgroundAssumed || (prev?.backgroundAssumed ?? false) };
    if (o.component !== undefined) loc.component = o.component;
    g.locations.set(locKey, loc);
    groups.set(key, g);
  }

  const pairs: CheckedPair[] = [];
  const suggestions: ContrastSuggestion[] = [];
  const issues = new Map<string, string[]>(); // token hex → suggestion ids

  for (const g of groups.values()) {
    const use = USE_STRICTNESS.find((u) => g.uses.has(u))!;
    const required = REQUIRED_RATIO[use];
    const ratio = g.ratio;
    const locations = [...g.locations.values()].sort(
      (a, b) => compareStrings(a.file, b.file) || a.line - b.line || compareStrings(a.state, b.state),
    );
    const placeKeys = new Map<string, boolean>();
    for (const l of locations) placeKeys.set(`${l.file}:${l.line}`, (placeKeys.get(`${l.file}:${l.line}`) ?? false) || l.backgroundAssumed);
    const files = [...new Set(locations.map((l) => l.file))].sort(compareStrings);
    const assumed = [...placeKeys.values()].filter(Boolean).length;
    const pair: CheckedPair = {
      foreground: g.fg,
      background: g.bg,
      use,
      ratio: floorTo(ratio, 2),
      required,
      passes: g.passes,
      places: placeKeys.size,
      files,
      backgroundAssumed: assumed,
      locations,
    };
    pairs.push(pair);
    if (pair.passes) continue;

    const id = contrastSuggestionId(g.fg, g.bg);
    if (decisions.some((d) => d.kind === "contrast" && d.status === "rejected" && d.suggestionId === id)) continue;
    const fix = chooseFix(g.fg, g.bg, required, tokenRefs);
    if (!fix) continue;

    const original = fix.replaces === "foreground" ? g.fg : g.bg;
    const existingToken = colors.tokens.find((t) => t.path === fix.path)?.token;
    let summary =
      `${label(g.fg)} on ${label(g.bg)} is ${formatRatio(ratio)}; ${USE_PHRASE[use]} ${required}:1. ` +
      `Used together in ${plural(pair.places, "place")} across ${plural(files.length, "file")}. ` +
      `Suggest ${fixPhrase(fix, original)}.`;
    if (assumed > 0) summary += ` White background assumed in ${assumed} of these places (set by a parent component).`;

    suggestions.push({
      id,
      kind: "contrast",
      members: [g.fg, g.bg].sort(compareStrings),
      pair: { foreground: g.fg, background: g.bg, use },
      proposed: {
        replaces: fix.replaces,
        path: fix.path,
        token: existingToken && fix.existing ? existingToken : colorToken(fix.hex, 0),
        ratio: floorTo(fix.ratio, 2),
        existing: fix.existing,
      },
      reason: {
        summary,
        evidence: {
          ratio: pair.ratio,
          required,
          places: pair.places,
          files: files.length,
          fixRatio: floorTo(fix.ratio, 2),
          backgroundAssumed: assumed,
        },
      },
    });
    if (tokenOf.has(original)) issues.set(original, [...(issues.get(original) ?? []), id]);
  }

  pairs.sort(
    (a, b) => Number(a.passes) - Number(b.passes) || b.places - a.places || compareStrings(a.foreground, b.foreground) || compareStrings(a.background, b.background),
  );
  suggestions.sort((a, b) => Number(b.reason.evidence.places) - Number(a.reason.evidence.places) || compareStrings(a.id, b.id));

  const mark = (token: ColorToken) => withIssues(token, issues.get(token.$value.hex));
  return {
    pairs,
    suggestions,
    focus: [...extraction.focus],
    skipped: [...extraction.skipped],
    tokens: colors.tokens.map((t) => ({ ...t, token: mark(t.token) })),
    colorSuggestions: colors.suggestions.map((s) => ({ ...s, proposed: { ...s.proposed, token: mark(s.proposed.token) } })),
  };
}

/** Plain-English summary, e.g. "Checked 31 color pairs: 9 fail WCAG AA. 2 elements have no visible focus style." */
export function summarizeContrast(report: ContrastReport): string {
  const failing = report.pairs.filter((p) => !p.passes).length;
  let line = `Checked ${plural(report.pairs.length, "color pair")}: ${failing === 0 ? "all pass" : `${failing} ${failing === 1 ? "fails" : "fail"}`} WCAG AA.`;
  if (report.focus.length > 0) line += ` ${plural(report.focus.length, "element")} ${report.focus.length === 1 ? "has" : "have"} no visible focus style.`;
  if (report.skipped.length > 0) line += ` ${plural(report.skipped.length, "place")} couldn't be checked statically.`;
  return line;
}
