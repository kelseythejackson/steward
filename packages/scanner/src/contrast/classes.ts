import { formatHex, parse } from "culori";
import { TAILWIND_PALETTE } from "./palette.js";
import type { InteractionState } from "./types.js";

/** Theme colors from the Tailwind config, e.g. `{ brand: "#2563eb", "ink-500": "#6b7280" }`. */
export type ThemeColors = Readonly<Record<string, string>>;

export interface ResolvedColor {
  /** Canonical 6-digit hex, without alpha. */
  hex: string;
  /** 0–1. Below 1 the real color depends on what's behind it. */
  alpha: number;
}

export interface StateStyle {
  text?: ResolvedColor;
  bg?: ResolvedColor | "transparent";
  border?: ResolvedColor;
}

export interface ClassListStyle {
  states: Partial<Record<InteractionState, StateStyle>>;
  fontSizePx?: number;
  fontWeight?: number;
  /** True if the classes remove the outline (`outline-none`, `focus:outline-none`, `outline-0`). */
  removesOutline: boolean;
  /** The class that removed it, for explanations. */
  outlineClass?: string;
  /** True if a `focus:`/`focus-visible:` ring, outline or shadow replaces it. */
  hasFocusIndicator: boolean;
  /** Classes whose variant isn't checked (`dark:`, `disabled:`, `group-hover:`…). */
  ignored: string[];
}

const FONT_SIZES: Readonly<Record<string, number>> = {
  xs: 12, sm: 14, base: 16, lg: 18, xl: 20, "2xl": 24, "3xl": 30, "4xl": 36, "5xl": 48, "6xl": 60, "7xl": 72, "8xl": 96, "9xl": 128,
};

const FONT_WEIGHTS: Readonly<Record<string, number>> = {
  thin: 100, extralight: 200, light: 300, normal: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800, black: 900,
};

const RESPONSIVE = new Set(["sm", "md", "lg", "xl", "2xl"]);
const STATE_VARIANTS: Readonly<Record<string, InteractionState>> = { hover: "hover", focus: "focus", "focus-visible": "focus" };

/** Splits `hover:bg-[color:#fff]` on colons outside brackets. */
function splitVariants(cls: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < cls.length; i++) {
    const ch = cls[i];
    if (ch === "[") depth++;
    else if (ch === "]") depth--;
    else if (ch === ":" && depth === 0) {
      parts.push(cls.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(cls.slice(start));
  return parts;
}

function toResolved(value: string, alpha = 1): ResolvedColor | null {
  const parsed = parse(value);
  if (!parsed) return null;
  return { hex: formatHex(parsed), alpha: Number(((parsed.alpha ?? 1) * alpha).toFixed(4)) };
}

/**
 * Resolves the color part of a utility (`white`, `red-600`, `[#3b82f6]`,
 * `black/40`, a theme name) to a hex and alpha. Returns null for anything
 * that isn't a color (`sm`, `left`, `[13px]`, `transparent`).
 */
export function resolveColorName(name: string, theme: ThemeColors = {}): ResolvedColor | null {
  let body = name;
  let alpha = 1;
  // Opacity modifier outside any brackets: `black/40`, `[#3b82f6]/[0.25]`.
  const closing = body.startsWith("[") ? body.indexOf("]") : -1;
  const slash = body.indexOf("/", closing + 1);
  if (slash !== -1) {
    const mod = body.slice(slash + 1);
    const m = /^(\d+)$|^\[(\d*\.?\d+)\]$/.exec(mod);
    if (!m) return null;
    alpha = m[1] !== undefined ? Number(m[1]) / 100 : Number(m[2]);
    body = body.slice(0, slash);
  }

  if (body.startsWith("[") && body.endsWith("]")) {
    const inner = body.slice(1, -1).replace(/^color:/, "").replaceAll("_", " ");
    if (/^-?\d/.test(inner)) return null; // a length like 13px, not a color
    return toResolved(inner, alpha);
  }
  const named = theme[body] ?? TAILWIND_PALETTE[body];
  return named ? toResolved(named, alpha) : null;
}

function isFocusIndicator(utility: string): boolean {
  return (
    utility === "ring" ||
    /^ring-([1-9]\d*|\[\d)/.test(utility) ||
    utility === "outline" ||
    /^outline-(solid|dashed|dotted|double|[1-9]\d*|\[\d)/.test(utility) ||
    utility === "shadow" ||
    /^shadow-(sm|md|lg|xl|2xl|inner|\[)/.test(utility)
  );
}

/** Pure: reads the colors, font size and weight, and focus styling from one class string. */
export function parseClassList(classes: string, theme: ThemeColors = {}): ClassListStyle {
  const out: ClassListStyle = { states: {}, removesOutline: false, hasFocusIndicator: false, ignored: [] };
  const stateStyle = (s: InteractionState) => (out.states[s] ??= {});

  for (const cls of classes.split(/\s+/).filter(Boolean)) {
    const parts = splitVariants(cls.replace(/^!/, ""));
    const utility = parts.pop()!.replace(/^!/, "");
    let state: InteractionState = "base";
    let unsupported = false;
    for (const v of parts) {
      if (RESPONSIVE.has(v)) continue;
      const s = STATE_VARIANTS[v];
      if (s) state = s;
      else unsupported = true;
    }
    if (unsupported) {
      out.ignored.push(cls);
      continue;
    }

    if (utility === "outline-none" || utility === "outline-0") {
      if (state !== "hover") {
        out.removesOutline = true;
        out.outlineClass ??= cls;
      }
      continue;
    }
    if (state === "focus" && isFocusIndicator(utility)) out.hasFocusIndicator = true;

    if (utility.startsWith("text-")) {
      const rest = utility.slice(5);
      const size = FONT_SIZES[rest];
      const arbitrarySize = /^\[(\d*\.?\d+)(px|rem)\]$/.exec(rest);
      if (size !== undefined || arbitrarySize) {
        if (state === "base") out.fontSizePx = size ?? Number(arbitrarySize![1]) * (arbitrarySize![2] === "rem" ? 16 : 1);
        continue;
      }
      const c = resolveColorName(rest, theme);
      if (c) stateStyle(state).text = c;
    } else if (utility.startsWith("bg-")) {
      const rest = utility.slice(3);
      if (rest === "transparent") stateStyle(state).bg = "transparent";
      else {
        const c = resolveColorName(rest, theme);
        if (c) stateStyle(state).bg = c;
      }
    } else if (utility.startsWith("border-")) {
      const m = /^border(?:-[xytrblse])?-(.+)$/.exec(utility);
      const c = m ? resolveColorName(m[1]!, theme) : null;
      if (c) stateStyle(state).border = c;
    } else if (utility.startsWith("font-") && state === "base") {
      const w = FONT_WEIGHTS[utility.slice(5)];
      if (w !== undefined) out.fontWeight = w;
    }
  }
  return out;
}
