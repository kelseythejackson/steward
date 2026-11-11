import { compareStrings } from "@steward/model";
import { clampChroma, converter, formatHex, parse } from "culori";
import { deltaE } from "../colors/cluster.js";
import { colorFamily, proposeColorPaths } from "../colors/naming.js";
import { contrastRatio } from "./wcag.js";

const toOklch = converter("oklch");

/** Lightness search step in OKLCH. Fine enough that the result is the nearest passing hex. */
const STEP = 0.001;

export interface Shade {
  hex: string;
  ratio: number;
}

/**
 * The nearest shade of `color` that reaches `required` contrast against
 * `against`. Only OKLCH lightness changes; hue and chroma stay (chroma is
 * clamped to what sRGB can show). The ratio is checked after rounding to hex,
 * so the result really passes. Null if no lightness works.
 */
export function nearestPassingShade(color: string, against: string, required: number): Shade | null {
  const parsed = parse(color);
  if (!parsed) return null;
  const c = toOklch(parsed);
  const at = (l: number): Shade | null => {
    const hex = formatHex(clampChroma({ ...c, l }, "oklch"));
    const ratio = contrastRatio(hex, against);
    return ratio >= required ? { hex, ratio } : null;
  };
  const down = firstPassingStep((i) => at(c.l - i * STEP), Math.floor(c.l / STEP + 1e-9));
  const up = firstPassingStep((i) => at(c.l + i * STEP), Math.floor((1 - c.l) / STEP + 1e-9));
  const step = Math.min(down?.step ?? Infinity, up?.step ?? Infinity);
  if (step === Infinity) return null;
  // Same distance both ways: keep the one closer to the original color, darker first on a tie.
  const options = [down, up].filter((o): o is { step: number; shade: Shade } => o !== null && o.step === step).map((o) => o.shade);
  return options.sort((a, b) => deltaE(color, a.hex) - deltaE(color, b.hex))[0]!;
}

/** Steps checked one by one below a binary-search hit, so rounding to hex can't make the search skip an earlier pass. */
const BACKTRACK = 24;

/**
 * The first step (1…max) where `at` passes. Starting from a failing color and
 * moving one way, contrast only falls, crosses the other color and then rises,
 * so passing steps form one run at the far end: binary search finds it in ~10 checks instead of up to
 * 1000. Hex rounding can wobble right at the edge, so the steps just below the
 * hit are checked one by one too.
 */
function firstPassingStep(at: (step: number) => Shade | null, max: number): { step: number; shade: Shade } | null {
  if (max < 1) return null;
  // A color that already passes can pass right away and stop passing further out; take the first step then.
  const first = at(1);
  if (first) return { step: 1, shade: first };
  const last = at(max);
  if (!last) return null;
  let lo = 0; // fails (the original color)
  let hi = max; // passes
  let hiShade = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    const shade = at(mid);
    if (shade) {
      hi = mid;
      hiShade = shade;
    } else lo = mid;
  }
  for (let i = Math.max(1, hi - BACKTRACK); i < hi; i++) {
    const shade = at(i);
    if (shade) return { step: i, shade };
  }
  return { step: hi, shade: hiShade };
}

export interface TokenRef {
  path: string;
  hex: string;
  /** Its color family, if already known. Pass it when calling `chooseFix` for many pairs, so it's worked out once per token. */
  family?: string;
}

export interface Fix {
  /** Which side of the pair changes. */
  replaces: "foreground" | "background";
  hex: string;
  ratio: number;
  /** Existing token path, or a proposed new one. */
  path: string;
  existing: boolean;
}

interface Candidate extends Fix {
  cost: number;
}

const byCost = (a: Candidate, b: Candidate) =>
  a.cost - b.cost || (a.replaces === b.replaces ? 0 : a.replaces === "foreground" ? -1 : 1) || compareStrings(a.path, b.path);

const strip = ({ cost: _cost, ...fix }: Candidate): Fix => fix;

/**
 * Picks the smallest change that makes the pair pass:
 * 1. Swap a side for another token in the same color family, if that side is a token.
 * 2. Otherwise compute the nearest passing shade of either side.
 * "Smallest" is measured in ΔE from the color being replaced; ties favor changing the foreground.
 */
export function chooseFix(foreground: string, background: string, required: number, tokens: readonly TokenRef[]): Fix | null {
  const inSystem = (hex: string) => tokens.some((t) => t.hex === hex);
  const familyOf = (t: TokenRef) => t.family ?? colorFamily(t.hex);
  const existing: Candidate[] = [];
  const sides: [Fix["replaces"], string, string][] = [
    ["foreground", foreground, background],
    ["background", background, foreground],
  ];

  for (const [replaces, original, other] of sides) {
    if (!inSystem(original)) continue;
    const family = colorFamily(original);
    for (const t of tokens) {
      if (t.hex === original || t.hex === other || familyOf(t) !== family) continue;
      const ratio = contrastRatio(t.hex, other);
      if (ratio >= required) existing.push({ replaces, hex: t.hex, ratio, path: t.path, existing: true, cost: deltaE(original, t.hex) });
    }
  }
  if (existing.length > 0) return strip(existing.sort(byCost)[0]!);

  const computed: Candidate[] = [];
  const taken = tokens.map((t) => t.path);
  for (const [replaces, original, other] of sides) {
    const shade = nearestPassingShade(original, other, required);
    if (!shade) continue;
    const path = proposeColorPaths([shade.hex], taken).get(shade.hex)!;
    computed.push({ replaces, hex: shade.hex, ratio: shade.ratio, path, existing: false, cost: deltaE(original, shade.hex) });
  }
  return computed.length > 0 ? strip(computed.sort(byCost)[0]!) : null;
}
