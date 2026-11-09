import { parse as parseColor, formatHex } from "culori";
import { lineLocator } from "../colors/lines.js";
import { findColors } from "../colors/normalize.js";
import { blankComments } from "../colors/stylesheet.js";
import type { ContrastExtraction, FocusFinding, InteractionState, PairOccurrence } from "./types.js";

interface Declaration {
  prop: string;
  value: string;
  line: number;
}

function stateOf(selector: string): InteractionState {
  if (/:focus(-visible)?\b/.test(selector)) return "focus";
  if (/:hover\b/.test(selector)) return "hover";
  return "base";
}

function firstColor(value: string): { hex: string; alpha: number } | null {
  const match = findColors(value)[0];
  const parsed = match ? parseColor(match.raw) : undefined;
  return parsed ? { hex: formatHex(parsed), alpha: parsed.alpha ?? 1 } : null;
}

const lastWhere = <T,>(xs: readonly T[], pred: (x: T) => boolean): T | undefined => [...xs].reverse().find(pred);

const removesOutline = (d: Declaration) => d.prop === "outline" && /^(none|0)$/.test(d.value);
const isFocusIndicator = (d: Declaration) =>
  (d.prop === "box-shadow" && d.value !== "none") ||
  (d.prop.startsWith("outline") && d.prop !== "outline-offset" && !removesOutline(d) && !/^(none|0|transparent)$/.test(d.value));

/**
 * Pure: finds color pairs in CSS rules that set both `color` and a background,
 * and `:focus` rules that remove the outline with no visible replacement.
 * Rules inside `@media` blocks are read like any other rule.
 */
export function extractCssContrast(code: string, file: string): ContrastExtraction {
  const text = blankComments(code, file.endsWith(".scss"));
  const lineAt = lineLocator(code);
  const pairs: PairOccurrence[] = [];
  const focus: FocusFinding[] = [];
  const skipped: ContrastExtraction["skipped"] = [];

  for (const rule of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    // The match can start with earlier statements (`@tailwind base;`); the selector is what follows the last `;`.
    const prelude = rule[1]!;
    const selector = prelude.slice(prelude.lastIndexOf(";") + 1).trim().replace(/\s+/g, " ");
    if (selector === "" || selector.startsWith("@")) continue;
    const bodyStart = rule.index + prelude.length + 1;

    const decls: Declaration[] = [];
    for (const part of rule[2]!.matchAll(/[^;]+/g)) {
      const colon = part[0].indexOf(":");
      if (colon === -1) continue;
      const prop = part[0].slice(0, colon).trim().toLowerCase();
      const offset = part[0].length - part[0].trimStart().length;
      decls.push({ prop, value: part[0].slice(colon + 1).trim(), line: lineAt(bodyStart + part.index + offset) });
    }

    const state = stateOf(selector);
    const colorDecl = lastWhere(decls, (d) => d.prop === "color");
    const bgDecl = lastWhere(decls, (d) => d.prop === "background" || d.prop === "background-color");
    const fg = colorDecl ? firstColor(colorDecl.value) : null;
    const bg = bgDecl ? firstColor(bgDecl.value) : null;
    if (fg && bg && colorDecl) {
      if (fg.alpha < 1 || bg.alpha < 1) {
        skipped.push({ file, line: colorDecl.line, reason: "semi-transparent color; contrast depends on what's behind it" });
      } else {
        pairs.push({ foreground: fg.hex, background: bg.hex, use: "text", state, file, line: colorDecl.line, component: selector, backgroundAssumed: false });
      }
    }

    const outline = decls.find(removesOutline);
    if (state === "focus" && outline && !decls.some(isFocusIndicator)) {
      focus.push({
        file,
        line: outline.line,
        component: selector,
        element: selector,
        reason: `This rule removes the focus outline (\`outline: ${outline.value}\`) and sets no other visible focus style. Add a \`box-shadow\` or a visible \`outline\` instead.`,
      });
    }
  }
  return { pairs, focus, skipped };
}
