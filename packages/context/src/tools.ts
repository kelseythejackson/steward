import { compareStrings, type ComponentEntry, type Rule, type RuleCategory, type SystemModel } from "@steward/model";
import { checkCode, describeCheck, parseFile, type CheckResult } from "@steward/guard";
import { examplePair } from "./design-md.js";
import { STOPWORDS, SYNONYMS } from "./synonyms.js";
import {
  colorLabel,
  colorName,
  contrastNotes,
  importLine,
  list,
  mostUsed,
  plural,
  replacedBy,
  spacingKey,
  STATIC_CHECKS_NOTE,
  systemView,
  usage,
  usesOf,
  type SystemView,
} from "./system-view.js";

/**
 * Pure functions behind the Steward Brief MCP tools. Each returns readable
 * text for the AI tool plus the same facts as data. Same model in, same
 * result out.
 */
export interface ToolResult<T> {
  text: string;
  data: T;
}

const IMPORT_NOTE = "Files are given from the repo root. Import each component with a path relative to the file you're editing.";

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

/** Lowercase words, with a plural `s` dropped so "buttons" finds "button". */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w !== "")
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}

/** `CTAButton` → `cta button`, `TextField` → `text field`. */
const splitCamel = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");

const hasPhrase = (haystack: readonly string[], phrase: string) => {
  const p = words(phrase);
  return haystack.some((_, i) => p.every((w, j) => haystack[i + j] === w));
};

// ---------------------------------------------------------------------------
// get_tokens
// ---------------------------------------------------------------------------

export type TokenType = "color" | "spacing";

export interface ColorTokenInfo {
  /** The name used in Tailwind classes, e.g. `gray-400`. */
  name: string;
  path: string;
  hex: string;
  alpha?: number;
  uses: number;
  /** Open contrast problems, e.g. "Not for text on gray-50, gray-100 or white." */
  note?: string;
}

export interface SpacingTokenInfo {
  /** The Tailwind step, e.g. `4` for `p-4`. */
  step: string;
  path: string;
  px: number;
  uses: number;
}

export interface TokensData {
  colors?: ColorTokenInfo[];
  spacing?: SpacingTokenInfo[];
}

export function getTokens(model: SystemModel, type?: TokenType): ToolResult<TokensData> {
  const view = systemView(model);
  const data: TokensData = {};
  const lines: string[] = [];

  if (type !== "spacing") {
    const notes = contrastNotes(model, view.colors);
    data.colors = view.colors.map((c) => {
      const info: ColorTokenInfo = { name: colorName(c), path: c.path, hex: c.token.$value.hex, uses: usesOf(c) };
      if (c.token.$value.alpha !== undefined) info.alpha = c.token.$value.alpha;
      const note = notes.get(c.path);
      if (note) info.note = note;
      return info;
    });
    const solid = view.colors.filter((c) => c.token.$value.alpha === undefined);
    const pair = examplePair(view.colors);
    const example = view.colors.length > 0 ? `, e.g. \`${pair ?? `bg-${colorName(mostUsed(solid.length > 0 ? solid : view.colors))}`}\`` : "";
    lines.push(`Colors (${data.colors.length}). Use the name in Tailwind classes${example}; never a hex value.`);
    for (const c of data.colors) {
      const value = c.alpha === undefined ? c.hex : `${c.hex} at ${Math.round(c.alpha * 100)}%`;
      lines.push(`- ${c.name}: ${value}, used ${plural(c.uses, "time")}${c.note ? `. ${c.note}` : ""}`);
    }
    if (data.colors.length === 0) lines.push("- No color tokens yet.");
  }

  if (type !== "color") {
    data.spacing = view.spacing.map((t) => ({ step: spacingKey(t.path), path: t.path, px: t.token.$value.value, uses: usesOf(t) }));
    if (lines.length > 0) lines.push("");
    const step = view.spacing.length > 0 ? spacingKey(mostUsed(view.spacing).path) : "4";
    lines.push(`Spacing (${plural(data.spacing.length, "step")}). Use the step in any spacing class (\`p-${step}\`, \`gap-${step}\`, \`mt-${step}\`); never an arbitrary value like \`p-[13px]\`.`);
    for (const s of data.spacing) lines.push(`- ${s.step}: ${s.px}px, used ${plural(s.uses, "time")}`);
    if (data.spacing.length === 0) lines.push("- No spacing scale yet.");
  }

  return { text: `${lines.join("\n")}\n`, data };
}

// ---------------------------------------------------------------------------
// find_component
// ---------------------------------------------------------------------------

export interface ComponentMatch {
  name: string;
  filePath: string;
  importLine: string;
  example: string;
  variants: string[];
  props: string[];
  /** Components merged into this one; use this instead of them. */
  replaces: string[];
  /** Enabled rules about this component. */
  rules: string[];
  score: number;
  /** Why it matched, in plain English. */
  reasons: string[];
}

export interface FindComponentData {
  need: string;
  matches: ComponentMatch[];
  /** Every shared component, when nothing matched. */
  available?: string[];
}

/** How much a word counts, by where it's found. */
const WEIGHTS = { name: 5, replaced: 4, variant: 3, root: 2, prop: 1, rule: 1 } as const;
const MAX_MATCHES = 3;

interface Term {
  word: string;
  /** The phrase it came from, when a synonym added it. */
  via?: string;
}

/** The need's own words, plus what its everyday phrases usually mean. */
function terms(need: string): Term[] {
  const all = words(need);
  const own = all.filter((w) => !STOPWORDS.has(w));
  const out = new Map<string, Term>(own.map((w) => [w, { word: w }]));
  for (const s of SYNONYMS) {
    const hit = s.when.find((phrase) => hasPhrase(all, phrase));
    if (!hit) continue;
    for (const m of s.means) if (!out.has(m)) out.set(m, { word: m, via: hit });
  }
  return [...out.values()];
}

const rulesAbout = (view: SystemView, c: ComponentEntry) =>
  view.rules.filter((r) => r.appliesTo.some((t) => t.kind === "component" && t.name === c.name)).sort((a, b) => compareStrings(a.id, b.id));

function scoreComponent(view: SystemView, c: ComponentEntry, ts: readonly Term[]): ComponentMatch {
  const replaces = replacedBy(view, c);
  const rules = rulesAbout(view, c);
  const fields: { kind: keyof typeof WEIGHTS; words: Set<string>; describe: (t: Term) => string }[] = [
    { kind: "name", words: new Set([...words(splitCamel(c.name)), c.name.toLowerCase()]), describe: (t) => `"${t.word}" is in its name` },
    {
      kind: "replaced",
      words: new Set(replaces.flatMap((n) => [...words(splitCamel(n)), n.toLowerCase()])),
      describe: (t) => `it replaced ${list(replaces.filter((n) => words(splitCamel(n)).includes(t.word) || n.toLowerCase() === t.word), "and")}`,
    },
    { kind: "variant", words: new Set(c.variants.flatMap(words)), describe: (t) => `"${t.word}" is one of its variants` },
    { kind: "root", words: new Set((c.rootElements ?? []).map((e) => e.toLowerCase())), describe: (t) => `it renders a <${t.word}>` },
    { kind: "prop", words: new Set((c.props ?? []).flatMap((p) => words(splitCamel(p)))), describe: (t) => `it has a "${t.word}" prop` },
    { kind: "rule", words: new Set(rules.flatMap((r) => words(r.text))), describe: (t) => `a rule about it mentions "${t.word}"` },
  ];

  let score = 0;
  const reasons: string[] = [];
  const explained = new Set<string>();
  for (const t of ts) {
    // Each word counts once, where it says the most.
    const best = fields.find((f) => f.words.has(t.word) && fields.every((g) => !g.words.has(t.word) || WEIGHTS[g.kind] <= WEIGHTS[f.kind]));
    if (!best) continue;
    score += WEIGHTS[best.kind];
    if (t.via && !explained.has(t.via)) {
      explained.add(t.via);
      const meant = terms(t.via).filter((x) => x.via === t.via).map((x) => x.word);
      reasons.push(`"${t.via}" usually means ${list(meant, "or")}`);
    }
    reasons.push(best.describe(t));
  }

  return {
    name: c.name,
    filePath: c.filePath,
    importLine: importLine(c),
    example: usage(c),
    variants: [...c.variants].sort(compareStrings),
    props: [...(c.props ?? [])].sort(compareStrings),
    replaces,
    rules: rules.map((r) => r.text),
    score,
    reasons,
  };
}

function describeMatch(m: ComponentMatch, i: number): string[] {
  const lines = [`${i + 1}. ${m.name}`, `   ${m.importLine}`, `   Example: ${m.example}`];
  if (m.variants.length > 0) lines.push(`   Variants: ${m.variants.join(", ")}`);
  if (m.props.length > 0) lines.push(`   Props: ${m.props.join(", ")}`);
  if (m.replaces.length > 0) lines.push(`   Use instead of ${list(m.replaces, "or")}.`);
  lines.push(`   Why it matched (score ${m.score}): ${m.reasons.join("; ")}.`);
  if (m.rules.length > 0) lines.push("   Rules:", ...m.rules.map((r) => `   - ${r}`));
  return lines;
}

/**
 * Ranks shared components for a plain-English need by keyword matching:
 * the name, the names it replaced, variants, root element, props and its
 * rules, widened by `SYNONYMS`. Returns up to three, each with why it matched.
 */
export function findComponent(model: SystemModel, need: string): ToolResult<FindComponentData> {
  const view = systemView(model);
  const ts = terms(need);
  const matches = view.components
    .map((c) => scoreComponent(view, c, ts))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score || compareStrings(a.name, b.name) || compareStrings(a.filePath, b.filePath))
    .slice(0, MAX_MATCHES);

  if (matches.length === 0) {
    const available = view.components.map((c) => c.name);
    const text =
      available.length === 0
        ? `No shared components match "${need}". This system has no shared components yet, so build it with the tokens (see get_tokens) and the rules (see get_rules).\n`
        : `No shared components match "${need}". The shared components are ${list(available)}. If none of them fits, build it with the tokens (see get_tokens) and follow the rules (see get_rules).\n`;
    return { text, data: { need, matches, available } };
  }

  const lines = [`${matches.length === 1 ? "Best match" : `Best ${matches.length} matches`} for "${need}", best first. ${IMPORT_NOTE}`, ""];
  matches.forEach((m, i) => lines.push(...describeMatch(m, i), ""));
  return { text: `${lines.join("\n").trimEnd()}\n`, data: { need, matches } };
}

// ---------------------------------------------------------------------------
// get_rules
// ---------------------------------------------------------------------------

export interface RuleInfo {
  id: string;
  text: string;
  category: RuleCategory;
  severity: Rule["severity"];
  right: string;
  wrong: string;
}

export interface RulesData {
  topic?: string;
  rules: RuleInfo[];
  /** Present whenever accessibility rules are included. */
  note?: string;
}

/** Words that mean a whole category. */
const TOPICS: Readonly<Record<RuleCategory, readonly string[]>> = {
  color: ["color", "colour", "palette", "hex"],
  spacing: ["spacing", "space", "padding", "margin", "gap"],
  component: ["component"],
  accessibility: ["accessibility", "a11y", "accessible", "wcag"],
};
const CATEGORY_ORDER: readonly RuleCategory[] = ["component", "spacing", "accessibility", "color"];

/** Everything a topic can match in a rule: its text, id and what it applies to. */
function ruleWords(r: Rule): Set<string> {
  const targets = r.appliesTo.flatMap((t) => ("path" in t ? [t.path, colorLabel(t.path)] : [t.name, splitCamel(t.name)]));
  return new Set([...words(r.text), ...words(r.id), ...targets.flatMap(words)]);
}

/**
 * Enabled rules, most important first: errors, then component, spacing,
 * accessibility and color rules. A topic picks a category ("spacing",
 * "a11y") or else rules mentioning any of its words ("contrast", "Button").
 */
export function getRules(model: SystemModel, topic?: string): ToolResult<RulesData> {
  const all = systemView(model).rules;
  const t = topic?.trim() || undefined;
  let picked = all;
  if (t) {
    const ws = words(t).filter((w) => !STOPWORDS.has(w));
    const categories = CATEGORY_ORDER.filter((c) => ws.some((w) => TOPICS[c].includes(w)));
    picked =
      categories.length > 0
        ? all.filter((r) => categories.includes(r.category))
        : all.filter((r) => {
            const rw = ruleWords(r);
            return ws.some((w) => rw.has(w));
          });
  }
  const rules = [...picked]
    .sort(
      (a, b) =>
        (a.severity === "error" ? 0 : 1) - (b.severity === "error" ? 0 : 1) ||
        CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) ||
        compareStrings(a.id, b.id),
    )
    .map((r): RuleInfo => ({ id: r.id, text: r.text, category: r.category, severity: r.severity, right: r.examples.right, wrong: r.examples.wrong }));

  const data: RulesData = { rules };
  if (t) data.topic = t;
  if (rules.length === 0) {
    const text = t
      ? `No rules match "${t}". Try a topic like color, spacing, component or accessibility, or leave it out to get every rule.\n`
      : "This system has no rules turned on yet.\n";
    return { text, data };
  }

  const oneLine = (s: string) => s.replace(/\s*\n\s*/g, " ");
  const lines = [`${plural(rules.length, "rule")}${t ? ` about "${t}"` : ""}, most important first:`, ""];
  for (const r of rules) lines.push(`- ${r.text}${r.severity === "error" ? " (required)" : ""}`, `  ✓ ${oneLine(r.right)}`, `  ✗ ${oneLine(r.wrong)}`);
  if (rules.some((r) => r.category === "accessibility")) {
    data.note = STATIC_CHECKS_NOTE;
    lines.push("", STATIC_CHECKS_NOTE);
  }
  return { text: `${lines.join("\n")}\n`, data };
}

// ---------------------------------------------------------------------------
// check_snippet
// ---------------------------------------------------------------------------

/**
 * Runs Steward Review's rules on a piece of JSX: colors outside the
 * system, spacing off the scale, raw buttons and merged-away components,
 * and the static accessibility checks (alt text, names, labels, click
 * targets, focus styles and contrast). Throws `SnippetParseError` for code that
 * isn't JSX.
 */
export function checkSnippet(model: SystemModel, code: string): ToolResult<CheckResult> {
  const result = checkCode(code, model);
  // Prose, an empty string or plain TypeScript parses without error but has nothing the checks look at.
  // Say so, rather than "No problems found", which an AI tool would take as a pass.
  const parsed = parseFile({ code });
  if (parsed.elements.length === 0 && parsed.classes.length === 0 && parsed.styles.length === 0) {
    return {
      text: "There's no JSX in this snippet, so nothing was checked. Pass the TSX you wrote, for example `<Button variant=\"primary\">Save</Button>`.\n",
      data: result,
    };
  }
  return { text: describeCheck(result), data: result };
}
