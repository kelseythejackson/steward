import { formatHex, formatHex8, parse } from "culori";

/** Hex (3, 4, 6 or 8 digits) or a color function: rgb(), hsl(), oklch(), oklab(), lab(), lch(), hwb(), color(). */
const COLOR_PATTERN = /#[0-9a-fA-F]{3,8}(?![0-9a-zA-Z_-])|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb|color)\([^()]*\)/g;

/** Bare HSL channels, as shadcn/ui writes them for Tailwind 3: `--primary: 222.2 47.4% 11.2%`. */
const HSL_CHANNELS = /^(-?\d*\.?\d+)(?:deg)?\s+(\d*\.?\d+)%\s+(\d*\.?\d+)%(?:\s*\/\s*(\d*\.?\d+%?))?$/;

/**
 * A whole CSS value that is one color, including bare HSL channels, as a
 * canonical key. Null for anything else (`var(--x)`, `1px solid #fff`).
 */
export function cssValueColor(value: string): string | null {
  const v = value.trim();
  const channels = HSL_CHANNELS.exec(v);
  if (channels) return normalizeColor(`hsl(${channels[1]} ${channels[2]}% ${channels[3]}%${channels[4] ? ` / ${channels[4]}` : ""})`);
  const found = findColors(v);
  return found.length === 1 && found[0]!.raw.length === v.length ? found[0]!.value : null;
}

export interface ColorMatch {
  /** The color exactly as written, e.g. `#3B82F6` or `rgb(59 130 246)`. */
  raw: string;
  /** Canonical key: lowercase hex, 8 digits only when alpha is below 1. */
  value: string;
  /** Offset of `raw` within the scanned text. */
  index: number;
}

/** Turns any supported color into one canonical key, or `null` if it isn't a valid color. */
export function normalizeColor(raw: string): string | null {
  const parsed = parse(raw);
  if (!parsed) return null;
  return (parsed.alpha ?? 1) < 1 ? formatHex8(parsed) : formatHex(parsed);
}

/** Finds every color literal in a piece of text (a CSS value, a style string). */
export function findColors(text: string): ColorMatch[] {
  const out: ColorMatch[] = [];
  for (const m of text.matchAll(COLOR_PATTERN)) {
    const value = normalizeColor(m[0]);
    if (value) out.push({ raw: m[0], value, index: m.index });
  }
  return out;
}

export interface ClassColorMatch extends ColorMatch {
  /** The whole class, e.g. `hover:bg-[#2563eb]/50`. */
  className: string;
}

/**
 * Finds colors inside Tailwind arbitrary values in a string of classes:
 * `bg-[#3b82f6]`, `hover:text-[rgb(59_130_246)]`, `[color:#fff]`,
 * `bg-[#3b82f6]/50`. Like Tailwind's own content scanner, any string is fair
 * game, so class maps and variables are covered too. Prose such as
 * "see [#123]" is ignored: the bracket must follow a utility (`bg-[…]`) or
 * be an arbitrary property (`[color:…]`).
 */
export function findArbitraryClassColors(text: string): ClassColorMatch[] {
  const out: ClassColorMatch[] = [];
  for (const token of text.matchAll(/\S+/g)) {
    const className = token[0];
    for (const group of className.matchAll(/(^|[-:!])\[([^[\]\s]+)\]/g)) {
      const content = group[2] ?? "";
      if (content.includes("url(")) continue;
      // A bracket that starts the class is only valid as an arbitrary property, `[color:#fff]`.
      if (group[1] !== "-" && !/^[a-z-]+:/.test(content)) continue;
      // Tailwind uses `_` for spaces inside arbitrary values; same length, so offsets hold.
      const contentStart = token.index + group.index + group[0].indexOf("[") + 1;
      for (const c of findColors(content.replaceAll("_", " "))) {
        out.push({ ...c, raw: content.slice(c.index, c.index + c.raw.length), index: contentStart + c.index, className });
      }
    }
  }
  return out;
}
