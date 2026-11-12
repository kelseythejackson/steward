import {
  compareStrings,
  STEWARD_EXTENSION,
  type ColorMergeSuggestion,
  type ComponentEntry,
  type ComponentMergeSuggestion,
  type ContrastSuggestion,
  type ContrastUse,
  type MergeDecision,
  type Rule,
  type RuleTarget,
  type SpacingMergeSuggestion,
  type Suggestion,
} from "@steward/model";
import { colorFamily } from "../colors/naming.js";
import type { ProposedColorToken } from "../colors/suggest.js";
import { tokenLabel } from "../contrast/check.js";
import { contrastRatio, REQUIRED_RATIO } from "../contrast/wcag.js";
import type { ProposedSpacingToken } from "../spacing/suggest.js";

/** What the generator reads from a scan. */
export interface RuleInputs {
  decisions: readonly MergeDecision[];
  /** Every suggestion the scan made, accepted or not. */
  suggestions: readonly Suggestion[];
  colorTokens: readonly ProposedColorToken[];
  spacingTokens: readonly ProposedSpacingToken[];
  components: readonly ComponentEntry[];
}

const list = (xs: readonly string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`);
const code = (s: string) => `\`${s}\``;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** `Button (src/ui/Button.tsx)` → `{ name: "Button", file: "src/ui/Button.tsx" }`. Duplicate labels carry the file when names collide. */
function parseLabel(label: string): { name: string; file?: string } {
  const m = /^(.*) \((.+)\)$/.exec(label);
  return m ? { name: m[1]!, file: m[2]! } : { name: label };
}

/** `spacing.2_5` → `2.5`, the Tailwind class suffix. */
const spacingKey = (path: string) => path.replace(/^spacing\./, "").replace("_", ".");

// ---------------------------------------------------------------------------
// Accessibility basics: always included, so every system raises the floor.
// ---------------------------------------------------------------------------

function accessibilityRules(colorTokens: readonly ProposedColorToken[], button: string | null): Rule[] {
  const base = { category: "accessibility", source: "generated", severity: "warn", enabled: true } as const;
  const btn = button ?? "button";

  // The lightest gray in the system that still passes for body text on white, e.g. gray-600.
  const passingGrays = colorTokens
    .filter((t) => t.token.$value.alpha === undefined && colorFamily(t.token.$value.hex) === "gray")
    .map((t) => ({ path: t.path, ratio: contrastRatio(t.token.$value.hex, "#ffffff") }))
    .filter((g) => g.ratio >= REQUIRED_RATIO.text)
    .sort((a, b) => a.ratio - b.ratio || compareStrings(a.path, b.path));
  const gray = passingGrays[0] ? tokenLabel(passingGrays[0].path) : null;
  const contrastText =
    "Text needs at least 4.5:1 contrast with its background; large text (24px, or about 19px and bold), icons and form borders need 3:1." +
    (gray ? ` On white, body text uses ${code(gray)} or darker.` : "");

  return [
    {
      ...base,
      id: "a11y-click-target",
      text: "Click handlers go on buttons and links, not on divs or spans, so keyboard and screen reader users can reach them.",
      appliesTo: [
        { kind: "element", name: "div" },
        { kind: "element", name: "span" },
      ],
      examples: { right: `<${btn} onClick={openDetails}>Details</${btn}>`, wrong: "<div onClick={openDetails}>Details</div>" },
    },
    {
      ...base,
      id: "a11y-focus-visible",
      text: "Keep a visible focus style. If you remove the outline, add a replacement such as `focus-visible:ring-2`.",
      appliesTo: [
        { kind: "element", name: "a" },
        { kind: "element", name: "button" },
        { kind: "element", name: "input" },
      ],
      examples: { right: '<a className="outline-none focus-visible:ring-2" href="/billing">Billing</a>', wrong: '<a className="outline-none" href="/billing">Billing</a>' },
    },
    {
      ...base,
      id: "a11y-icon-button-label",
      text: "Icon-only buttons need an aria-label that says what they do.",
      appliesTo: [{ kind: "element", name: "button" }, ...(button ? [{ kind: "component" as const, name: button }] : [])],
      examples: { right: `<${btn} aria-label="Close"><XIcon /></${btn}>`, wrong: `<${btn}><XIcon /></${btn}>` },
    },
    {
      ...base,
      id: "a11y-img-alt",
      text: 'Images need alt text that describes them. Use alt="" for images that are only decoration.',
      appliesTo: [{ kind: "element", name: "img" }],
      examples: { right: '<img src="/team.jpg" alt="The team at the 2026 offsite" />', wrong: '<img src="/team.jpg" />' },
    },
    {
      ...base,
      id: "a11y-input-label",
      text: "Every input needs a label. A placeholder isn't a label, because it disappears as soon as someone types.",
      appliesTo: [
        { kind: "element", name: "input" },
        { kind: "element", name: "select" },
        { kind: "element", name: "textarea" },
      ],
      examples: {
        right: '<label htmlFor="email">Email</label>\n<input id="email" type="email" />',
        wrong: '<input type="email" placeholder="Email" />',
      },
    },
    {
      ...base,
      id: "a11y-text-contrast",
      text: contrastText,
      appliesTo: [{ kind: "token-group", path: "color" }],
      examples: gray
        ? { right: `<p className="text-${gray} bg-white">Due today</p>`, wrong: '<p className="text-gray-300 bg-white">Due today</p>' }
        : { right: '<p className="text-[#4b5563] bg-white">Due today</p>', wrong: '<p className="text-[#d1d5db] bg-white">Due today</p>' },
    },
  ];
}

// ---------------------------------------------------------------------------
// Rules from accepted suggestions
// ---------------------------------------------------------------------------

function colorRule(s: ColorMergeSuggestion): Rule {
  const token = tokenLabel(s.proposed.path);
  const hex = s.proposed.token.$value.hex;
  const others = s.members.filter((m) => m !== hex);
  return {
    id: `use-token-${slug(token)}`,
    text: `Use ${code(token)} (${hex}) instead of ${list(others)}.`,
    category: "color",
    appliesTo: [{ kind: "token", path: s.proposed.path }],
    examples: { right: `<div className="bg-${token}">`, wrong: `<div className="bg-[${others[0] ?? hex}]">` },
    source: "generated",
    basedOn: [s.id],
    severity: "warn",
    enabled: true,
  };
}

/** One rule for the whole scale, however many spacing snaps were accepted. */
function spacingRule(accepted: readonly SpacingMergeSuggestion[], tokens: readonly ProposedSpacingToken[]): Rule | null {
  const first = accepted[0];
  if (!first || tokens.length === 0) return null;
  const steps = tokens.map((t) => t.token.$value.value);
  const step = `${first.proposed.token.$value.value}px`;
  const off = first.members.find((m) => m !== step) ?? step;
  return {
    id: "spacing-tokens-only",
    text: `Only use spacing tokens (${steps.join(", ")}px); no arbitrary values like ${code(`p-[${off}]`)}.`,
    category: "spacing",
    appliesTo: [{ kind: "token-group", path: "spacing" }],
    examples: { right: `<div className="p-${spacingKey(first.proposed.path)}">`, wrong: `<div className="p-[${off}]">` },
    source: "generated",
    basedOn: accepted.map((s) => s.id),
    severity: "warn",
    enabled: true,
  };
}

function componentRules(s: ComponentMergeSuggestion, components: readonly ComponentEntry[]): Rule[] {
  const kept = parseLabel(s.proposed.name);
  const others = s.members.filter((m) => m !== s.proposed.name).map(parseLabel);
  // When names collide, name each by its file so the rule is unambiguous.
  const collide = others.some((o) => o.name === kept.name);
  const show = (c: { name: string; file?: string }) => (collide && c.file ? `${code(`<${c.name}>`)} in ${c.file}` : code(`<${c.name}>`));
  const base = { category: "component", source: "generated", severity: "warn", enabled: true } as const;
  const entry = components.find((c) => c.name === kept.name && (!kept.file || c.filePath === kept.file));
  const isButton = entry?.rootElements?.includes("button") ?? false;
  const body = isButton ? "Save" : "…";
  const rules: Rule[] = [
    {
      ...base,
      basedOn: [s.id],
      id: `use-component-${slug(kept.name)}`,
      text: `Use ${show(kept)} instead of ${list(others.map(show))}.`,
      appliesTo: [{ kind: "component", name: kept.name }, ...others.filter((o) => o.name !== kept.name).map((o) => ({ kind: "component" as const, name: o.name }))],
      examples: { right: `<${kept.name}>${body}</${kept.name}>`, wrong: `<${others[0]?.name ?? kept.name}>${body}</${others[0]?.name ?? kept.name}>` },
    },
  ];

  // A kept component that renders a <button> replaces raw buttons too.
  if (entry && isButton) {
    const primary = entry.variants.includes("primary");
    rules.push({
      ...base,
      basedOn: [s.id],
      id: "no-raw-button",
      text: primary
        ? `Use ${code(`<${kept.name} variant="primary">`)} for the main action on a page and ${code(`<${kept.name}>`)} for other actions; never a raw ${code("<button>")}.`
        : `Use ${code(`<${kept.name}>`)} for actions; never a raw ${code("<button>")}.`,
      appliesTo: [
        { kind: "component", name: kept.name },
        { kind: "element", name: "button" },
      ],
      examples: {
        right: primary ? `<${kept.name} variant="primary">Save</${kept.name}>` : `<${kept.name}>Save</${kept.name}>`,
        wrong: '<button className="bg-blue-500 text-white px-4 py-2">Save</button>',
      },
    });
  }
  return rules;
}

const SUBJECT: Readonly<Record<ContrastUse, { noun: string; verb: string; prefix: string }>> = {
  text: { noun: "Text", verb: "uses", prefix: "text-" },
  "large-text": { noun: "Large text", verb: "uses", prefix: "text-" },
  ui: { noun: "Icons and form borders", verb: "use", prefix: "border-" },
};

/** Finds the token path for a color, including colors merged into a token. */
function tokenPaths(tokens: readonly ProposedColorToken[]): (hex: string) => string | undefined {
  const paths = new Map<string, string>();
  for (const t of tokens) if (t.token.$value.alpha === undefined) paths.set(t.token.$value.hex, t.path);
  for (const t of tokens) for (const raw of t.token.$extensions?.[STEWARD_EXTENSION]?.mergedFrom ?? []) if (!paths.has(raw)) paths.set(raw, t.path);
  return (hex) => paths.get(hex);
}

function contrastRule(s: ContrastSuggestion, pathOf: (hex: string) => string | undefined): Rule {
  const { foreground, background, use } = s.pair;
  // Name each color the way a person would write it: its token (`gray-400`) if it has one, else its hex.
  const nameOf = (hex: string) => {
    const path = pathOf(hex);
    return path ? tokenLabel(path) : hex;
  };
  const fg = nameOf(foreground);
  const bg = nameOf(background);
  const fixHex = s.proposed.token.$value.hex;
  // A new shade goes by its hex, like the suggestion's own reason: its proposed path can sit oddly next to existing steps.
  const fix = s.proposed.existing ? tokenLabel(s.proposed.path) : fixHex;
  const replaced = s.proposed.replaces === "foreground" ? foreground : background;
  const direction = contrastRatio(fixHex, "#000000") < contrastRatio(replaced, "#000000") ? "darker" : "lighter";
  const required = `${REQUIRED_RATIO[use]}:1`;
  const { noun, verb, prefix } = SUBJECT[use];
  const cls = (p: string, name: string) => (name.startsWith("#") ? `${p}[${name}]` : `${p}${name}`);
  const el = (fgName: string, bgName: string) =>
    use === "ui" ? `<input className="border ${cls(prefix, fgName)} ${cls("bg-", bgName)}" />` : `<p className="${cls(prefix, fgName)} ${cls("bg-", bgName)}">Due today</p>`;

  const text =
    s.proposed.replaces === "foreground"
      ? `${noun} on ${code(bg)} ${verb} ${code(fix)} or ${direction} (needs ${required}).`
      : `Behind ${code(fg)} ${use === "ui" ? "icons and borders" : "text"}, use a ${code(fix)} background or ${direction} (needs ${required}).`;
  return {
    id: `contrast-${slug(fg)}-on-${slug(bg)}`,
    text,
    category: "accessibility",
    appliesTo: [...new Set([...(s.proposed.existing ? [s.proposed.path] : []), ...[foreground, background].map(pathOf).filter((p): p is string => p !== undefined)])].map((path) => ({ kind: "token" as const, path })),
    examples: {
      right: s.proposed.replaces === "foreground" ? el(fix, bg) : el(fg, fix),
      wrong: el(fg, bg),
    },
    source: "generated",
    basedOn: [s.id],
    severity: "warn",
    enabled: true,
  };
}

const targetKey = (t: RuleTarget) => `${t.kind} ${t.kind === "token" || t.kind === "token-group" ? t.path : t.name}`;

/** Sorts a rule's targets and basis, the same way the model file does. */
function sortedLists(r: Rule): Rule {
  const out = { ...r, appliesTo: [...r.appliesTo].sort((a, b) => compareStrings(targetKey(a), targetKey(b))) };
  if (r.basedOn) out.basedOn = [...r.basedOn].sort(compareStrings);
  return out;
}

/**
 * Pure: starter rules for a system. The accessibility basics are always
 * included; the rest come only from suggestions a person accepted.
 * Rejected and undecided suggestions never become rules. Sorted by id.
 */
export function generateRules(inputs: RuleInputs): Rule[] {
  const accepted = new Set(inputs.decisions.filter((d) => d.status === "accepted").map((d) => d.suggestionId));
  const chosen = inputs.suggestions.filter((s) => accepted.has(s.id)).sort((a, b) => compareStrings(a.id, b.id));
  const pathOf = tokenPaths(inputs.colorTokens);

  const rules: Rule[] = [];
  for (const s of chosen) {
    if (s.kind === "color") rules.push(colorRule(s));
    else if (s.kind === "component") rules.push(...componentRules(s, inputs.components));
    else if (s.kind === "contrast") rules.push(contrastRule(s, pathOf));
  }
  const spacing = spacingRule(
    chosen.filter((s): s is SpacingMergeSuggestion => s.kind === "spacing").sort((a, b) => a.proposed.token.$value.value - b.proposed.token.$value.value),
    inputs.spacingTokens,
  );
  if (spacing) rules.push(spacing);

  const button = rules.find((r) => r.id === "no-raw-button")?.appliesTo.find((t) => t.kind === "component");
  rules.push(...accessibilityRules(inputs.colorTokens, button && button.kind === "component" ? button.name : null));

  // Two suggestions can lead to the same rule (e.g. two button merges); the first, by suggestion id, wins.
  const byId = new Map<string, Rule>();
  for (const r of rules) if (!byId.has(r.id)) byId.set(r.id, sortedLists(r));
  return [...byId.values()].sort((a, b) => compareStrings(a.id, b.id));
}

/**
 * Pure: combines freshly generated rules with the ones already in the model.
 * - `user` and `learned` rules are kept exactly as they are, and win over a
 *   generated rule with the same id.
 * - A regenerated rule keeps the `enabled` and `severity` a person set.
 * - A generated rule whose accepted suggestion no longer shows up (say the
 *   code now follows it) stays while every decision behind it is still
 *   accepted, and goes once one of them is undone.
 */
export function mergeRules(generated: readonly Rule[], previous: readonly Rule[], decisions: readonly MergeDecision[]): Rule[] {
  const accepted = new Set(decisions.filter((d) => d.status === "accepted").map((d) => d.suggestionId));
  const out = new Map<string, Rule>();
  for (const r of previous) if (r.source !== "generated") out.set(r.id, r);

  const before = new Map(previous.filter((r) => r.source === "generated").map((r) => [r.id, r]));
  for (const g of generated) {
    if (out.has(g.id)) continue;
    const prev = before.get(g.id);
    if (!prev) {
      out.set(g.id, g);
      continue;
    }
    const merged: Rule = { ...g, enabled: prev.enabled, severity: prev.severity };
    const basedOn = [...new Set([...(g.basedOn ?? []), ...(prev.basedOn ?? []).filter((id) => accepted.has(id))])].sort(compareStrings);
    if (basedOn.length > 0) merged.basedOn = basedOn;
    out.set(g.id, merged);
  }
  for (const [id, prev] of before) {
    if (out.has(id)) continue;
    if (prev.basedOn && prev.basedOn.length > 0 && prev.basedOn.every((b) => accepted.has(b))) out.set(id, prev);
  }
  return [...out.values()].sort((a, b) => compareStrings(a.id, b.id));
}
