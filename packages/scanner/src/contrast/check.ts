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
import { pushTo } from "../collections.js";

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
  /** The proposed system: the tokens as if every waiting color merge were accepted, marked the same way. */
  preview: ProposedColorToken[];
  /** The color merge suggestions, with the same marks on their proposed tokens. */
  colorSuggestions: ColorMergeSuggestion[];
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
  const name = tokenLabel(fix.path);
  return `${bgWord ? `a ${name} background` : name} (${fix.hex}, ${ratio}), a ${direction} ${colorFamily(fix.hex)} from Tailwind's palette`;
}

/** A color token's key, with its alpha as two more hex digits when it's see-through, as extracted colors are written. */
function keyOf(token: ColorToken): string {
  const { hex, alpha } = token.$value;
  return alpha === undefined || alpha >= 1 ? hex : `${hex}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`;
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
 * A fix someone declined is still suggested: its decision keeps it from
 * waiting again, and the pair keeps showing as failing, with an Undo.
 */
export interface ContrastOptions {
  /** The Tailwind palette fixes are chosen from: the repo's version (v3 or v4). Defaults to v3. */
  palette?: Readonly<Record<string, string>>;
  /** Decisions so far: an accepted fix that isn't a token yet joins the tokens under its palette name. */
  decisions?: readonly MergeDecision[];
}

export function checkContrast(extraction: ContrastExtraction, colors: ColorSuggestions, options: ContrastOptions = {}): ContrastReport {
  // Raw color → token it belongs to.
  // Keyed with alpha (`#9ca3af80`), so a see-through token never stands in for its solid color, or the other way round.
  const tokenOf = new Map<string, ProposedColorToken>();
  // Pairs are grouped by the proposed system (`preview`), so near-duplicates count as the token they'd
  // merge into, and a pair's suggestion stays the same whether or not that merge is accepted yet.
  for (const t of colors.preview) {
    tokenOf.set(keyOf(t.token), t);
    for (const raw of t.token.$extensions?.[STEWARD_EXTENSION]?.mergedFrom ?? []) tokenOf.set(raw, t);
  }
  const canonical = (hex: string) => {
    const t = tokenOf.get(hex);
    return t ? keyOf(t.token) : hex;
  };
  const label = (hex: string) => {
    const t = tokenOf.get(hex);
    return t ? tokenLabel(t.path) : (PALETTE_NAMES.get(hex) ?? hex);
  };
  const tokenRefs = colors.preview.map((t) => ({ path: t.path, hex: t.token.$value.hex, family: colorFamily(t.token.$value.hex) }));

  // Group occurrences by token pair, and by whether each use meets its own requirement:
  // a pair can fail as text (4.5:1) and still pass as a UI border (3:1) elsewhere.
  type Group = { fg: string; bg: string; ratio: number; passes: boolean; uses: Set<ContrastUse>; locations: Map<string, PairLocation> };
  const groups = new Map<string, Group>();
  const ratios = new Map<string, number>(); // the same pair appears in many places; work out its ratio once
  for (const o of extraction.pairs) {
    const fg = canonical(o.foreground);
    const bg = canonical(o.background);
    // Same color on itself (`text-white bg-white`) is invisible: 1:1, reported like any other failure.
    const ratioKey = `${fg} ${bg}`;
    const ratio = ratios.get(ratioKey) ?? ratios.set(ratioKey, contrastRatio(fg, bg)).get(ratioKey)!;
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
    const fix = chooseFix(g.fg, g.bg, required, tokenRefs, options.palette);
    if (!fix) continue;

    const original = fix.replaces === "foreground" ? g.fg : g.bg;
    const existingToken = colors.preview.find((t) => t.path === fix.path)?.token;
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
    if (tokenOf.has(original)) pushTo(issues, original, id);
  }

  pairs.sort(
    (a, b) => Number(a.passes) - Number(b.passes) || b.places - a.places || compareStrings(a.foreground, b.foreground) || compareStrings(a.background, b.background),
  );
  suggestions.sort((a, b) => Number(b.reason.evidence.places) - Number(a.reason.evidence.places) || compareStrings(a.id, b.id));

  // An accepted fix that isn't a token yet joins the tokens, under its palette name, even before any code uses it:
  // otherwise Review would flag the very class the fix tells people to use.
  const accepted = new Set((options.decisions ?? []).filter((d) => d.kind === "contrast" && d.status === "accepted").map((d) => d.suggestionId));
  const tokens = [...colors.tokens];
  const preview = [...colors.preview];
  for (const s of suggestions) {
    if (s.proposed.existing || !accepted.has(s.id)) continue;
    const hex = s.proposed.token.$value.hex;
    if (tokens.some((t) => t.path === s.proposed.path || t.token.$value.hex === hex)) continue;
    tokens.push({ path: s.proposed.path, token: colorToken(hex, 0) });
    preview.push({ path: s.proposed.path, token: colorToken(hex, 0) });
  }

  // A color still waiting to merge is marked with the issues of the token it would merge into.
  const mark = (token: ColorToken) => withIssues(token, issues.get(canonical(keyOf(token))));
  return {
    pairs,
    suggestions,
    focus: [...extraction.focus],
    skipped: [...extraction.skipped],
    tokens: tokens.map((t) => ({ ...t, token: mark(t.token) })),
    preview: preview.map((t) => ({ ...t, token: mark(t.token) })),
    colorSuggestions: colors.suggestions.map((s) => ({ ...s, proposed: { ...s.proposed, token: mark(s.proposed.token) } })),
  };
}
