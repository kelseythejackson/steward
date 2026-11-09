import { parse } from "@babel/parser";
import traverse from "@babel/traverse";
import { normalizeColor } from "../colors/normalize.js";
import type { ThemeColors } from "./classes.js";

type Node = Parameters<typeof traverse>[0];
type ObjectExpression = Extract<Node, { type: "ObjectExpression" }>;

function keyName(key: Node): string | null {
  if (key.type === "Identifier") return key.name;
  if (key.type === "StringLiteral") return key.value;
  if (key.type === "NumericLiteral") return String(key.value);
  return null;
}

function flatten(obj: ObjectExpression, prefix: string, out: Record<string, string>): void {
  for (const prop of obj.properties) {
    if (prop.type !== "ObjectProperty") continue;
    const key = keyName(prop.key);
    if (key === null) continue;
    const name = key === "DEFAULT" ? prefix : prefix ? `${prefix}-${key}` : key;
    const value = prop.value;
    if (value.type === "StringLiteral") {
      const hex = normalizeColor(value.value);
      if (hex && name) out[name] = hex;
    } else if (value.type === "ObjectExpression") {
      flatten(value, name, out);
    }
  }
}

/**
 * Pure: reads `theme.colors` and `theme.extend.colors` from a Tailwind config's
 * source, so classes like `bg-brand` resolve. Nested scales flatten to
 * `ink-500`; `DEFAULT` maps to the bare name.
 */
export function themeColorsFromConfig(code: string): ThemeColors {
  const ast = parse(code, { sourceType: "module", plugins: ["typescript"] });
  const out: Record<string, string> = {};
  traverse(ast, {
    ObjectProperty(path) {
      const { key, value } = path.node;
      if (keyName(key) === "colors" && value.type === "ObjectExpression") flatten(value, "", out);
    },
  });
  return out;
}
