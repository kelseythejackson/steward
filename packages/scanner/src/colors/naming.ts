import { converter, parse } from "culori";

const toOklch = converter("oklch");

/** Below this OKLCH chroma a color reads as gray. Tailwind's own grays reach about 0.045 at the dark end. */
export const GRAY_MAX_CHROMA = 0.05;

/** Hue families and their center hue in OKLCH degrees. The nearest center wins. */
const HUE_FAMILIES: readonly [string, number][] = [
  ["red", 25],
  ["orange", 55],
  ["yellow", 95],
  ["green", 145],
  ["teal", 185],
  ["blue", 255],
  ["purple", 300],
  ["pink", 350],
];

/** Tailwind's scale steps with the OKLCH lightness of their gray, used as anchors for every family. */
export const LIGHTNESS_STEPS: readonly [number, number][] = [
  [50, 0.985],
  [100, 0.967],
  [200, 0.928],
  [300, 0.872],
  [400, 0.707],
  [500, 0.551],
  [600, 0.446],
  [700, 0.373],
  [800, 0.278],
  [900, 0.21],
  [950, 0.13],
];

const hueDistance = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

/** "gray", "blue", ... or "white"/"black" for those exact colors. */
export function colorFamily(hex: string): string {
  const parsed = parse(hex);
  if (!parsed) throw new Error(`Not a color: ${hex}`);
  const c = toOklch(parsed);
  if (c.l >= 0.9999 && c.c < 0.001) return "white";
  if (c.l <= 0.0001) return "black";
  if (c.c < GRAY_MAX_CHROMA || c.h === undefined) return "gray";
  let best = HUE_FAMILIES[0]!;
  for (const f of HUE_FAMILIES) if (hueDistance(c.h, f[1]) < hueDistance(c.h, best[1])) best = f;
  return best[0];
}

/** Scale steps ordered from best to worst fit for this color's lightness. Ties go to the lower step. */
export function stepsByFit(hex: string): number[] {
  const parsed = parse(hex);
  if (!parsed) throw new Error(`Not a color: ${hex}`);
  const l = toOklch(parsed).l;
  return [...LIGHTNESS_STEPS]
    .sort((a, b) => Math.abs(l - a[1]) - Math.abs(l - b[1]) || a[0] - b[0])
    .map(([step]) => step);
}

/**
 * Pure: proposes a dot-separated token path for each color, e.g.
 * `color.gray.500`, `color.white`. Colors are named in the order given, so
 * pass the most important first: if two colors want the same step, the
 * later one takes the nearest free step instead. Names are always unique,
 * including against `alreadyTaken` (paths that exist in the system already).
 */
export function proposeColorPaths(hexes: readonly string[], alreadyTaken: Iterable<string> = []): Map<string, string> {
  const taken = new Set<string>(alreadyTaken);
  const paths = new Map<string, string>();
  for (const hex of hexes) {
    if (paths.has(hex)) continue;
    const family = colorFamily(hex);
    let path: string | undefined;
    if (family === "white" || family === "black") {
      path = `color.${family}`;
    } else {
      path = stepsByFit(hex)
        .map((step) => `color.${family}.${step}`)
        .find((p) => !taken.has(p));
    }
    // Every step is taken (or white/black twice): fall back to the hex itself, which is unique.
    if (!path || taken.has(path)) path = `color.${family}.${hex.replace("#", "")}`;
    taken.add(path);
    paths.set(hex, path);
  }
  return paths;
}
