import {
  compareStrings,
  STEWARD_EXTENSION,
  suggestionId,
  type DimensionToken,
  type MergeDecision,
  type SpacingMergeSuggestion,
  type UsageLocation,
} from "@steward/model";
import { DEFAULT_SPACING_SCALE, normalizeScale, snapToScale, spacingTokenPath } from "./scale.js";
import type { ExtractedSpacing, SpacingExtraction } from "./types.js";

export interface SpacingSuggestionOptions {
  /** Scale steps in px. Defaults to `DEFAULT_SPACING_SCALE`. */
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

function isRejected(members: readonly string[], decisions: readonly MergeDecision[]): boolean {
  const id = suggestionId("spacing", members);
  const key = [...members].sort(compareStrings).join(",");
  return decisions.some(
    (d) => d.kind === "spacing" && d.status === "rejected" && (d.suggestionId === id || [...d.members].sort(compareStrings).join(",") === key),
  );
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
  const scale = normalizeScale(options.scale ?? DEFAULT_SPACING_SCALE);
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
      snapsTo.set(snap.step, [...(snapsTo.get(snap.step) ?? []), s]);
    }
  }

  const tokens: ProposedSpacingToken[] = [];
  const suggestions: SpacingMergeSuggestion[] = [];
  const kept: ExtractedSpacing[] = [];
  for (const step of scale) {
    const path = spacingTokenPath(step);
    const alreadyUsed = onScale.get(step) ?? 0;
    let snapping = snapsTo.get(step) ?? [];
    const members = [...snapping.map((s) => px(s.value.px)), px(step)].sort(compareStrings);
    if (snapping.length > 0 && isRejected(members, decisions)) {
      kept.push(...snapping.map((s) => s.value));
      snapping = [];
    }
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

  return { scale, tokens, suggestions, beyondScale, kept: kept.sort((a, b) => a.px - b.px) };
}

/** One plain-English line, e.g. "Found 24 spacing values used 61 times → suggest a scale of 8 steps. 15 values (31 uses) would snap to it." */
export function summarizeSpacingSuggestions(extraction: SpacingExtraction, result: SpacingSuggestions): string {
  const uses = extraction.values.reduce((n, v) => n + v.uses, 0);
  const snapping = result.suggestions.flatMap((s) => s.members.filter((m) => m !== px(s.proposed.token.$value.value)));
  const snappedUses = result.suggestions.reduce((n, s) => n + Number(s.reason.evidence.uses), 0);
  let out = `Found ${plural(extraction.values.length, "spacing value")} used ${times(uses)} → suggest a scale of ${plural(result.scale.length, "step")}.`;
  out += snapping.length === 0 ? " Every value is already on it." : ` ${plural(snapping.length, "value")} (${plural(snappedUses, "use")}) would snap to it.`;
  if (result.beyondScale.length > 0) {
    out += ` ${plural(result.beyondScale.length, "value")} ${result.beyondScale.length === 1 ? "is" : "are"} larger than the scale and ${result.beyondScale.length === 1 ? "is" : "are"} left as is.`;
  }
  if (result.kept.length > 0) out += ` ${plural(result.kept.length, "value")} stay${result.kept.length === 1 ? "s" : ""} off the scale by your decision.`;
  if (extraction.sizes.length > 0) {
    out += ` ${plural(extraction.sizes.length, "size")} (widths and heights) ${extraction.sizes.length === 1 ? "isn't" : "aren't"} checked yet.`;
  }
  return out;
}
