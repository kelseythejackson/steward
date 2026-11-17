import { colorFamily, deltaE, findArbitraryClassColors, findColors, findNamedClassColors, JUST_NOTICEABLE_DELTA_E, looksSame } from "@steward/scanner";
import type { CheckContext, ColorRef } from "../context.js";
import type { ClassUse, ParsedFile, StyleUse } from "../parse.js";
import { replaceRange, type GuardRule, type Hit } from "../rule.js";

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
  /** Close enough and the same color family to look the same, so swapping in the token is safe. */
  same: boolean;
  /** The found color, opaque. */
  hex: string;
}

const opaqueHex = (value: string) => value.slice(0, 7);
const alphaOf = (value: string) => (value.length === 9 ? parseInt(value.slice(7), 16) / 255 : 1);
const round1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

/** A see-through color that is exactly a see-through token (opacity within 1%). */
function isSeeThroughToken(ctx: CheckContext, value: string): boolean {
  const alpha = alphaOf(value);
  return alpha < 1 && ctx.colors.some((t) => t.alpha !== undefined && t.hex === opaqueHex(value).toLowerCase() && Math.abs(t.alpha - alpha) < 0.01);
}

/** The closest opaque token by ΔE, comparing color only; a see-through value keeps its opacity as a modifier. */
function nearestToken(ctx: CheckContext, value: string): Nearest | null {
  let best: Nearest | null = null;
  for (const token of ctx.colors) {
    if (token.alpha !== undefined) continue;
    const distance = deltaE(opaqueHex(value), token.hex);
    if (!best || distance < best.distance) best = { token, distance, opacity: "", same: false, hex: opaqueHex(value).toLowerCase() };
  }
  if (!best) return null;
  best.same = looksSame(opaqueHex(value), best.token.hex);
  const alpha = alphaOf(value);
  if (alpha < 1) best.opacity = `/${Math.round(alpha * 100)}`;
  return best;
}

/**
 * The message for one color outside the system. `what` says how it's written:
 * "hardcodes #3a81f5" or "uses `purple-500` from the Tailwind palette".
 */
function describe(found: string, what: string, raw: string, near: Nearest, replacement: string | undefined, useText: string): Pick<Hit, "message" | "evidence" | "fix"> {
  const t = near.token;
  const exact = near.distance < 0.05;
  const evidence = exact ? `${raw} is the same color as ${t.name} (${t.hex})` : `ΔE ${round1(near.distance)} from ${t.name} (${t.hex})`;
  const withReplacement = replacement ? { replacement } : {};
  if (exact) return { message: `\`${found}\` ${what}, the same color as your \`${t.name}\` token.`, evidence, fix: { description: `Use ${useText} instead.`, ...withReplacement } };
  if (near.same) {
    return { message: `\`${found}\` ${what}, which isn't one of your colors. It looks the same as \`${t.name}\`.`, evidence, fix: { description: `Use ${useText} instead.`, ...withReplacement } };
  }
  // Close, but a different hue (a pale blue next to a gray): swapping would change the design, so no swap is offered.
  const hex = near.hex;
  if (near.distance <= JUST_NOTICEABLE_DELTA_E) {
    const [mine, theirs] = [colorFamily(hex), colorFamily(t.hex)];
    return {
      message: `\`${found}\` ${what}, which isn't one of your colors. It's close to \`${t.name}\`, but ${article(mine)} ${mine}, not ${article(theirs)} ${theirs}.`,
      evidence: `${evidence}; ${mine}, not ${theirs}`,
      fix: { description: `If this ${mine} is intentional, add it to the system. Otherwise use ${useText}.` },
    };
  }
  return {
    message: `\`${found}\` ${what}, which isn't one of your colors.`,
    evidence,
    fix: { description: `The nearest is \`${t.name}\`, so use ${useText}. If this color is intentional, add it to the system instead.` },
  };
}

const at = (use: ClassUse | StyleUse) => ({ line: use.line, column: use.column });
const article = (word: string) => (/^[aeiou]/.test(word) ? "an" : "a");

function checkClass(ctx: CheckContext, use: ClassUse): Hit[] {
  const out: Hit[] = [];
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
    out.push({ ...at(use), range: use.range, found: use.className, ...describe(use.className, `hardcodes ${m.raw}`, m.raw, near, swapped, useText) });
  }

  for (const m of findNamedClassColors(use.className, theme)) {
    const base = m.raw.replace(/\/.*$/, "");
    if (tokenNames.has(base) || base === "transparent" || base === "current" || base === "inherit") continue;
    // `bg-black/40` is how Tailwind writes a see-through token like `black-40`: same color, same opacity.
    if (isSeeThroughToken(ctx, m.value)) continue;
    const near = nearestToken(ctx, m.value);
    if (!near) continue;
    const swapped = use.className.slice(0, use.className.lastIndexOf(m.raw)) + near.token.name + m.raw.slice(base.length) + use.className.slice(use.className.lastIndexOf(m.raw) + m.raw.length);
    const what = `uses \`${base}\` from the Tailwind palette`;
    out.push({ ...at(use), range: use.range, found: use.className, ...describe(use.className, what, base, near, swapped, `\`${swapped}\``) });
  }
  return out;
}

function checkStyle(ctx: CheckContext, use: StyleUse): Hit[] {
  const out: Hit[] = [];
  for (const m of findColors(use.value)) {
    const near = nearestToken(ctx, m.value);
    if (!near) continue;
    const utility = STYLE_UTILITIES[use.property];
    const cls = utility ? `${utility}-${near.token.name}${near.opacity}` : undefined;
    const found = `${use.property}: "${use.value}"`;
    const useText = cls ? `\`${cls}\` as a class` : `\`${near.token.name}\` through a class`;
    // Moving a style into a class is a bigger edit than a swap, so there's no automatic fix.
    out.push({ ...at(use), range: { start: 0, end: 0 }, found, ...describe(found, `hardcodes ${m.raw}`, m.raw, near, undefined, useText) });
  }
  return out;
}

/**
 * Colors outside the system: hex, rgb() and other literals in classes
 * (`bg-[#3a81f5]`) and inline styles, plus Tailwind palette colors that
 * aren't tokens (`text-purple-500`). Suggests the nearest token by ΔE, and
 * swaps it in only when the two look the same.
 */
export const noHardcodedColor: GuardRule = {
  id: "no-hardcoded-color",
  description: "Use a color token instead of a hardcoded color or a Tailwind color that isn't in the system.",
  category: "color",
  severity: "warn",
  covers: (ctx) => (ctx.colors.length === 0 ? [] : [{ label: "colors outside the system" }]),
  check(file: ParsedFile, ctx: CheckContext): Hit[] {
    if (ctx.colors.length === 0) return [];
    return [...file.classes.flatMap((c) => checkClass(ctx, c)), ...file.styles.flatMap((s) => checkStyle(ctx, s))];
  },
  fix: (_file, hit) => replaceRange(hit),
};
