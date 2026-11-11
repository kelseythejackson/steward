import { compareStrings } from "@steward/model";
import { isTailwindConfig } from "./colors/script.js";
import { cssValueColor } from "./colors/normalize.js";
import { blankComments } from "./colors/stylesheet.js";
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
}

const isStylesheet = (p: string) => p.endsWith(".css") || p.endsWith(".scss");
const V4_MARKER = /@import\s+["']tailwindcss["']|@theme\b/;
/** Selectors for dark-mode overrides. Only light values feed the theme, since `dark:` isn't checked yet. */
const DARK_SELECTOR = /\.dark\b|\[data-(?:theme|mode)=["']?dark|prefers-color-scheme:\s*dark/;

/** Detects Tailwind 4 from its CSS entry point. */
export function tailwindVersion(files: readonly SourceFile[]): TailwindVersion {
  return files.some((f) => isStylesheet(f.path) && V4_MARKER.test(blankComments(f.content, f.path.endsWith(".scss")))) ? 4 : 3;
}

/**
 * Pure: custom property declarations in one stylesheet, raw values as
 * written, from light-mode rules only (`:root`, `@theme`, `html`, `@layer`
 * blocks). Later declarations win.
 */
export function cssVariableDeclarations(code: string, scss = false): Record<string, string> {
  const text = blankComments(code, scss);
  const out: Record<string, string> = {};
  for (const rule of text.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const prelude = rule[1]!;
    const selector = prelude.slice(prelude.lastIndexOf(";") + 1).trim();
    if (DARK_SELECTOR.test(selector)) continue;
    for (const decl of rule[2]!.matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)) out[decl[1]!] = decl[2]!.trim();
  }
  return out;
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
  return { version, theme, variables };
}
