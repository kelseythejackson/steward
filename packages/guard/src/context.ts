import { compareStrings, isToken, type ComponentEntry, type Rule, type SystemModel, type Token, type TokenGroup } from "@steward/model";

/** A color token as checks see it: its Tailwind name and value. */
export interface ColorRef {
  /** `gray-400`, the name used in classes. */
  name: string;
  /** Lowercase `#rrggbb`. */
  hex: string;
  /** Token path in the model, e.g. `color.gray.400`. */
  path: string;
  /** Present when the token itself is see-through. */
  alpha?: number;
}

/** A spacing step: its Tailwind key and size. */
export interface SpacingStep {
  /** `2.5`, as in `p-2.5`. */
  key: string;
  px: number;
}

/** A shared component a rule can point people to. */
export interface ComponentRef {
  name: string;
  /** Repo-relative, as in the system model, e.g. `src/components/Button.tsx`. */
  filePath: string;
  /** For people and AI tools: `import { Button } from "src/components/Button";`. */
  importLine: string;
}

/** The shared component to use instead of a raw `<button>`. */
export interface ButtonRef extends ComponentRef {
  hasPrimary: boolean;
  /** Files where a raw `<button>` is expected: the button itself and components merged into it. Sorted. */
  files: string[];
}

/** A component a person merged away, and the one they kept. */
export interface ReplacedComponent {
  keeper: ComponentRef;
  /** Every component in the merge, keeper included, sorted. */
  members: string[];
  /** The `use-component-*` rule generated from the merge, so a person can turn it off. */
  systemRule?: string;
}

/** A contrast fix a person accepted: which side of the pair changes, and to what. */
export interface ContrastFix {
  replaces: "foreground" | "background";
  /** Token name (`gray-500`) when the fix is a token, otherwise the hex of a computed shade. */
  name: string;
  hex: string;
  /** True when the replacement is a color token in the system. */
  existing: boolean;
  /** Contrast of the pair after the fix. */
  ratio: number;
  /** The `contrast-*` rule generated from the decision, so a person can turn it off. */
  systemRule?: string;
}

/** Everything the rules need from the system model, built once per model. */
export interface CheckContext {
  colors: ColorRef[];
  spacing: SpacingStep[];
  button: ButtonRef | null;
  /** Merged-away component name → what replaced it. Accepted merges only. */
  replaced: ReadonlyMap<string, ReplacedComponent>;
  /** Accepted contrast fixes by `foreground|background|use` (token hex values). */
  contrastFixes: ReadonlyMap<string, ContrastFix>;
  /** System rules by id, so a rule a person turned off is skipped and their severity is used. */
  rules: ReadonlyMap<string, Rule>;
  /** Names of the components in the system (from Setup's inventory), for measuring how much they're used. */
  componentNames: ReadonlySet<string>;
  /** Where each new color's token suggestion stands, by lowercase hex. Colors with none aren't listed. */
  tokenSuggestions: ReadonlyMap<string, "pending" | "accepted" | "rejected">;
}

/** From the model: token suggestions waiting for a decision, and decided ones (even if the suggestion is gone). */
function findTokenSuggestions(model: SystemModel): Map<string, "pending" | "accepted" | "rejected"> {
  const out = new Map<string, "pending" | "accepted" | "rejected">();
  for (const s of model.suggestions) if (s.kind === "token") for (const m of s.members) out.set(m.toLowerCase(), "pending");
  for (const d of model.decisions) if (d.kind === "token") for (const m of d.members) out.set(m.toLowerCase(), d.status);
  return out;
}

export const contrastKey = (foreground: string, background: string, use: string) => `${foreground.toLowerCase()}|${background.toLowerCase()}|${use}`;
export const tokenName = (path: string) => path.replace(/^color\./, "").replaceAll(".", "-");

/** Contrast fixes from accepted contrast suggestions only: people decide what the system is. */
function findContrastFixes(model: SystemModel): Map<string, ContrastFix> {
  const accepted = new Set(model.decisions.filter((d) => d.kind === "contrast" && d.status === "accepted").map((d) => d.suggestionId));
  // An accepted fix joins the tokens on the next scan, so look for it there: it's then a system color, by its token name.
  const opaqueTokens = flatten(model.tokens).filter((t) => t.node.$type === "color" && t.node.$value.alpha === undefined);
  const tokenFor = (hex: string) => opaqueTokens.find((t) => t.node.$type === "color" && t.node.$value.hex.toLowerCase() === hex);
  const out = new Map<string, ContrastFix>();
  const fixes = model.suggestions.filter((s) => s.kind === "contrast" && accepted.has(s.id)).sort((a, b) => compareStrings(a.id, b.id));
  for (const s of fixes) {
    if (s.kind !== "contrast") continue;
    const hex = s.proposed.token.$value.hex.toLowerCase();
    const token = s.proposed.existing ? undefined : tokenFor(hex);
    const existing = s.proposed.existing || token !== undefined;
    const name = token ? tokenName(token.path) : tokenName(s.proposed.path);
    const fix: ContrastFix = { replaces: s.proposed.replaces, name, hex, existing, ratio: s.proposed.ratio };
    const rule = model.rules.find((r) => r.id.startsWith("contrast-") && (r.basedOn?.includes(s.id) ?? false));
    if (rule) fix.systemRule = rule.id;
    out.set(contrastKey(s.pair.foreground, s.pair.background, s.pair.use), fix);
  }
  return out;
}

function flatten(group: TokenGroup, prefix = ""): { path: string; node: Token }[] {
  const out: { path: string; node: Token }[] = [];
  for (const key of Object.keys(group).sort(compareStrings)) {
    const node = group[key]!;
    const path = prefix ? `${prefix}.${key}` : key;
    if (isToken(node)) out.push({ path, node });
    else out.push(...flatten(node, path));
  }
  return out;
}

export const importLine = (c: ComponentEntry) => `import { ${c.name} } from "${c.filePath.replace(/\.[cm]?[jt]sx?$/, "")}";`;

/**
 * The component that replaces raw buttons: the one the `no-raw-button` rule
 * names, or else a shared component called `Button` that renders a `<button>`.
 */
function findButton(model: SystemModel): ButtonRef | null {
  const rule = model.rules.find((r) => r.id === "no-raw-button");
  const named = rule?.appliesTo.find((t) => t.kind === "component");
  const shared = model.components
    .filter((c) => /(^|\/)components\//.test(c.filePath))
    .sort((a, b) => compareStrings(a.filePath, b.filePath));
  const c =
    (named && named.kind === "component" ? shared.find((x) => x.name === named.name) : undefined) ??
    shared.find((x) => x.name === "Button" && (x.rootElements ?? ["button"]).includes("button"));
  return c ? { ...componentRef(c), hasPrimary: c.variants.includes("primary"), files: [c.filePath] } : null;
}

const componentRef = (c: ComponentEntry): ComponentRef => ({ name: c.name, filePath: c.filePath, importLine: importLine(c) });

/**
 * Components merged away by an accepted merge. Suggestions waiting for a
 * decision aren't enforced: people decide what the system is.
 */
function findReplaced(model: SystemModel): Map<string, ReplacedComponent> {
  const accepted = new Set(model.decisions.filter((d) => d.kind === "component" && d.status === "accepted").map((d) => d.suggestionId));
  const out = new Map<string, ReplacedComponent>();
  const merges = model.suggestions.filter((s) => s.kind === "component" && accepted.has(s.id)).sort((a, b) => compareStrings(a.id, b.id));
  for (const s of merges) {
    if (s.kind !== "component") continue;
    const kept = model.components
      .filter((c) => c.name === s.proposed.name)
      .sort((a, b) => compareStrings(a.filePath, b.filePath))[0];
    if (!kept) continue;
    const rule = model.rules.find((r) => r.id.startsWith("use-component-") && (r.basedOn?.includes(s.id) ?? false));
    const entry: ReplacedComponent = { keeper: componentRef(kept), members: [...s.members].sort(compareStrings) };
    if (rule) entry.systemRule = rule.id;
    for (const m of s.members) if (m !== kept.name) out.set(m, entry);
  }
  return out;
}

export function checkContext(model: SystemModel): CheckContext {
  const colors: ColorRef[] = [];
  const spacing: SpacingStep[] = [];
  for (const { path, node } of flatten(model.tokens)) {
    if (node.$type === "color") {
      const ref: ColorRef = { name: tokenName(path), hex: node.$value.hex.toLowerCase(), path };
      if (node.$value.alpha !== undefined) ref.alpha = node.$value.alpha;
      colors.push(ref);
    } else if (node.$type === "dimension" && path.startsWith("spacing.")) {
      spacing.push({ key: path.replace(/^spacing\./, "").replace("_", "."), px: node.$value.value });
    }
  }
  spacing.sort((a, b) => a.px - b.px);
  const button = findButton(model);
  const replaced = findReplaced(model);
  if (button) {
    const merged = model.components.filter((c) => replaced.get(c.name)?.keeper.name === button.name).map((c) => c.filePath);
    button.files = [...new Set([...button.files, ...merged])].sort(compareStrings);
  }
  return {
    colors,
    spacing,
    button,
    replaced,
    contrastFixes: findContrastFixes(model),
    rules: new Map(model.rules.map((r) => [r.id, r])),
    tokenSuggestions: findTokenSuggestions(model),
    componentNames: new Set(model.components.map((c) => c.name)),
  };
}
