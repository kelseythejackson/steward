import { compareStrings } from "@steward/model";
import { converter, differenceEuclidean, parse } from "culori";
import { keptApart, MinHeap } from "../collections.js";
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
const toOklab = converter("oklab");

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

  // Convert once: OKLab coordinates and alpha per color, so the n² distances are plain arithmetic.
  const lab = sorted.map((c) => {
    const parsed = parse(c.value);
    const o = parsed ? toOklab(parsed) : undefined;
    return o ? { l: o.l, a: o.a, b: o.b, alpha: parsed!.alpha ?? 1 } : null;
  });
  const distance = (i: number, j: number): number => {
    const x = lab[i];
    const y = lab[j];
    if (!x || !y || Math.abs(x.alpha - y.alpha) > ALPHA_TOLERANCE) return Infinity;
    return Math.sqrt((x.l - y.l) ** 2 + (x.a - y.a) ** 2 + (x.b - y.b) ** 2) * 100;
  };

  // Only pairs within the threshold can ever merge, so the group distances are kept sparse:
  // a missing entry means "too far" (or kept apart by a person's decision).
  const near: Map<number, number>[] = sorted.map(() => new Map());
  type Candidate = { d: number; i: number; j: number; vi: number; vj: number };
  // Smallest distance first; ties go to the lowest (i, j), the same order a full scan would find them in.
  const heap = new MinHeap<Candidate>((x, y) => x.d < y.d || (x.d === y.d && (x.i < y.i || (x.i === y.i && x.j < y.j))));
  const version = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = distance(i, j);
      if (!(d <= threshold) || apart(sorted[i]!.value, sorted[j]!.value)) continue;
      near[i]!.set(j, d);
      near[j]!.set(i, d);
      heap.push({ d, i, j, vi: 0, vj: 0 });
    }
  }

  const groups: (number[] | null)[] = sorted.map((_, i) => [i]);
  for (let c = heap.pop(); c; c = heap.pop()) {
    if (version[c.i] !== c.vi || version[c.j] !== c.vj) continue; // a group changed since this pair was queued
    const { i, j } = c;
    groups[i] = [...groups[i]!, ...groups[j]!];
    groups[j] = null;
    version[i]!++;
    version[j]!++;
    // Complete linkage: the merged group's distance to k is the larger of the two; if either is too far, so is the group.
    const merged = new Map<number, number>();
    for (const [k, di] of near[i]!) {
      if (k === j) continue;
      const dj = near[j]!.get(k);
      near[k]!.delete(i);
      near[k]!.delete(j);
      if (dj === undefined) continue;
      const d = Math.max(di, dj);
      merged.set(k, d);
      near[k]!.set(i, d);
    }
    for (const k of near[j]!.keys()) near[k]!.delete(j);
    near[i] = merged;
    near[j] = new Map();
    for (const [k, d] of merged) heap.push(i < k ? { d, i, j: k, vi: version[i]!, vj: version[k]! } : { d, i: k, j: i, vi: version[k]!, vj: version[i]! });
  }

  const clusters = groups
    .filter((g): g is number[] => g !== null)
    .map((indexes): ColorCluster => {
      const members = indexes.map((i) => sorted[i]!).sort(compareColors);
      let maxDeltaE = 0;
      for (const a of indexes) for (const b of indexes) if (a < b) maxDeltaE = Math.max(maxDeltaE, distance(a, b));
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
