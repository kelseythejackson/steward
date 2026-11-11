import type { ThemeColors } from "../contrast/classes.js";
import { blankComments, parseCss } from "../css.js";
import { lineLocator } from "./lines.js";
import { findNamedClassColors } from "./named.js";
import { cssValueColor, findArbitraryClassColors, findColors } from "./normalize.js";
import type { FoundColor } from "./types.js";

/** Kept here too, since other code imports it from this module. */
export { blankComments };

/**
 * Finds colors in CSS and SCSS. Only declaration values are scanned, so
 * selectors like `#fade { }` are never mistaken for colors. `@apply` lines
 * are scanned for Tailwind arbitrary values and named color classes. Custom
 * properties that hold a color are recorded as definitions, not uses.
 */
export function extractStylesheetColors(code: string, file: string, theme: ThemeColors = {}): FoundColor[] {
  const lineAt = lineLocator(code);
  const out: FoundColor[] = [];

  for (const rule of parseCss(code, file.endsWith(".scss"))) {
    for (const d of rule.declarations) {
      if (d.prop === "@apply") {
        for (const m of findArbitraryClassColors(d.value)) {
          out.push({ file, line: lineAt(d.valueStart + m.index), raw: m.raw, value: m.value, source: "css", snippet: m.className });
        }
        for (const m of findNamedClassColors(d.value, theme)) {
          out.push({ file, line: lineAt(d.valueStart + m.index), raw: m.raw, value: m.value, source: "tailwind-name", snippet: m.className });
        }
        continue;
      }
      const snippet = `${d.prop}: ${d.value}`.replace(/\s+/g, " ");
      // A custom property or SCSS variable that holds one color defines it (`--primary: 222 47% 11%`, `$brand: #3b82f6`).
      if (d.prop.startsWith("--") || d.prop.startsWith("$")) {
        const value = cssValueColor(d.value);
        if (value) out.push({ file, line: lineAt(d.valueStart), raw: d.value, value, source: "css-variable", snippet });
        continue;
      }
      // Colors inside url(…), like an inline SVG's `fill='#fff'`, belong to the image, not the UI.
      const value = d.value.replace(/url\((?:"[^"]*"|'[^']*'|[^)]*)\)/g, (u) => " ".repeat(u.length));
      for (const m of findColors(value)) {
        out.push({ file, line: lineAt(d.valueStart + m.index), raw: m.raw, value: m.value, source: "css", snippet });
      }
    }
  }
  return out;
}
