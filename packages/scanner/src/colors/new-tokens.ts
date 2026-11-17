/**
 * New colors on a re-scan. The first scan makes every color in use a token:
 * that's how Setup bootstraps a system. After that, a color that wasn't in
 * the system and isn't defined in the Tailwind config or a CSS variable is
 * held out, so drift never quietly becomes official. One used in 3+ places
 * is suggested as a token for a person to accept or reject; the rest stay
 * off-system, and Review flags them.
 */
import { compareStrings, STEWARD_EXTENSION, suggestionId, type MergeDecision, type TokenGroup, type TokenSuggestion } from "@steward/model";
import { isToken } from "@steward/model";
import { contrastRatio, formatRatio, REQUIRED_RATIO } from "../contrast/wcag.js";
import { nearestPassingShade } from "../contrast/fix.js";
import { proposeColorPaths } from "./naming.js";
import { colorToken } from "./suggest.js";
import type { ExtractedColor } from "./types.js";

/** How many places a new color needs before it's suggested as a token. */
export const NEW_TOKEN_MIN_USES = 3;

/** `#rrggbb`, or `#rrggbbaa` when the token has opacity: how extracted colors are written. */
function tokenHex(hex: string, alpha?: number): string {
  return alpha === undefined || alpha >= 1 ? hex.toLowerCase() : `${hex.toLowerCase()}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`;
}

/** Pure: every color a model's tokens stand for, including the values merged into them. Empty when it has no color tokens. */
export function colorsInModel(tokens: TokenGroup): string[] {
  const out = new Set<string>();
  const walk = (group: TokenGroup) => {
    for (const node of Object.values(group)) {
      if (!node || typeof node !== "object") continue;
      if (isToken(node)) {
        if (node.$type !== "color") continue;
        out.add(tokenHex(node.$value.hex, node.$value.alpha));
        for (const m of node.$extensions?.[STEWARD_EXTENSION]?.mergedFrom ?? []) out.add(m.toLowerCase());
      } else {
        walk(node as TokenGroup);
      }
    }
  };
  walk(tokens);
  return [...out].sort(compareStrings);
}

/** Pure: each color token's own color → its path (`#f9fafb` → `color.gray.50`), so a re-scan can keep the names. */
export function colorNamesInModel(tokens: TokenGroup): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (group: TokenGroup, at: string[]) => {
    for (const [k, node] of Object.entries(group)) {
      if (k.startsWith("$") || !node || typeof node !== "object") continue;
      if (isToken(node)) {
        if (node.$type === "color") out.set(tokenHex(node.$value.hex, node.$value.alpha), [...at, k].join("."));
      } else {
        walk(node as TokenGroup, [...at, k]);
      }
    }
  };
  walk(tokens, []);
  return out;
}

const tokenMembers = (decisions: readonly MergeDecision[], status: MergeDecision["status"]) =>
  new Set(decisions.filter((d) => d.kind === "token" && d.status === status).flatMap((d) => d.members));

/**
 * Pure: splits colors into those that go into the system as usual and new
 * ones held out. Without `known` (a first scan), nothing is held out.
 */
export function splitNewColors(
  colors: readonly ExtractedColor[],
  known: readonly string[] | undefined,
  decisions: readonly MergeDecision[] = [],
): { kept: ExtractedColor[]; held: ExtractedColor[] } {
  if (!known) return { kept: [...colors], held: [] };
  const inSystem = new Set([...known, ...tokenMembers(decisions, "accepted")]);
  const kept: ExtractedColor[] = [];
  const held: ExtractedColor[] = [];
  for (const c of colors) (inSystem.has(c.value) || c.definitions.length > 0 ? kept : held).push(c);
  return { kept, held };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const isTextUse = (snippet: string) => /(?:^|[\s:])text-\[/.test(snippet);

/**
 * Pure: a token suggestion for each held-out color used in
 * `NEW_TOKEN_MIN_USES`+ places, unless a person already rejected it.
 * Paths never clash with `takenPaths`. A color that fails contrast as text
 * on white says so and names the nearest shade that passes.
 */
export function suggestNewTokens(held: readonly ExtractedColor[], takenPaths: Iterable<string>, decisions: readonly MergeDecision[] = []): TokenSuggestion[] {
  const rejected = tokenMembers(decisions, "rejected");
  const candidates = held
    .filter((c) => c.uses >= NEW_TOKEN_MIN_USES && !rejected.has(c.value))
    .sort((a, b) => b.uses - a.uses || compareStrings(a.value, b.value));
  const paths = proposeColorPaths(
    candidates.map((c) => c.value),
    takenPaths,
  );
  return candidates.map((c) => {
    const files = new Set(c.locations.map((l) => l.file)).size;
    const evidence: TokenSuggestion["reason"]["evidence"] = { uses: c.uses, files, threshold: NEW_TOKEN_MIN_USES };
    let summary = `${c.value} isn't in your system yet, but it's used ${plural(c.uses, "time")} in ${plural(files, "file")}, so it may belong there.`;
    if (c.locations.some((l) => isTextUse(l.snippet))) {
      const ratio = contrastRatio(c.value, "#ffffff");
      if (ratio < REQUIRED_RATIO.text) {
        const shade = nearestPassingShade(c.value, "#ffffff", REQUIRED_RATIO.text);
        evidence["textOnWhite"] = Number(ratio.toFixed(2));
        summary += ` As text on white it's ${formatRatio(ratio)}, below the ${formatRatio(REQUIRED_RATIO.text)} text needs`;
        if (shade) {
          evidence["passingShade"] = shade.hex;
          summary += `; for text, ${shade.hex} (${formatRatio(shade.ratio)}) is the nearest shade that passes.`;
        } else {
          summary += ".";
        }
      }
    }
    return {
      id: suggestionId("token", [c.value]),
      kind: "token",
      members: [c.value],
      proposed: { path: paths.get(c.value)!, token: colorToken(c.value, c.uses) },
      reason: { summary, evidence },
      locations: c.locations
        .map((l) => ({ file: l.file, line: l.line, value: l.snippet }))
        .sort((a, b) => compareStrings(a.file, b.file) || a.line - b.line || compareStrings(a.value, b.value)),
    };
  });
}
