import {
  compareStrings,
  STEWARD_EXTENSION,
  suggestionId,
  type DimensionToken,
  type MergeDecision,
  type SpacingMergeSuggestion,
  type UsageLocation,
} from "@steward/model";
import { deriveSpacingScale, normalizeScale, snapToScale, spacingTokenPath } from "./scale.js";
import type { ExtractedSpacing, SpacingExtraction } from "./types.js";
import { pushTo } from "../collections.js";

export interface SpacingSuggestionOptions {
  /** Scale steps in px. By default the scale is built from the repo's own values (see `deriveSpacingScale`). */
  scale?: readonly number[];
  /** Past decisions. A rejected snap is never suggested again. */
  decisions?: readonly MergeDecision[];
}

export interface ProposedSpacingToken {
  /** e.g. `spacing.4` */
  path: string;
  token: DimensionToken;
}

export interface SpacingSuggestions {
  scale: number[];
  /**
   * Where the scale came from: `repo` (the standard Tailwind values used 2+
   * times), `default` (too few to build one) or `custom` (passed in).
   */
  scaleBasis: "repo" | "default" | "custom";
  /** One token per scale step, smallest first. */
  tokens: ProposedSpacingToken[];
  /** One per step that has off-scale values snapping to it, smallest step first. */
  suggestions: SpacingMergeSuggestion[];
  /** Larger than the largest step, so not snapped. */
  beyondScale: ExtractedSpacing[];
  /** Off the scale, but a person rejected snapping them. */
  kept: ExtractedSpacing[];
}

const px = (n: number) => `${n}px`;
const times = (n: number) => (n === 1 ? "once" : `${n} times`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (xs: readonly string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/**
 * Values a person refused to snap to `step`. A rejection sticks to each value,
 * so a new off-scale value joining the step later doesn't bring them back.
 */
function rejectedFor(step: number, decisions: readonly MergeDecision[]): Set<string> {
  const out = new Set<string>();
  for (const d of decisions) {
    if (d.kind !== "spacing" || d.status !== "rejected" || !d.members.includes(px(step))) continue;
    for (const m of d.members) if (m !== px(step)) out.add(m);
  }
  return out;
}

function dimensionToken(value: number, uses: number, mergedFrom: readonly string[]): DimensionToken {
  const ext = mergedFrom.length > 0 ? { uses, mergedFrom: [...mergedFrom] } : { uses };
  return { $type: "dimension", $value: { value, unit: "px" }, $extensions: { [STEWARD_EXTENSION]: ext } };
}

interface Snapping {
  value: ExtractedSpacing;
  distance: number;
  /** The step below, when the value sits exactly halfway and rounded up. */
  halfwayFrom?: number;
}

/** e.g. "7px and 9px are 1px from 8px, the nearest step on the scale. Used 4 times in 3 files. 8px is already used once." */
function reasonSummary(step: number, snapping: readonly Snapping[], uses: number, files: number, alreadyUsed: number): string {
  const values = snapping.map((s) => px(s.value.px));
  const distances = [...new Set(snapping.map((s) => s.distance))].sort((a, b) => a - b);
  const distance = distances.length === 1 ? px(distances[0]!) : `${distances[0]}–${px(distances[distances.length - 1]!)}`;
  let out = `${list(values)} ${values.length === 1 ? "is" : "are"} ${distance} from ${px(step)}, the nearest step on the scale.`;
  for (const s of snapping) {
    if (s.halfwayFrom !== undefined) out += ` ${px(s.value.px)} is halfway between ${px(s.halfwayFrom)} and ${px(step)}, so it rounds up to the larger step.`;
  }
  out += ` Used ${times(uses)} in ${plural(files, "file")}.`;
  if (alreadyUsed > 0) out += ` ${px(step)} is already used ${times(alreadyUsed)}.`;
  return out;
}

/**
 * Pure: proposes a spacing scale (one token per step) and, for each step,
 * a suggestion listing the off-scale values that would snap to it, why, and
 * where they're used. Nothing is applied: a person accepts or rejects each one.
 */
export function suggestSpacingScale(values: readonly ExtractedSpacing[], options: SpacingSuggestionOptions = {}): SpacingSuggestions {
  const derived = options.scale ? { scale: [...options.scale], basis: "custom" as const } : deriveSpacingScale(values);
  const scale = normalizeScale(derived.scale);
  const decisions = options.decisions ?? [];
  const sorted = [...values].sort((a, b) => a.px - b.px);

  const onScale = new Map<number, number>();
  const snapsTo = new Map<number, Snapping[]>();
  const beyondScale: ExtractedSpacing[] = [];
  for (const v of sorted) {
    const snap = snapToScale(v.px, scale);
    if (snap.kind === "on-scale") onScale.set(snap.step, (onScale.get(snap.step) ?? 0) + v.uses);
    else if (snap.kind === "beyond-scale") beyondScale.push(v);
    else {
      const s: Snapping = { value: v, distance: snap.distance };
      if (snap.halfway) s.halfwayFrom = v.px - snap.distance;
      pushTo(snapsTo, snap.step, s);
    }
  }

  const tokens: ProposedSpacingToken[] = [];
  const suggestions: SpacingMergeSuggestion[] = [];
  const kept: ExtractedSpacing[] = [];
  for (const step of scale) {
    const path = spacingTokenPath(step);
    const alreadyUsed = onScale.get(step) ?? 0;
    const rejected = rejectedFor(step, decisions);
    const all = snapsTo.get(step) ?? [];
    kept.push(...all.filter((s) => rejected.has(px(s.value.px))).map((s) => s.value));
    const snapping = all.filter((s) => !rejected.has(px(s.value.px)));
    const members = [...snapping.map((s) => px(s.value.px)), px(step)].sort(compareStrings);
    const snappedUses = snapping.reduce((n, s) => n + s.value.uses, 0);
    const mergedFrom = snapping.map((s) => px(s.value.px));
    tokens.push({ path, token: dimensionToken(step, alreadyUsed + snappedUses, mergedFrom) });
    if (snapping.length === 0) continue;

    const seen = new Set<string>();
    const locations: UsageLocation[] = [];
    for (const l of snapping.flatMap((s) => s.value.locations)) {
      const key = `${l.file}\n${l.line}\n${l.raw}`;
      if (seen.has(key)) continue;
      seen.add(key);
      locations.push({ file: l.file, line: l.line, value: l.raw });
    }
    locations.sort((a, b) => compareStrings(a.file, b.file) || a.line - b.line || compareStrings(a.value, b.value));
    const files = new Set(locations.map((l) => l.file)).size;
    const maxDistance = Math.max(...snapping.map((s) => s.distance));

    suggestions.push({
      id: suggestionId("spacing", members),
      kind: "spacing",
      members,
      proposed: { path, token: tokens[tokens.length - 1]!.token },
      locations,
      reason: {
        summary: reasonSummary(step, snapping, snappedUses, files, alreadyUsed),
        evidence: { step, maxDistance, uses: snappedUses, files, alreadyUsed },
      },
    });
  }

  return { scale, scaleBasis: derived.basis, tokens, suggestions, beyondScale, kept: kept.sort((a, b) => a.px - b.px) };
}
