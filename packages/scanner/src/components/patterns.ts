import { compareStrings } from "@steward/model";

const COLOR_NAMES = new Set([
  "white", "black", "transparent", "current", "inherit",
  "slate", "gray", "zinc", "neutral", "stone", "red", "orange", "amber", "yellow", "lime", "green", "emerald",
  "teal", "cyan", "sky", "blue", "indigo", "violet", "purple", "fuchsia", "pink", "rose",
]);
const TEXT_SIZES = /^(xs|sm|base|lg|xl|\d+xl)$/;
const FONT_WEIGHTS = new Set(["thin", "extralight", "light", "normal", "medium", "semibold", "bold", "extrabold", "black"]);
/** A trailing segment that is a value, not part of the utility's name. */
const VALUE = /^(\d+(\.\d+)?|\d+\/\d+|px|auto|full|screen|none|min|max|fit|inner|xs|sm|md|lg|xl|\d+xl|base|prose)$/;
const ARBITRARY_COLOR = /^\[(#|rgb|hsl|oklch|color:)/;

/** Splits `md:hover:bg-x` into `md:hover:` and `bg-x`, ignoring colons inside `[...]`. */
function splitVariants(cls: string): [string, string] {
  let depth = 0;
  let cut = 0;
  for (let i = 0; i < cls.length; i++) {
    if (cls[i] === "[") depth++;
    else if (cls[i] === "]") depth--;
    else if (cls[i] === ":" && depth === 0) cut = i + 1;
  }
  return [cls.slice(0, cut), cls.slice(cut)];
}

/**
 * The utility family a class belongs to, so classes that do the same job
 * with a different value match: `rounded-lg` and `rounded-xl` are both
 * `rounded`, `bg-white` and `bg-[#fff]` are both `bg-color`, `p-6` and
 * `p-[13px]` are both `p`. Variant prefixes are kept (`hover:bg-color`).
 */
export function classPattern(cls: string): string {
  const [variants, rest] = splitVariants(cls);
  let base = rest.replace(/^!|!$/g, "").replace(/^-/, "");
  base = base.replace(/\/\d+$/, ""); // opacity modifier: bg-black/40

  const arbitrary = /^(.+?)-(\[.+\])$/.exec(base);
  if (arbitrary) {
    const [, prefix, value] = arbitrary;
    if (prefix === "text") return `${variants}text-${ARBITRARY_COLOR.test(value!) ? "color" : "size"}`;
    return `${variants}${prefix}${ARBITRARY_COLOR.test(value!) ? "-color" : ""}`;
  }

  const parts = base.split("-");
  const colorAt = parts.findIndex((p, i) => i > 0 && COLOR_NAMES.has(p));
  if (colorAt > 0) return `${variants}${parts.slice(0, colorAt).join("-")}-color`;
  if (parts[0] === "text" && parts.length === 2 && TEXT_SIZES.test(parts[1]!)) return `${variants}text-size`;
  if (parts[0] === "font" && parts.length === 2 && FONT_WEIGHTS.has(parts[1]!)) return `${variants}font-weight`;
  if (parts.length > 1 && VALUE.test(parts[parts.length - 1]!)) return `${variants}${parts.slice(0, -1).join("-")}`;
  return `${variants}${base}`;
}

/** The sorted, unique patterns in one or more class strings. */
export function classPatterns(...classLists: readonly string[]): string[] {
  const out = new Set<string>();
  for (const list of classLists) for (const cls of list.split(/\s+/)) if (cls) out.add(classPattern(cls));
  return [...out].sort(compareStrings);
}

/** Shared patterns over all patterns (Jaccard). 0 when either side has none. */
export function patternOverlap(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  const shared = a.filter((p) => setB.has(p)).length;
  return shared / new Set([...a, ...b]).size;
}
