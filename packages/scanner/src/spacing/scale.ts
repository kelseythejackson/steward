/** The fallback scale, when a repo uses too few standard values to build one: 8 steps on a 4px grid, Tailwind's 1, 2, 3, 4, 6, 8, 12 and 16. */
export const DEFAULT_SPACING_SCALE: readonly number[] = [4, 8, 12, 16, 24, 32, 48, 64];

/** Tailwind's standard spacing values in px (`p-0.5` … `p-96`). Values a team picks on purpose; arbitrary ones like 7px are drift. */
export const TAILWIND_SPACING_PX: ReadonlySet<number> = new Set([
  2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 72, 80, 96, 112, 128, 144, 160, 176, 192, 208, 224, 240, 256, 288, 320, 384,
]);

/** A standard value needs this many uses to become a step, so a one-off `p-5` isn't made official. */
export const MIN_STEP_USES = 2;

/**
 * Pure: the scale a repo actually uses. Every standard Tailwind spacing value
 * used at least `minUses` times becomes a step; heavily used drift like 7px
 * never does. Falls back to `DEFAULT_SPACING_SCALE` when fewer than two
 * values qualify, since one step can't be a scale.
 */
export function deriveSpacingScale(values: readonly { px: number; uses: number }[], minUses = MIN_STEP_USES): { scale: number[]; basis: "repo" | "default" } {
  const steps = values.filter((v) => TAILWIND_SPACING_PX.has(v.px) && v.uses >= minUses).map((v) => v.px);
  const scale = [...new Set(steps)].sort((a, b) => a - b);
  return scale.length >= 2 ? { scale, basis: "repo" } : { scale: [...DEFAULT_SPACING_SCALE], basis: "default" };
}

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
