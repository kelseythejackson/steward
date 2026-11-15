import { deltaE, findArbitraryClassColors, findColors, findNamedClassColors, JUST_NOTICEABLE_DELTA_E } from "@steward/scanner";
import type { CheckContext, ColorRef } from "../context.js";
import type { Finding } from "../findings.js";
import type { ClassUse, Snippet, StyleUse } from "../jsx.js";

/** Inline style properties and the Tailwind utility that sets the same thing. */
const STYLE_UTILITIES: Readonly<Record<string, string>> = {
  color: "text",
  backgroundColor: "bg",
  background: "bg",
  borderColor: "border",
  outlineColor: "outline",
  fill: "fill",
  stroke: "stroke",
  caretColor: "caret",
  accentColor: "accent",
  textDecorationColor: "decoration",
};

interface Nearest {
  token: ColorRef;
  distance: number;
  /** The `/50` opacity modifier to keep a see-through color see-through, or "". */
  opacity: string;
}

const opaqueHex = (value: string) => value.slice(0, 7);
const alphaOf = (value: string) => (value.length === 9 ? parseInt(value.slice(7), 16) / 255 : 1);
const round1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

/** The closest opaque token by ΔE, comparing color only; a see-through value keeps its opacity as a modifier. */
function nearestToken(ctx: CheckContext, value: string): Nearest | null {
  let best: Nearest | null = null;
  for (const token of ctx.colors) {
    if (token.alpha !== undefined) continue;
    const distance = deltaE(opaqueHex(value), token.hex);
    if (!best || distance < best.distance) best = { token, distance, opacity: "" };
  }
  if (!best) return null;
  const alpha = alphaOf(value);
  if (alpha < 1) best.opacity = `/${Math.round(alpha * 100)}`;
  return best;
}

/**
 * The message for one color outside the system. `what` says how it's written:
 * "hardcodes #3a81f5" or "uses `purple-500` from the Tailwind palette".
 */
function describe(found: string, what: string, raw: string, near: Nearest, replacement: string | undefined, useText: string): Pick<Finding, "message" | "evidence" | "fix"> {
  const t = near.token;
  const exact = near.distance < 0.05;
  const evidence = exact ? `${raw} is the same color as ${t.name} (${t.hex})` : `ΔE ${round1(near.distance)} from ${t.name} (${t.hex})`;
  const withReplacement = replacement ? { replacement } : {};
  if (exact) return { message: `\`${found}\` ${what}, the same color as your \`${t.name}\` token.`, evidence, fix: { description: `Use ${useText} instead.`, ...withReplacement } };
  if (near.distance <= JUST_NOTICEABLE_DELTA_E) {
    return { message: `\`${found}\` ${what}, which isn't one of your colors. It looks the same as \`${t.name}\`.`, evidence, fix: { description: `Use ${useText} instead.`, ...withReplacement } };
  }
  return {
    message: `\`${found}\` ${what}, which isn't one of your colors.`,
    evidence,
    fix: { description: `The nearest is \`${t.name}\`, so use ${useText}. If this color is intentional, add it to the system instead.` },
  };
}

function checkClass(ctx: CheckContext, use: ClassUse): Finding[] {
  const out: Finding[] = [];
  const tokenNames = new Set(ctx.colors.map((c) => c.name));
  const theme = Object.fromEntries(ctx.colors.map((c) => [c.name, c.hex]));

  for (const m of findArbitraryClassColors(use.className)) {
    const near = nearestToken(ctx, m.value);
    if (!near) continue;
    const bracket = use.className.indexOf("[");
    const isProperty = bracket === 0 || use.className[bracket - 1] === ":";
    // `bg-[#3a81f5]/50` → `bg-blue-500/50`; an arbitrary property like `[color:#fff]` has no single class to swap in.
    const swapped = isProperty ? undefined : use.className.replace(/\[[^\]]+\](\/(?:\d+|\[[^\]]+\]))?/, (_, modifier?: string) => `${near.token.name}${modifier ?? near.opacity}`);
    const useText = swapped ? `\`${swapped}\`` : `a class with \`${near.token.name}\``;
    out.push({ check: "hardcoded-color", category: "color", line: use.line, column: use.column, found: use.className, ...describe(use.className, `hardcodes ${m.raw}`, m.raw, near, swapped, useText) });
  }

  for (const m of findNamedClassColors(use.className, theme)) {
    const base = m.raw.replace(/\/.*$/, "");
    if (tokenNames.has(base) || base === "transparent" || base === "current" || base === "inherit") continue;
    const near = nearestToken(ctx, m.value);
    if (!near) continue;
    const swapped = use.className.slice(0, use.className.lastIndexOf(m.raw)) + near.token.name + m.raw.slice(base.length) + use.className.slice(use.className.lastIndexOf(m.raw) + m.raw.length);
    const what = `uses \`${base}\` from the Tailwind palette`;
    out.push({ check: "hardcoded-color", category: "color", line: use.line, column: use.column, found: use.className, ...describe(use.className, what, base, near, swapped, `\`${swapped}\``) });
  }
  return out;
}

function checkStyle(ctx: CheckContext, use: StyleUse): Finding[] {
  const out: Finding[] = [];
  for (const m of findColors(use.value)) {
    const near = nearestToken(ctx, m.value);
    if (!near) continue;
    const utility = STYLE_UTILITIES[use.property];
    const cls = utility ? `${utility}-${near.token.name}${near.opacity}` : undefined;
    const found = `${use.property}: "${use.value}"`;
    const useText = cls ? `\`${cls}\` as a class` : `\`${near.token.name}\` through a class`;
    out.push({ check: "hardcoded-color", category: "color", line: use.line, column: use.column, found, ...describe(found, `hardcodes ${m.raw}`, m.raw, near, undefined, useText) });
  }
  return out;
}

/**
 * Colors outside the system: hex, rgb() and other literals in classes
 * (`bg-[#3a81f5]`) and inline styles, plus Tailwind palette colors that
 * aren't tokens (`text-purple-500`). Suggests the nearest token by ΔE.
 */
export function checkHardcodedColors(snippet: Snippet, ctx: CheckContext): Finding[] {
  if (ctx.colors.length === 0) return [];
  return [...snippet.classes.flatMap((c) => checkClass(ctx, c)), ...snippet.styles.flatMap((s) => checkStyle(ctx, s))];
}
