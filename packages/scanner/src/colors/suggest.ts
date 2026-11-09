import {
  compareStrings,
  STEWARD_EXTENSION,
  suggestionId,
  type ColorMergeSuggestion,
  type ColorToken,
  type MergeDecision,
} from "@steward/model";
import { converter, formatHex, parse } from "culori";
import { clusterColors, DEFAULT_MAX_DELTA_E, type ColorCluster } from "./cluster.js";
import { colorFamily, proposeColorPaths } from "./naming.js";
import type { ExtractedColor } from "./types.js";

/** Roughly the smallest ΔEOK × 100 people notice side by side. Below it we can honestly say "less than you can see". */
export const JUST_NOTICEABLE_DELTA_E = 2;

const toRgb = converter("rgb");
const round = (n: number, places: number) => Number(n.toFixed(places));

export interface ColorSuggestionOptions {
  /** Merge threshold in ΔEOK × 100. Defaults to `DEFAULT_MAX_DELTA_E` (1.0). */
  maxDeltaE?: number;
  /** Past decisions. Rejected merges are never suggested again; their colors get their own tokens. */
  decisions?: readonly MergeDecision[];
}

export interface ProposedColorToken {
  path: string;
  token: ColorToken;
}

export interface ColorSuggestions {
  /** One token per group, merged or not. Sorted by uses (most first), then path. */
  tokens: ProposedColorToken[];
  /** Only groups with two or more colors. Sorted by uses (most first), then id. */
  suggestions: ColorMergeSuggestion[];
}

export function colorToken(hex: string, uses: number, mergedFrom: readonly string[] = []): ColorToken {
  const parsed = parse(hex);
  if (!parsed) throw new Error(`Not a color: ${hex}`);
  const rgb = toRgb(parsed);
  const token: ColorToken = {
    $type: "color",
    $value: {
      colorSpace: "srgb",
      components: [round(rgb.r, 4), round(rgb.g, 4), round(rgb.b, 4)],
      hex: formatHex(parsed),
    },
    $extensions: {
      [STEWARD_EXTENSION]: mergedFrom.length > 0 ? { uses, mergedFrom: [...mergedFrom].sort(compareStrings) } : { uses },
    },
  };
  if (parsed.alpha !== undefined && parsed.alpha < 1) token.$value.alpha = round(parsed.alpha, 4);
  return token;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "0.3", or "under 0.1" so a tiny difference never prints as "0.0". */
const formatDeltaE = (d: number) => (d < 0.05 ? "under 0.1" : d.toFixed(1));

/** e.g. "These 3 blues differ by less than you can see (ΔE 0.3). Used 12 times in 7 files." */
export function mergeReasonSummary(cluster: ColorCluster, family: string): string {
  const what = `These ${cluster.members.length} ${family}s`;
  const closeness =
    cluster.maxDeltaE < JUST_NOTICEABLE_DELTA_E
      ? `differ by less than you can see (ΔE ${formatDeltaE(cluster.maxDeltaE)})`
      : `are very close (ΔE ${formatDeltaE(cluster.maxDeltaE)})`;
  return `${what} ${closeness}. Used ${plural(cluster.uses, "time")} in ${plural(cluster.files.length, "file")}.`;
}

function isRejected(members: readonly string[], decisions: readonly MergeDecision[]): boolean {
  const id = suggestionId("color", members);
  const key = [...members].sort(compareStrings).join(",");
  return decisions.some(
    (d) =>
      d.kind === "color" &&
      d.status === "rejected" &&
      (d.suggestionId === id || [...d.members].sort(compareStrings).join(",") === key),
  );
}

/** Splits a rejected group back into one group per color. */
function singleton(color: ExtractedColor): ColorCluster {
  const files = [...new Set(color.locations.map((l) => l.file))].sort(compareStrings);
  return { value: color.value, members: [color], uses: color.uses, files, maxDeltaE: 0 };
}

/**
 * Pure: clusters near-duplicate colors and proposes one token per group,
 * plus a merge suggestion (with its reason) for every group of two or more.
 * Nothing is applied: suggestions wait for a person to accept them.
 */
export function suggestColorTokens(colors: readonly ExtractedColor[], options: ColorSuggestionOptions = {}): ColorSuggestions {
  const maxDeltaE = options.maxDeltaE ?? DEFAULT_MAX_DELTA_E;
  const decisions = options.decisions ?? [];

  const clusters = clusterColors(colors, { maxDeltaE })
    .flatMap((c) => (c.members.length > 1 && isRejected(c.members.map((m) => m.value), decisions) ? c.members.map(singleton) : [c]))
    .sort((a, b) => b.uses - a.uses || compareStrings(a.value, b.value));

  // Most-used groups get first pick of names.
  const paths = proposeColorPaths(clusters.map((c) => c.value));

  const tokens: ProposedColorToken[] = [];
  const suggestions: ColorMergeSuggestion[] = [];
  for (const cluster of clusters) {
    const path = paths.get(cluster.value)!;
    const memberValues = cluster.members.map((m) => m.value);
    const mergedFrom = memberValues.filter((v) => v !== cluster.value);
    const token = colorToken(cluster.value, cluster.uses, mergedFrom);
    tokens.push({ path, token });
    if (cluster.members.length < 2) continue;

    suggestions.push({
      id: suggestionId("color", memberValues),
      kind: "color",
      members: [...memberValues].sort(compareStrings),
      proposed: { path, token },
      reason: {
        summary: mergeReasonSummary(cluster, colorFamily(cluster.value)),
        evidence: {
          keep: cluster.value,
          maxDeltaE: round(cluster.maxDeltaE, 2),
          threshold: maxDeltaE,
          uses: cluster.uses,
          files: cluster.files.length,
        },
      },
    });
  }

  tokens.sort((a, b) => tokenUses(b) - tokenUses(a) || compareStrings(a.path, b.path));
  suggestions.sort((a, b) => Number(b.reason.evidence.uses) - Number(a.reason.evidence.uses) || compareStrings(a.id, b.id));
  return { tokens, suggestions };
}

const tokenUses = (t: ProposedColorToken) => t.token.$extensions?.[STEWARD_EXTENSION]?.uses ?? 0;

/** One plain-English line, e.g. "Found 19 colors → suggest 13 tokens (6 merges)." */
export function summarizeColorSuggestions(colorCount: number, result: ColorSuggestions): string {
  return `Found ${plural(colorCount, "color")} → suggest ${plural(result.tokens.length, "token")} (${plural(result.suggestions.length, "merge")}).`;
}
