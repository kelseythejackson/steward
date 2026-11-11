import { compareStrings } from "@steward/model";
import { isTailwindConfig } from "./colors/script.js";
import { cssValueColor } from "./colors/normalize.js";
import { blankComments, parseCss, type CssRule } from "./css.js";
import type { SourceFile } from "./colors/types.js";
import type { ThemeColors } from "./contrast/classes.js";
import { TAILWIND_V4_PALETTE } from "./contrast/palette-v4.js";
import { themeColorsFromConfig } from "./contrast/theme.js";

export type TailwindVersion = 3 | 4;

/** What the repo's Tailwind setup means for reading its classes. Found once per scan. */
export interface TailwindSetup {
  /** 4 when a stylesheet uses `@import "tailwindcss"` or `@theme`; otherwise 3. */
  version: TailwindVersion;
  /**
   * Color names classes can use, to hex: theme colors from the config and
   * from `@theme` (`--color-brand` → `brand`), shadcn-style names
   * (`primary: "hsl(var(--primary))"`) and, on v4, the v4 palette.
   */
  theme: ThemeColors;
  /** Light-mode CSS custom properties that hold a color, e.g. `{ "--primary": "#0f172a" }`. */
  variables: Readonly<Record<string, string>>;
  /** Root font size in px (16 unless `html { font-size }` changes it). rem and Tailwind's spacing and text sizes scale with it. */
  rootPx: number;
}

const isStylesheet = (p: string) => p.endsWith(".css") || p.endsWith(".scss");
const V4_MARKER = /@import\s+["']tailwindcss["']|@theme\b/;
/** Selectors for dark-mode overrides. Only light values feed the theme, since `dark:` isn't checked yet. */
const DARK_SELECTOR = /\.dark\b|\[data-(?:theme|mode)=["']?dark|prefers-color-scheme:\s*dark/;

/** Detects Tailwind 4 from its CSS entry point. */
export function tailwindVersion(files: readonly SourceFile[]): TailwindVersion {
  return files.some((f) => isStylesheet(f.path) && V4_MARKER.test(blankComments(f.content, f.path.endsWith(".scss")))) ? 4 : 3;
}

/** True for rules that only apply in dark mode, which the theme doesn't use since `dark:` isn't checked yet. */
const isDark = (rule: CssRule) => DARK_SELECTOR.test(rule.selector) || rule.atRules.some((a) => DARK_SELECTOR.test(a));

/**
 * Pure: custom property declarations in one stylesheet, raw values as
 * written, from light-mode rules only (`:root`, `@theme`, `html`, `@layer`
 * blocks; not `.dark` or `@media (prefers-color-scheme: dark)`). Later
 * declarations win.
 */
export function cssVariableDeclarations(code: string, scss = false): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rule of parseCss(code, scss)) {
    if (isDark(rule)) continue;
    for (const d of rule.declarations) if (d.prop.startsWith("--")) out[d.prop] = d.value;
  }
  return out;
}

/** The browser default, which rem and Tailwind's spacing and text sizes are measured against. */
export const DEFAULT_ROOT_PX = 16;

/**
 * Pure: the root font size in px from `html { font-size: … }` (or `:root`),
 * e.g. `62.5%` → 10. Rules inside `@media` are ignored, since only the
 * default size is used. Returns null when the stylesheet doesn't set it.
 */
export function rootFontSize(code: string, scss = false): number | null {
  let px: number | null = null;
  for (const rule of parseCss(code, scss)) {
    if (rule.atRules.some((a) => a.startsWith("@media")) || !rule.selector.split(",").some((s) => /^(?:html|:root)$/.test(s.trim()))) continue;
    for (const d of rule.declarations) {
      if (d.prop !== "font-size") continue;
      const m = /^(\d*\.?\d+)(px|%|rem|em)$/.exec(d.value.replace(/!important$/, "").trim());
      if (m) px = m[2] === "px" ? Number(m[1]) : m[2] === "%" ? (DEFAULT_ROOT_PX * Number(m[1])) / 100 : DEFAULT_ROOT_PX * Number(m[1]);
    }
  }
  return px;
}

/** The repo's root font size in px, from its stylesheets (last one wins), or 16. */
export function rootPxOf(files: readonly SourceFile[]): number {
  let px = DEFAULT_ROOT_PX;
  for (const f of [...files].sort((a, b) => compareStrings(a.path, b.path))) {
    if (!isStylesheet(f.path)) continue;
    px = rootFontSize(f.content, f.path.endsWith(".scss")) ?? px;
  }
  return px;
}

/**
 * Resolves a CSS color value to a canonical hex, following `var()` (with
 * fallbacks) through the given variables. Handles bare HSL channels and
 * Tailwind 3's `<alpha-value>` placeholder. Null when it isn't a color.
 */
export function resolveCssColor(value: string, variables: Readonly<Record<string, string>>): string | null {
  const v = substituteVariables(value, variables);
  return v === null ? null : cssValueColor(v);
}

/**
 * Replaces each `var(--x, fallback)` with the variable's raw text, the way
 * CSS does, so `hsl(var(--primary) / 0.5)` with `--primary: 222 47% 11%`
 * becomes `hsl(222 47% 11% / 0.5)`. Null if a variable is missing with no fallback, or refers to itself.
 */
function substituteVariables(value: string, variables: Readonly<Record<string, string>>): string | null {
  let v = value.trim().replace(/<alpha-value>/g, "1");
  for (let guard = 0; v.includes("var("); guard++) {
    if (guard > 32) return null; // a cycle like `--a: var(--b); --b: var(--a)`
    let missing = false;
    // The innermost var() has no parentheses inside, so nested fallbacks resolve from the inside out.
    v = v.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/, (_m, name: string, fallback?: string) => {
      const raw = variables[name] ?? fallback;
      if (raw === undefined) missing = true;
      return raw?.trim() ?? "";
    });
    if (missing) return null;
  }
  return v;
}

/**
 * Pure: reads a repo's Tailwind setup from its stylesheets and config.
 * Configs and stylesheets that can't be read are skipped here; the
 * extractors report them.
 */
export function tailwindSetup(files: readonly SourceFile[]): TailwindSetup {
  const sorted = [...files].sort((a, b) => compareStrings(a.path, b.path));
  const version = tailwindVersion(sorted);

  const declared: Record<string, string> = {};
  for (const f of sorted) if (isStylesheet(f.path)) Object.assign(declared, cssVariableDeclarations(f.content, f.path.endsWith(".scss")));
  const variables: Record<string, string> = {};
  for (const name of Object.keys(declared).sort(compareStrings)) {
    const hex = resolveCssColor(declared[name]!, declared);
    if (hex) variables[name] = hex;
  }

  const theme: Record<string, string> = version === 4 ? { ...TAILWIND_V4_PALETTE } : {};
  // Tailwind 4: `@theme { --color-brand: … }` makes `bg-brand`.
  for (const [name, hex] of Object.entries(variables)) if (name.startsWith("--color-")) theme[name.slice("--color-".length)] = hex;
  for (const f of sorted) {
    if (!isTailwindConfig(f.path)) continue;
    try {
      Object.assign(theme, themeColorsFromConfig(f.content, (value) => resolveCssColor(value, declared)));
    } catch {
      // Theme names from this config just won't resolve.
    }
  }
  return { version, theme, variables, rootPx: rootPxOf(sorted) };
}
