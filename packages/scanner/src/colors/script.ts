import { parse } from "@babel/parser";
import traverse from "@babel/traverse";
import { lineLocator } from "./lines.js";
import { findArbitraryClassColors, findColors } from "./normalize.js";
import type { FoundColor } from "./types.js";

const TAILWIND_CONFIG = /(^|\/)tailwind\.config\.(ts|mts|cts|js|mjs|cjs)$/;

export function isTailwindConfig(path: string): boolean {
  return TAILWIND_CONFIG.test(path);
}

/** A whole string that is just a color, e.g. `"#2563eb"` in a theme config. */
const isBareColor = (text: string) => {
  const found = findColors(text.trim());
  return found.length === 1 && found[0]!.raw.length === text.trim().length;
};

/**
 * Finds colors in a TS/TSX file:
 * - Tailwind arbitrary values in any string or template literal, which covers
 *   `className`, `clsx`/`cn` calls (including object keys) and class maps.
 * - Color values in inline `style={{ ... }}` objects.
 * - In a Tailwind config, color strings are recorded as definitions.
 *
 * Throws if the file can't be parsed.
 */
export function extractScriptColors(code: string, file: string): FoundColor[] {
  const isTsx = file.endsWith(".tsx");
  const ast = parse(code, {
    sourceType: "module",
    plugins: isTsx ? ["typescript", "jsx"] : ["typescript"],
  });
  const lineAt = lineLocator(code);
  const out: FoundColor[] = [];
  const config = isTailwindConfig(file);

  /** Scans the raw source of a string node, so offsets map exactly to lines. */
  const scanClasses = (start: number, end: number) => {
    const raw = code.slice(start, end);
    for (const m of findArbitraryClassColors(raw)) {
      out.push({ file, line: lineAt(start + m.index), raw: m.raw, value: m.value, source: "tailwind-class", snippet: m.className });
    }
  };

  const scanConfigString = (start: number, end: number) => {
    const raw = code.slice(start, end);
    if (!isBareColor(raw)) return;
    for (const m of findColors(raw)) {
      out.push({ file, line: lineAt(start + m.index), raw: m.raw, value: m.value, source: "tailwind-config", snippet: raw.trim() });
    }
  };

  const scan = config ? scanConfigString : scanClasses;

  traverse(ast, {
    StringLiteral(path) {
      const { start, end } = path.node;
      if (start == null || end == null) return;
      scan(start + 1, end - 1);
    },
    TemplateElement(path) {
      const { start, end } = path.node;
      if (start == null || end == null) return;
      scan(start, end);
    },
    JSXAttribute(path) {
      const { name, value } = path.node;
      if (config || name.type !== "JSXIdentifier" || name.name !== "style") return;
      if (value?.type !== "JSXExpressionContainer" || value.expression.type !== "ObjectExpression") return;

      for (const prop of value.expression.properties) {
        if (prop.type !== "ObjectProperty") continue;
        const key =
          prop.key.type === "Identifier" ? prop.key.name : prop.key.type === "StringLiteral" ? prop.key.value : "?";
        const v = prop.value;
        if ((v.type !== "StringLiteral" && v.type !== "TemplateLiteral") || v.start == null || v.end == null) continue;
        const raw = code.slice(v.start, v.end);
        for (const m of findColors(raw)) {
          out.push({
            file,
            line: lineAt(v.start + m.index),
            raw: m.raw,
            value: m.value,
            source: "inline-style",
            snippet: `${key}: ${raw}`,
          });
        }
      }
    },
  });

  return out;
}
