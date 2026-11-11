import { lineLocator } from "../colors/lines.js";
import { blankComments } from "../colors/stylesheet.js";
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

/** px values in a CSS value list (`9px 13px`, `-0.5rem`). Each value once; `0`, `auto`, `%` skipped; `calc()` and `var()` skip the whole value. */
export function cssLengths(value: string): number[] {
  if (value.includes("(")) return [];
  const out: number[] = [];
  for (const part of value.trim().split(/\s+/)) {
    const m = LENGTH.exec(part);
    if (!m) continue;
    const px = Number(m[1]) * (m[2] === "rem" ? 16 : 1);
    if (px > 1 && !out.includes(px)) out.push(px);
  }
  return out;
}

/** Finds padding, margin and gap values (and widths and heights, as sizes) in CSS and SCSS, plus `@apply` classes. */
export function extractCssSpacing(code: string, file: string, version: TailwindVersion = 3): FoundSpacing[] {
  const text = blankComments(code, file.endsWith(".scss"));
  const lineAt = lineLocator(code);
  const out: FoundSpacing[] = [];

  for (const seg of text.matchAll(/[^{};]+/g)) {
    const segEnd = seg.index + seg[0].length;
    if (text[segEnd] === "{") continue; // a selector or at-rule prelude
    const lead = seg[0].length - seg[0].trimStart().length;
    const start = seg.index + lead;
    const body = seg[0].trim();

    if (body.startsWith("@apply")) {
      for (const m of body.matchAll(/\S+/g)) {
        const cls = parseSpacingClass(m[0], version);
        if (cls) out.push({ file, line: lineAt(start + m.index), raw: m[0], property: cls.property, px: cls.px, category: cls.category, source: "css" });
      }
      continue;
    }
    if (body.startsWith("@")) continue;

    const colon = body.indexOf(":");
    if (colon === -1) continue;
    const property = body.slice(0, colon).trim().toLowerCase();
    const category = cssCategory(property);
    if (!category) continue;
    const value = body.slice(colon + 1).replace(/!important\s*$/, "");
    const raw = `${property}: ${value.trim().replace(/\s+/g, " ")}`;
    for (const px of cssLengths(value)) out.push({ file, line: lineAt(start), raw, property, px, category, source: "css" });
  }
  return out;
}
