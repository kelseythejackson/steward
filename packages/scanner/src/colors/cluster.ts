import { compareStrings } from "@steward/model";
import { differenceEuclidean, parse } from "culori";
import { keptApart } from "../collections.js";
import type { ExtractedColor } from "./types.js";

/**
 * Default merge threshold, in ΔEOK × 100 (Euclidean distance in OKLab, × 100).
 * On this scale, about 2 is the smallest difference most people notice side by side.
 * Chosen against fixtures/messy-app: every planted near-duplicate is under 0.9,
 * and the closest pair that should stay apart (#fafafa vs #ffffff) is 1.49.
 */
export const DEFAULT_MAX_DELTA_E = 1.0;

/** Colors whose alpha differs by more than this never merge. */
const ALPHA_TOLERANCE = 0.01;

const oklabDistance = differenceEuclidean("oklab");

/** ΔEOK × 100 between two colors. Returns Infinity if either can't be parsed or their alpha differs. */
export function deltaE(a: string, b: string): number {
  const ca = parse(a);
  const cb = parse(b);
  if (!ca || !cb) return Infinity;
  if (Math.abs((ca.alpha ?? 1) - (cb.alpha ?? 1)) > ALPHA_TOLERANCE) return Infinity;
  return oklabDistance(ca, cb) * 100;
}

export interface ColorCluster {
  /** The color to keep: the most-used member (ties go to the lower hex). */
  value: string;
  /** Members sorted by uses (most first), then value. Includes `value`. */
  members: ExtractedColor[];
  /** Total uses across all members. */
  uses: number;
  /** Distinct files the members are used in, sorted. */
  files: string[];
  /** Largest ΔE between any two members. 0 for a single color. */
  maxDeltaE: number;
}

export interface ClusterOptions {
  /** Merge threshold in ΔEOK × 100. Defaults to `DEFAULT_MAX_DELTA_E`. */
  maxDeltaE?: number;
  /**
   * Sets of colors a person decided to keep apart (rejected merges). No two
   * colors from the same set ever end up in one group, however close they are
   * and whatever other colors join later.
   */
  keepApart?: readonly (readonly string[])[];
}

const compareColors = (a: ExtractedColor, b: ExtractedColor) => b.uses - a.uses || compareStrings(a.value, b.value);

/**
 * Pure: groups near-identical colors. Uses complete linkage, so every pair
 * inside a group is within the threshold. That stops chains like
 * #ffffff ≈ #fafafa ≈ #f4f4f5 ≈ #f3f4f6 from collapsing into one group even
 * though the two ends are clearly different.
 *
 * Sorted by total uses (most first), then value.
 */
export function clusterColors(colors: readonly ExtractedColor[], options: ClusterOptions = {}): ColorCluster[] {
  const threshold = options.maxDeltaE ?? DEFAULT_MAX_DELTA_E;
  const apart = keptApart(options.keepApart ?? []);
  const sorted = [...colors].sort(compareColors);
  const n = sorted.length;

  // Pairwise distances, then group-to-group distances (complete linkage = max).
  const dist: number[][] = sorted.map((a) => sorted.map((b) => (a === b ? 0 : deltaE(a.value, b.value))));
  // Kept-apart pairs are infinitely far for grouping, so complete linkage never joins them; `dist` keeps the real ΔE for reporting.
  const groupDist = dist.map((row, i) => row.map((d, j) => (apart(sorted[i]!.value, sorted[j]!.value) ? Infinity : d)));
  const groups: (number[] | null)[] = sorted.map((_, i) => [i]);

  for (;;) {
    let best: [number, number] | null = null;
    let bestD = Infinity;
    // Index order is fixed by `sorted`, and ties keep the first pair found, so the result is deterministic.
    for (let i = 0; i < n; i++) {
      if (!groups[i]) continue;
      for (let j = i + 1; j < n; j++) {
        if (!groups[j]) continue;
        const d = groupDist[i]![j]!;
        if (d < bestD) {
          bestD = d;
          best = [i, j];
        }
      }
    }
    if (!best || !(bestD <= threshold)) break;

    const [i, j] = best;
    groups[i] = [...groups[i]!, ...groups[j]!];
    groups[j] = null;
    for (let k = 0; k < n; k++) {
      const d = Math.max(groupDist[i]![k]!, groupDist[j]![k]!);
      groupDist[i]![k] = d;
      groupDist[k]![i] = d;
    }
  }

  const clusters = groups
    .filter((g): g is number[] => g !== null)
    .map((indexes): ColorCluster => {
      const members = indexes.map((i) => sorted[i]!).sort(compareColors);
      let maxDeltaE = 0;
      for (const a of indexes) for (const b of indexes) maxDeltaE = Math.max(maxDeltaE, dist[a]![b]!);
      const files = [...new Set(members.flatMap((m) => m.locations.map((l) => l.file)))].sort(compareStrings);
      return {
        value: members[0]!.value,
        members,
        uses: members.reduce((sum, m) => sum + m.uses, 0),
        files,
        maxDeltaE,
      };
    });

  return clusters.sort((a, b) => b.uses - a.uses || compareStrings(a.value, b.value));
}
