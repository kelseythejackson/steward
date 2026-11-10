/** The default scale: 8 steps on a 4px grid, matching Tailwind's 1, 2, 3, 4, 6, 8, 12 and 16. */
export const DEFAULT_SPACING_SCALE: readonly number[] = [4, 8, 12, 16, 24, 32, 48, 64];

export type Snap =
  | { kind: "on-scale"; step: number }
  | { kind: "snap"; step: number; distance: number; halfway: boolean }
  /** Larger than the largest step: snapping would change the layout too much to suggest blindly. */
  | { kind: "beyond-scale" };

/** Sorted, deduped scale. Throws a plain message if it has no usable steps. */
export function normalizeScale(scale: readonly number[]): number[] {
  if (scale.length === 0 || scale.some((s) => !Number.isFinite(s) || s <= 0)) {
    throw new Error(`The spacing scale needs at least one positive number of px, and only positive numbers. Got [${scale.join(", ")}].`);
  }
  return [...new Set(scale)].sort((a, b) => a - b);
}

/**
 * The nearest step for a px value. A value exactly halfway between two steps
 * rounds up: a little more space is safer for readability and touch targets.
 */
export function snapToScale(px: number, scale: readonly number[] = DEFAULT_SPACING_SCALE): Snap {
  const steps = normalizeScale(scale);
  if (steps.includes(px)) return { kind: "on-scale", step: px };
  if (px > steps[steps.length - 1]!) return { kind: "beyond-scale" };
  const above = steps.find((s) => s > px)!;
  const below = [...steps].reverse().find((s) => s < px);
  if (below === undefined) return { kind: "snap", step: above, distance: above - px, halfway: false };
  const up = above - px;
  const down = px - below;
  if (up <= down) return { kind: "snap", step: above, distance: up, halfway: up === down };
  return { kind: "snap", step: below, distance: down, halfway: false };
}

/** `16` → `spacing.4` (Tailwind's numbering, so `p-4` maps straight to it). `10` → `spacing.2_5`. */
export function spacingTokenPath(px: number): string {
  return `spacing.${String(px / 4).replace(".", "_")}`;
}
