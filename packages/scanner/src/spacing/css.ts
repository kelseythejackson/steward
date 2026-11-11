import { lineLocator } from "../colors/lines.js";
import { parseCss } from "../css.js";
import type { TailwindVersion } from "../tailwind.js";
import { parseSpacingClass } from "./classes.js";
import type { FoundSpacing, SpacingCategory } from "./types.js";

const SPACING_PROPERTY = /^(?:(?:padding|margin)(?:-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?|gap|row-gap|column-gap)$/;
const SIZE_PROPERTY = /^(?:min-|max-)?(?:width|height)$/;
const LENGTH = /^-?(\d*\.?\d+)(px|rem)$/;

export function cssCategory(property: string): SpacingCategory | null {
  if (SPACING_PROPERTY.test(property)) return "spacing";
  if (SIZE_PROPERTY.test(property)) return "size";
  return null;
}

/** px values in a CSS value list (`9px 13px`, `-0.5rem`; rem uses the root font size). Each value once; `0`, `auto`, `%` skipped; `calc()` and `var()` skip the whole value. */
export function cssLengths(value: string, rootPx = 16): number[] {
  if (value.includes("(")) return [];
  const out: number[] = [];
  for (const part of value.trim().split(/\s+/)) {
    const m = LENGTH.exec(part);
    if (!m) continue;
    const px = Number(m[1]) * (m[2] === "rem" ? rootPx : 1);
    if (px > 1 && !out.includes(px)) out.push(px);
  }
  return out;
}

/** Finds padding, margin and gap values (and widths and heights, as sizes) in CSS and SCSS, plus `@apply` classes. */
export function extractCssSpacing(code: string, file: string, version: TailwindVersion = 3, rootPx = 16): FoundSpacing[] {
  const lineAt = lineLocator(code);
  const out: FoundSpacing[] = [];

  for (const rule of parseCss(code, file.endsWith(".scss"))) {
    for (const d of rule.declarations) {
      if (d.prop === "@apply") {
        for (const m of d.value.matchAll(/\S+/g)) {
          const cls = parseSpacingClass(m[0], version, rootPx);
          if (cls) out.push({ file, line: lineAt(d.valueStart + m.index), raw: m[0], property: cls.property, px: cls.px, category: cls.category, source: "css" });
        }
        continue;
      }
      const category = cssCategory(d.prop);
      if (!category) continue;
      const value = d.value.replace(/!important\s*$/, "");
      const raw = `${d.prop}: ${value.trim().replace(/\s+/g, " ")}`;
      for (const px of cssLengths(value, rootPx)) out.push({ file, line: lineAt(d.start), raw, property: d.prop, px, category, source: "css" });
    }
  }
  return out;
}
