import {
  compareStrings,
  STEWARD_EXTENSION,
  suggestionId,
  type ColorMergeSuggestion,
  type ColorToken,
  type MergeDecision,
} from "@steward/model";
import { converter, formatHex, parse } from "culori";
import { clusterColors, DEFAULT_MAX_DELTA_E, deltaE, type ColorCluster } from "./cluster.js";
import { colorFamily, proposeColorPaths } from "./naming.js";
import type { ExtractedColor } from "./types.js";

/** Roughly the smallest ΔEOK × 100 people notice side by side. Below it we can honestly say "less than you can see". */
export const JUST_NOTICEABLE_DELTA_E = 2;

const toRgb = converter("rgb");
const round = (n: number, places: number) => Number(n.toFixed(places));

export interface ColorSuggestionOptions {
  /** Merge threshold in ΔEOK × 100. Defaults to `DEFAULT_MAX_DELTA_E` (1.0). */
  maxDeltaE?: number;
  /**
   * Past decisions. Colors in a rejected merge are never grouped together
   * again, even if the group would change; each can still merge with others.
   */
  decisions?: readonly MergeDecision[];
  /**
   * The names colors already had (hex → token path, from the previous
   * model). A color that was a token keeps its name on every scan, so code
   * using `bg-gray-50` never silently points at a different color.
   */
  previousNames?: ReadonlyMap<string, string>;
}

export interface ProposedColorToken {
  path: string;
  token: ColorToken;
}

export interface ColorSuggestions {
  /**
   * The tokens as decided: one per merged group a person accepted (or arranged), and one per color
   * for merges still waiting or declined. Sorted by uses (most first), then path.
   */
  tokens: ProposedColorToken[];
  /**
   * One token per group as if every waiting merge were accepted: the proposed system. Contrast is
   * checked against this, so a pair's suggestion (and a person's decision on it) doesn't change
   * when a merge is accepted later. Sorted like `tokens`.
   */
  preview: ProposedColorToken[];
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

/**
 * Each group keeps the name its color had before: its kept color's name
 * first, else a member's (most-used first). A name goes to one group only;
 * names already taken (a person's choice) are skipped.
 */
function keepPreviousNames(clusters: readonly ColorCluster[], previous: ReadonlyMap<string, string>, taken: ReadonlySet<string>): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Set(taken);
  // Own names first, so a color that was a token keeps its name even if another group held it as a merged member.
  for (const pass of ["own", "member"] as const) {
    for (const c of clusters) {
      if (out.has(c.value)) continue;
      const candidates = pass === "own" ? [c.value] : c.members.map((m) => m.value);
      const name = candidates.map((v) => previous.get(v)).find((p) => p !== undefined && !used.has(p));
      if (name) {
        out.set(c.value, name);
        used.add(name);
      }
    }
  }
  return out;
}

/**
 * Color groups a person arranged themselves (accepted, edited decisions),
 * built from the colors still in the code. The most-used member is kept.
 */
function pinnedGroups(colors: readonly ExtractedColor[], decisions: readonly MergeDecision[]): { cluster: ColorCluster; path: string }[] {
  const byValue = new Map(colors.map((c) => [c.value, c]));
  const out: { cluster: ColorCluster; path: string }[] = [];
  for (const d of decisions) {
    // Groups a person arranged, and new colors a person accepted as tokens: both keep exactly their colors and name.
    const pinned = d.status === "accepted" && !!d.path && ((d.kind === "color" && d.edited) || d.kind === "token");
    if (!pinned || !d.path) continue;
    const members = d.members
      .map((m) => byValue.get(m.toLowerCase()))
      .filter((c): c is ExtractedColor => c !== undefined)
      .sort((a, b) => b.uses - a.uses || compareStrings(a.value, b.value));
    if (members.length === 0) continue;
    let maxDeltaE = 0;
    // A person can group colors Steward wouldn't (even a see-through one with a solid one): only finite distances count.
    for (const a of members) for (const b of members) if (a.value < b.value && Number.isFinite(deltaE(a.value, b.value))) maxDeltaE = Math.max(maxDeltaE, deltaE(a.value, b.value));
    const files = [...new Set(members.flatMap((m) => m.locations.map((l) => l.file)))].sort(compareStrings);
    out.push({ cluster: { value: members[0]!.value, members, uses: members.reduce((n, m) => n + m.uses, 0), files, maxDeltaE }, path: d.path });
  }
  return out;
}

/** Colors in a rejected merge stay apart for good, even when new near-duplicates appear later. */
const rejectedSets = (decisions: readonly MergeDecision[]) => decisions.filter((d) => d.kind === "color" && d.status === "rejected").map((d) => d.members);

/**
 * Pure: clusters near-duplicate colors and proposes one token per group,
 * plus a merge suggestion (with its reason) for every group of two or more.
 * Nothing is applied: suggestions wait for a person to accept them.
 */
export function suggestColorTokens(colors: readonly ExtractedColor[], options: ColorSuggestionOptions = {}): ColorSuggestions {
  const maxDeltaE = options.maxDeltaE ?? DEFAULT_MAX_DELTA_E;
  const decisions = options.decisions ?? [];

  // Groups a person arranged (moved swatches, renamed) stay exactly as they are, under their name.
  const pinned = pinnedGroups(colors, decisions);
  const pinnedValues = new Set(pinned.flatMap((p) => p.cluster.members.map((m) => m.value)));
  const clustered = clusterColors(
    colors.filter((c) => !pinnedValues.has(c.value)),
    { maxDeltaE, keepApart: rejectedSets(decisions) },
  );
  const clusters = [...pinned.map((p) => p.cluster), ...clustered];

  // Names a person chose come first, then names colors already had, then new names
  // for the rest (most-used groups get first pick).
  const chosen = new Map(pinned.map((p) => [p.cluster.value, p.path]));
  const kept = keepPreviousNames(clustered, options.previousNames ?? new Map(), new Set(chosen.values()));
  const fresh = clustered.filter((c) => !kept.has(c.value)).map((c) => c.value);
  const paths = new Map([...chosen, ...kept, ...proposeColorPaths(fresh, [...chosen.values(), ...kept.values()])]);

  // A merge applies only once a person accepts it (or arranged the group themselves). Until then each
  // color in it stays its own token, and the suggestion shows the merged token as a preview.
  const acceptedIds = new Set(decisions.filter((d) => d.kind === "color" && d.status === "accepted").map((d) => d.suggestionId));
  const applies = (cluster: ColorCluster) =>
    cluster.members.length < 2 || chosen.has(cluster.value) || acceptedIds.has(suggestionId("color", cluster.members.map((m) => m.value)));
  const unmerged = clusters
    .filter((c) => !applies(c))
    .flatMap((c) => c.members.filter((m) => m.value !== c.value))
    .sort((a, b) => b.uses - a.uses || compareStrings(a.value, b.value));
  const ownNames = new Map<string, string>();
  {
    const taken = new Set(paths.values());
    // A color keeps the name it had as its own token before, if that name is still free.
    for (const m of unmerged) {
      const before = options.previousNames?.get(m.value);
      if (before && !taken.has(before)) {
        ownNames.set(m.value, before);
        taken.add(before);
      }
    }
    // Otherwise its hex, not a nearby Tailwind step: `text-gray-600` renders Tailwind's own gray-600,
    // which isn't this color. It's a name for the time being, until the merge is decided.
    for (const m of unmerged.filter((x) => !ownNames.has(x.value))) {
      const family = colorFamily(m.value);
      const single = family === "white" || family === "black";
      const nested = `color.${family}.${m.value.slice(1)}`;
      const clashes = (p: string) => taken.has(p) || [...taken].some((t) => t.startsWith(`${p}.`) || p.startsWith(`${t}.`));
      const path = !single && !clashes(nested) ? nested : `color.${family}-${m.value.slice(1)}`;
      ownNames.set(m.value, path);
      taken.add(path);
    }
  }

  const tokens: ProposedColorToken[] = [];
  const preview: ProposedColorToken[] = [];
  const suggestions: ColorMergeSuggestion[] = [];
  for (const cluster of clusters) {
    const path = paths.get(cluster.value)!;
    const memberValues = cluster.members.map((m) => m.value);
    const mergedFrom = memberValues.filter((v) => v !== cluster.value);
    const token = colorToken(cluster.value, cluster.uses, mergedFrom);
    preview.push({ path, token });
    if (applies(cluster)) {
      tokens.push({ path, token });
    } else {
      for (const m of cluster.members) tokens.push({ path: m.value === cluster.value ? path : ownNames.get(m.value)!, token: colorToken(m.value, m.uses) });
    }
    if (cluster.members.length < 2) continue;

    const byPerson = chosen.has(cluster.value);
    suggestions.push({
      id: suggestionId("color", memberValues),
      kind: "color",
      members: [...memberValues].sort(compareStrings),
      proposed: { path, token },
      reason: {
        summary: byPerson
          ? `You grouped these ${cluster.members.length} colors as one token. Used ${plural(cluster.uses, "time")} in ${plural(cluster.files.length, "file")}.`
          : mergeReasonSummary(cluster, colorFamily(cluster.value)),
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
  preview.sort((a, b) => tokenUses(b) - tokenUses(a) || compareStrings(a.path, b.path));
  suggestions.sort((a, b) => Number(b.reason.evidence.uses) - Number(a.reason.evidence.uses) || compareStrings(a.id, b.id));
  return { tokens, preview, suggestions };
}

const tokenUses = (t: ProposedColorToken) => t.token.$extensions?.[STEWARD_EXTENSION]?.uses ?? 0;
