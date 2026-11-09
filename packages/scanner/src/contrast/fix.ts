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
  for (let i = 1; ; i++) {
    const down = c.l - i * STEP;
    const up = c.l + i * STEP;
    if (down < 0 && up > 1) return null;
    const options = [down >= 0 ? at(down) : null, up <= 1 ? at(up) : null].filter((s): s is Shade => s !== null);
    if (options.length > 0) return options.sort((a, b) => deltaE(color, a.hex) - deltaE(color, b.hex))[0]!;
  }
}

export interface TokenRef {
  path: string;
  hex: string;
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
  const existing: Candidate[] = [];
  const sides: [Fix["replaces"], string, string][] = [
    ["foreground", foreground, background],
    ["background", background, foreground],
  ];

  for (const [replaces, original, other] of sides) {
    if (!inSystem(original)) continue;
    const family = colorFamily(original);
    for (const t of tokens) {
      if (t.hex === original || t.hex === other || colorFamily(t.hex) !== family) continue;
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
