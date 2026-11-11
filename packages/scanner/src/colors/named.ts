import { resolveColorName, type ThemeColors } from "../contrast/classes.js";

/** Utilities that take a color, e.g. `text-gray-400`, `border-x-red-500`, `ring-offset-white`. */
const COLOR_UTILITY = /^(?:text|bg|border(?:-[xytrblse])?|ring(?:-offset)?|outline|divide|fill|stroke|from|via|to|placeholder|accent|caret|decoration|shadow)-(.+)$/;

export interface NamedColorMatch {
  /** The color name as written, e.g. `gray-400` or `black/40`. */
  raw: string;
  /** Canonical key: lowercase hex, 8 digits only when alpha is below 1. */
  value: string;
  /** Offset of the class within the scanned text. */
  index: number;
  /** The whole class, e.g. `hover:bg-black/40`. */
  className: string;
}

/** The utility after variant prefixes (`md:hover:`), ignoring colons inside `[...]`, with `!` removed. */
function utilityOf(cls: string): string {
  let depth = 0;
  let start = 0;
  for (let i = 0; i < cls.length; i++) {
    const ch = cls[i];
    if (ch === "[") depth++;
    else if (ch === "]") depth--;
    else if (ch === ":" && depth === 0) start = i + 1;
  }
  return cls.slice(start).replace(/^!|!$/g, "");
}

const alphaHex = (alpha: number) => Math.round(alpha * 255).toString(16).padStart(2, "0");

/**
 * Finds named color classes in a string of classes: Tailwind palette colors
 * (`text-gray-400`, `bg-white`, `bg-black/40`) and theme colors from the
 * Tailwind config (`bg-brand`). Arbitrary values (`bg-[#fff]`) are left to
 * `findArbitraryClassColors`, so nothing is counted twice.
 */
export function findNamedClassColors(text: string, theme: ThemeColors = {}): NamedColorMatch[] {
  const out: NamedColorMatch[] = [];
  for (const token of text.matchAll(/\S+/g)) {
    const className = token[0];
    const m = COLOR_UTILITY.exec(utilityOf(className));
    if (!m || m[1]!.startsWith("[")) continue;
    const resolved = resolveColorName(m[1]!, theme);
    if (!resolved || resolved.alpha <= 0) continue;
    const value = resolved.alpha < 1 ? `${resolved.hex}${alphaHex(resolved.alpha)}` : resolved.hex;
    out.push({ raw: m[1]!, value, index: token.index, className });
  }
  return out;
}
