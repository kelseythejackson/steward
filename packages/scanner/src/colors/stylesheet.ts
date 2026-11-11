import { lineLocator } from "./lines.js";
import type { ThemeColors } from "../contrast/classes.js";
import { findNamedClassColors } from "./named.js";
import { cssValueColor, findArbitraryClassColors, findColors } from "./normalize.js";
import type { FoundColor } from "./types.js";

/** Replaces comments with spaces, keeping newlines so line numbers stay right. */
export function blankComments(code: string, scss: boolean): string {
  const blank = (s: string) => s.replace(/[^\n]/g, " ");
  let out = code.replace(/\/\*[\s\S]*?\*\//g, blank);
  // SCSS line comments. Skip `//` right after `:` so `url(http://…)` survives.
  if (scss) out = out.replace(/(^|[^:])(\/\/[^\n]*)/gm, (_m, before: string, comment: string) => before + blank(comment));
  return out;
}

/**
 * Finds colors in CSS and SCSS. Only declaration values are scanned, so
 * selectors like `#fade { }` are never mistaken for colors. `@apply` lines
 * are scanned for Tailwind arbitrary values and named color classes. Custom
 * properties that hold a color are recorded as definitions, not uses.
 */
export function extractStylesheetColors(code: string, file: string, theme: ThemeColors = {}): FoundColor[] {
  const text = blankComments(code, file.endsWith(".scss"));
  const lineAt = lineLocator(code);
  const out: FoundColor[] = [];

  for (const seg of text.matchAll(/[^{};]+/g)) {
    const segStart = seg.index;
    const segEnd = segStart + seg[0].length;
    if (text[segEnd] === "{") continue; // a selector or at-rule prelude

    const body = seg[0];
    const trimmed = body.trim();
    const snippet = trimmed.replace(/\s+/g, " ");

    if (trimmed.startsWith("@apply")) {
      for (const m of findArbitraryClassColors(body)) {
        out.push({ file, line: lineAt(segStart + m.index), raw: m.raw, value: m.value, source: "css", snippet: m.className });
      }
      for (const m of findNamedClassColors(body, theme)) {
        out.push({ file, line: lineAt(segStart + m.index), raw: m.raw, value: m.value, source: "tailwind-name", snippet: m.className });
      }
      continue;
    }
    if (trimmed.startsWith("@")) continue; // @import, @tailwind, @use…

    const colon = body.indexOf(":");
    if (colon === -1) continue;
    const valueStart = colon + 1;
    // A custom property that holds one color defines it (`--primary: 222 47% 11%`, `@theme { --color-brand: … }`).
    if (trimmed.startsWith("--")) {
      const raw = body.slice(valueStart).trim();
      const value = cssValueColor(raw);
      const offset = body.indexOf(raw, valueStart);
      if (value) out.push({ file, line: lineAt(segStart + offset), raw, value, source: "css-variable", snippet });
      continue;
    }
    for (const m of findColors(body.slice(valueStart))) {
      out.push({ file, line: lineAt(segStart + valueStart + m.index), raw: m.raw, value: m.value, source: "css", snippet });
    }
  }
  return out;
}
