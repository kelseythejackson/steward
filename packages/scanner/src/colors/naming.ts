import { compareStrings } from "@steward/model";
import { converter, parse } from "culori";
import { TAILWIND_PALETTE } from "../contrast/palette.js";
import { TAILWIND_V4_PALETTE } from "../contrast/palette-v4.js";

const toOklch = converter("oklch");

/**
 * Below this OKLCH chroma a color reads as gray. Light colors need a much
 * lower limit: Tailwind's red-50 has less chroma than its slate-900 but is
 * clearly pink. Each band sits between the most colorful gray and the least
 * colorful tint at that lightness across the Tailwind 3 and 4 palettes, so
 * every palette color lands in the right family.
 */
export function grayMaxChroma(lightness: number): number {
  if (lightness >= 0.95) return 0.0095; // grays reach 0.007, tints start at 0.0125 (sky-50)
  if (lightness >= 0.9) return 0.02; // 0.013 vs 0.028 (pink-100)
  if (lightness >= 0.8) return 0.035; // 0.022 vs 0.055 (violet-200)
  if (lightness >= 0.3) return 0.05; // 0.046 (v4 slate-500) vs 0.054 (cyan-950)
  return 0.0435; // 0.0425 (v4 slate-950) vs 0.0447 (teal-950)
}

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
  if (c.c < grayMaxChroma(c.l) || c.h === undefined) return "gray";
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

/** Tailwind palette hex (v3 and v4) → its step (`#dc2626` → 600), so Tailwind's own colors keep their familiar numbers. */
const PALETTE_STEPS = new Map<string, number>();
for (const palette of [TAILWIND_PALETTE, TAILWIND_V4_PALETTE]) {
  for (const name of Object.keys(palette).sort(compareStrings)) {
    const m = /^[a-z]+-(\d+)$/.exec(name);
    const hex = palette[name]!;
    if (m && !PALETTE_STEPS.has(hex)) PALETTE_STEPS.set(hex, Number(m[1]));
  }
}

/**
 * Pure: proposes a dot-separated token path for each color, e.g.
 * `color.gray.500`, `color.white`. A Tailwind palette color keeps its
 * Tailwind step when it's free (`#dc2626` → `color.red.600`). Colors are named in the order given, so
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
    const single = family === "white" || family === "black";
    // Like Tailwind's `black/40`: a color with opacity gets its percentage as a suffix.
    const alpha = hex.length === 9 ? Math.round((parseInt(hex.slice(7), 16) / 255) * 100) : 100;
    const suffix = alpha < 100 ? `-${alpha}` : "";
    let path: string | undefined;
    if (single) {
      path = `color.${family}${suffix}`;
    } else {
      const paletteStep = PALETTE_STEPS.get(hex.slice(0, 7));
      const steps = paletteStep === undefined ? stepsByFit(hex) : [paletteStep, ...stepsByFit(hex)];
      path = steps
        .map((step) => `color.${family}.${step}${suffix}`)
        .find((p) => !taken.has(p));
    }
    // Every step is taken (or white/black twice): fall back to the hex itself, which is unique.
    // White and black are tokens, not groups, so their fallback is a sibling name.
    if (!path || taken.has(path)) path = single ? `color.${family}-${hex.slice(1)}` : `color.${family}.${hex.slice(1)}`;
    taken.add(path);
    paths.set(hex, path);
  }
  return paths;
}
