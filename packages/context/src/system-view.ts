import {
  compareStrings,
  isToken,
  STEWARD_EXTENSION,
  type ColorToken,
  type ComponentEntry,
  type ContrastSuggestion,
  type DimensionToken,
  type Rule,
  type SystemModel,
  type TokenGroup,
} from "@steward/model";
import { STATIC_CHECKS_NOTE } from "@steward/guard";

/**
 * What Steward Brief shows an AI tool, read the same way by design.md and the
 * MCP server: tokens, shared components (minus ones merged away) and enabled
 * rules. Only what people decided; pending suggestions are only counted.
 */

export const code = (s: string) => `\`${s}\``;
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const list = (xs: readonly string[], joiner = "and") =>
  xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} ${joiner} ${xs[xs.length - 1]}`;

/** `color.gray.400` → `gray-400`, the name used in Tailwind classes. Matches the scanner's labels. */
export const colorLabel = (path: string) => path.replace(/^color\./, "").replaceAll(".", "-");
/**
 * How a token is written in a Tailwind class. A see-through token is its color with
 * Tailwind's opacity modifier: `color.black-40` at 40% → `black/40` (as in `bg-black/40`).
 * `black-40` isn't a class: Tailwind would silently render nothing.
 */
export function colorName(c: { path: string; token: { $value: { alpha?: number } } }): string {
  const label = colorLabel(c.path);
  const alpha = c.token.$value.alpha;
  if (alpha === undefined || alpha >= 1) return label;
  const pct = Math.round(alpha * 100);
  return `${label.endsWith(`-${pct}`) ? label.slice(0, -`-${pct}`.length) : label}/${pct}`;
}
/** `spacing.2_5` → `2.5`, the Tailwind class suffix. */
export const spacingKey = (path: string) => path.replace(/^spacing\./, "").replace("_", ".");

/** The line printed with every set of accessibility rules: static checks are only part of the story. Shared with Steward Review. */
export { STATIC_CHECKS_NOTE };

/** WCAG 2 contrast ratio between two opaque hex colors. */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

function flatten(group: TokenGroup, prefix = ""): { path: string; token: ColorToken | DimensionToken }[] {
  const out: { path: string; token: ColorToken | DimensionToken }[] = [];
  for (const key of Object.keys(group).sort(compareStrings)) {
    const node = group[key]!;
    const path = prefix ? `${prefix}.${key}` : key;
    if (isToken(node)) out.push({ path, token: node });
    else out.push(...flatten(node, path));
  }
  return out;
}

/** Orders `gray.50, gray.100, … gray.900` numerically instead of as text. */
export function comparePaths(a: string, b: string): number {
  const pa = a.split(/[.-]/);
  const pb = b.split(/[.-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? "";
    const y = pb[i] ?? "";
    if (x === y) continue;
    const nx = Number(x.replace("_", "."));
    const ny = Number(y.replace("_", "."));
    if (x !== "" && y !== "" && !Number.isNaN(nx) && !Number.isNaN(ny)) return nx - ny;
    return compareStrings(x, y);
  }
  return 0;
}

export const usesOf = (t: { token: ColorToken | DimensionToken }) => t.token.$extensions?.[STEWARD_EXTENSION]?.uses ?? 0;
/** The most used token, for examples; ties go to the earlier one. */
export const mostUsed = <T extends { token: ColorToken | DimensionToken }>(ts: readonly T[]): T =>
  ts.reduce((best, t) => (usesOf(t) > usesOf(best) ? t : best));

export interface SystemView {
  colors: { path: string; token: ColorToken }[];
  spacing: { path: string; token: DimensionToken }[];
  components: ComponentEntry[];
  /** Components merged into another by an accepted decision, with the one to use instead. */
  replaced: Map<string, string>;
  /** Enabled rules only. */
  rules: Rule[];
  pending: number;
}

export function systemView(model: SystemModel): SystemView {
  const tokens = flatten(model.tokens);
  const colors = tokens
    .filter((t): t is { path: string; token: ColorToken } => t.token.$type === "color")
    .sort((a, b) => comparePaths(a.path, b.path));
  const spacing = tokens
    .filter((t): t is { path: string; token: DimensionToken } => t.token.$type === "dimension" && t.path.startsWith("spacing."))
    .sort((a, b) => a.token.$value.value - b.token.$value.value);

  const accepted = new Set(model.decisions.filter((d) => d.status === "accepted").map((d) => d.suggestionId));
  const replaced = new Map<string, string>();
  for (const s of model.suggestions) {
    if (s.kind !== "component" || !accepted.has(s.id)) continue;
    for (const m of s.members) if (m !== s.proposed.name) replaced.set(m, s.proposed.name);
  }
  const label = (c: ComponentEntry, all: readonly ComponentEntry[]) =>
    all.filter((o) => o.name === c.name).length > 1 ? `${c.name} (${c.filePath})` : c.name;
  // Shared components only: pages and the app shell aren't for reuse.
  const components = model.components
    .filter((c) => /(^|\/)components\//.test(c.filePath))
    .filter((c) => !replaced.has(label(c, model.components)) && !replaced.has(c.name))
    .sort((a, b) => compareStrings(a.name, b.name) || compareStrings(a.filePath, b.filePath));

  const decided = new Set(model.decisions.map((d) => d.suggestionId));
  return {
    colors,
    spacing,
    components,
    replaced,
    rules: model.rules.filter((r) => r.enabled),
    pending: model.suggestions.filter((s) => !decided.has(s.id)).length,
  };
}

/** Short notes for colors with open contrast problems, e.g. "Not for text on white or gray-50." Keyed by token path. */
export function contrastNotes(model: SystemModel, colors: SystemView["colors"]): Map<string, string> {
  const byHex = new Map<string, string>();
  for (const c of colors) if (c.token.$value.alpha === undefined) byHex.set(c.token.$value.hex, colorLabel(c.path));
  const name = (hex: string) => byHex.get(hex) ?? hex;
  const contrast = new Map(model.suggestions.filter((s): s is ContrastSuggestion => s.kind === "contrast").map((s) => [s.id, s]));

  const notes = new Map<string, string>();
  for (const c of colors) {
    const ids = c.token.$extensions?.[STEWARD_EXTENSION]?.contrastIssues ?? [];
    const asText = new Set<string>();
    const asBackground = new Set<string>();
    for (const id of ids) {
      const s = contrast.get(id);
      if (!s) continue;
      if (s.pair.foreground === c.token.$value.hex) asText.add(name(s.pair.background));
      else asBackground.add(name(s.pair.foreground));
    }
    const parts: string[] = [];
    if (asText.size > 0) parts.push(`Not for text on ${list([...asText].sort(comparePaths), "or")}.`);
    if (asBackground.size > 0) parts.push(`Not behind ${list([...asBackground].sort(comparePaths), "or")} text.`);
    if (parts.length > 0) notes.set(c.path, parts.join(" "));
  }
  return notes;
}

/** One realistic usage line from what the inventory knows: a variant, a title-like prop, children. */
export function usage(c: ComponentEntry): string {
  const props = c.props ?? [];
  const attrs: string[] = [];
  if (c.variants.length > 0) attrs.push(`variant="${c.variants.includes("primary") ? "primary" : [...c.variants].sort(compareStrings)[0]}"`);
  if (props.includes("open")) attrs.push("open={isOpen}");
  const titled = ["label", "title", "heading"].find((t) => props.includes(t));
  if (titled) attrs.push(`${titled}="…"`);
  // Every other prop the type requires, so the example compiles as written.
  const named = new Set(["variant", "open", "children", ...(titled ? [titled] : [])]);
  for (const p of c.requiredProps ?? []) if (!named.has(p)) attrs.push(`${p}={…}`);
  const open = [c.name, ...attrs].join(" ");
  return props.includes("children") ? `<${open}>…</${c.name}>` : `<${open} />`;
}

/**
 * Where to import a component from: its file, from the repo root. Not an import statement: a
 * root-relative path like `src/components/Button` only resolves with a path alias, which most repos don't set.
 */
export const importLine = (c: ComponentEntry) => `${c.name} is exported from ${c.filePath}; import it with a path relative to your file.`;

/** Names merged into `c` by accepted decisions, e.g. `["CTAButton", "PrimaryBtn"]`. */
export const replacedBy = (view: SystemView, c: ComponentEntry) =>
  [...view.replaced].filter(([, keep]) => keep === c.name).map(([old]) => old.replace(/ \(.*\)$/, ""));
