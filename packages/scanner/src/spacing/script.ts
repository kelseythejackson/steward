import { parse } from "@babel/parser";
import traverse from "@babel/traverse";
import { lineLocator } from "../colors/lines.js";
import { isTailwindConfig } from "../colors/script.js";
import type { TailwindVersion } from "../tailwind.js";
import { parseSpacingClass } from "./classes.js";
import { cssCategory, cssLengths } from "./css.js";
import type { FoundSpacing } from "./types.js";

/** `marginTop` → `margin-top`. */
const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/**
 * Finds spacing in a TS/TSX file:
 * - Tailwind classes in any string or template literal, which covers
 *   `className`, `cn()`/`clsx()` calls and class maps, each at its own line.
 *   Only whole whitespace-separated words count, so `p-${n}` is skipped.
 * - Static values in inline `style={{ ... }}` objects (numbers are px).
 *   Dynamic values like `${pct}%` are skipped.
 * Tailwind configs are skipped. Throws if the file can't be parsed.
 */
export function extractScriptSpacing(code: string, file: string, version: TailwindVersion = 3, rootPx = 16): FoundSpacing[] {
  if (isTailwindConfig(file)) return [];
  const ast = parse(code, { sourceType: "module", plugins: file.endsWith(".tsx") ? ["typescript", "jsx"] : ["typescript"] });
  const lineAt = lineLocator(code);
  const out: FoundSpacing[] = [];

  /** Scans the raw source of a string, so offsets map exactly to lines. Words touching an interpolation are partial and skipped. */
  const scanClasses = (start: number, end: number, openLeft: boolean, openRight: boolean) => {
    const raw = code.slice(start, end);
    for (const m of raw.matchAll(/\S+/g)) {
      if ((openLeft && m.index === 0) || (openRight && m.index + m[0].length === raw.length)) continue;
      const cls = parseSpacingClass(m[0], version, rootPx);
      if (cls) out.push({ file, line: lineAt(start + m.index), raw: m[0], property: cls.property, px: cls.px, category: cls.category, source: "tailwind-class" });
    }
  };

  traverse(ast, {
    StringLiteral(path) {
      const { start, end } = path.node;
      if (start == null || end == null) return;
      scanClasses(start + 1, end - 1, false, false);
    },
    TemplateElement(path) {
      const { start, end } = path.node;
      if (start == null || end == null) return;
      const tpl = path.parent;
      if (tpl.type !== "TemplateLiteral") return;
      const i = tpl.quasis.indexOf(path.node);
      scanClasses(start, end, i > 0, i < tpl.quasis.length - 1);
    },
    JSXAttribute(path) {
      const { name, value } = path.node;
      if (name.type !== "JSXIdentifier" || name.name !== "style") return;
      if (value?.type !== "JSXExpressionContainer" || value.expression.type !== "ObjectExpression") return;
      for (const prop of value.expression.properties) {
        if (prop.type !== "ObjectProperty" || prop.computed) continue;
        const key = prop.key.type === "Identifier" ? prop.key.name : prop.key.type === "StringLiteral" ? prop.key.value : null;
        if (!key) continue;
        const property = kebab(key);
        const category = cssCategory(property);
        if (!category) continue;
        const v = prop.value;
        const line = lineAt(v.start ?? 0);
        let text: string;
        let lengths: number[];
        if (v.type === "NumericLiteral") {
          text = String(v.value);
          lengths = v.value > 1 ? [v.value] : [];
        } else if (v.type === "StringLiteral") {
          text = v.value;
          lengths = cssLengths(v.value, rootPx);
        } else continue; // dynamic
        for (const px of lengths) out.push({ file, line, raw: `${key}: ${text}`, property, px, category, source: "inline-style" });
      }
    },
  });

  return out;
}
