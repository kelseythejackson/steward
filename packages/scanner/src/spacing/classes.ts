import type { TailwindVersion } from "../tailwind.js";
import type { SpacingCategory } from "./types.js";

export interface SpacingClass {
  category: SpacingCategory;
  /** The Tailwind prefix, e.g. `mt`, `gap-x`, `min-h`. */
  property: string;
  px: number;
}

/** Tailwind 3's default spacing keys. Each step is 0.25rem (4px). */
const SPACING_KEYS = new Set([
  "0.5", "1", "1.5", "2", "2.5", "3", "3.5", "4", "5", "6", "7", "8", "9", "10", "11", "12",
  "14", "16", "20", "24", "28", "32", "36", "40", "44", "48", "52", "56", "60", "64", "72", "80", "96",
]);

const SPACING_PREFIXES = ["space-x", "space-y", "gap-x", "gap-y", "gap", "px", "py", "pt", "pr", "pb", "pl", "ps", "pe", "p", "mx", "my", "mt", "mr", "mb", "ml", "ms", "me", "m"];
const SIZE_PREFIXES = ["min-w", "min-h", "max-w", "max-h", "size", "w", "h"];
const CLASS = new RegExp(`^(${[...SPACING_PREFIXES, ...SIZE_PREFIXES].join("|")})-(.+)$`);
const NEGATABLE = /^(m[xytrblse]?|space-[xy])$/;
const ARBITRARY = /^\[(\d*\.?\d+)(px|rem)\]$/;

/** Values of 1px or less are hairlines, not spacing: `px`, `0`, `[1px]` are left alone. */
export const MIN_SPACING_PX = 1;

/** The last segment after variant prefixes (`md:hover:`), ignoring colons inside `[...]`. */
function stripVariants(cls: string): string {
  let depth = 0;
  let start = 0;
  for (let i = 0; i < cls.length; i++) {
    const ch = cls[i];
    if (ch === "[") depth++;
    else if (ch === "]") depth--;
    else if (ch === ":" && depth === 0) start = i + 1;
  }
  return cls.slice(start);
}

/** Tailwind 4 accepts any multiple of 0.25 as a spacing key (`p-13`, `mt-4.5`), each step 0.25rem. */
const V4_KEY = /^\d+(?:\.(?:25|5|75))?$/;

/**
 * Reads a Tailwind length: a default spacing key (`2.5`, or on Tailwind 4 any
 * multiple of 0.25 like `13`) or an arbitrary px/rem value (`[13px]`).
 */
export function lengthPx(value: string, version: TailwindVersion = 3, rootPx = 16): number | null {
  // Each spacing key is 0.25rem, so it scales with the root font size.
  if (SPACING_KEYS.has(value) || (version === 4 && V4_KEY.test(value))) return round(Number(value) * (rootPx / 4));
  const m = ARBITRARY.exec(value);
  if (!m) return null;
  return round(Number(m[1]) * (m[2] === "rem" ? rootPx : 1));
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Reads one Tailwind class as spacing (`p-4` → 16px, `mt-[7px]` → 7px) or a
 * size (`h-[42px]`). Returns null for anything else, including `0`, `px`,
 * `auto`, fractions, percentages and `calc()`.
 */
export function parseSpacingClass(cls: string, version: TailwindVersion = 3, rootPx = 16): SpacingClass | null {
  let c = stripVariants(cls);
  if (c.startsWith("!")) c = c.slice(1);
  if (c.endsWith("!")) c = c.slice(0, -1);
  const negative = c.startsWith("-");
  if (negative) c = c.slice(1);

  const m = CLASS.exec(c);
  if (!m) return null;
  const property = m[1]!;
  if (negative && !NEGATABLE.test(property)) return null;
  const px = lengthPx(m[2]!, version, rootPx);
  if (px === null || px <= MIN_SPACING_PX) return null;
  return { category: SIZE_PREFIXES.includes(property) ? "size" : "spacing", property, px };
}
