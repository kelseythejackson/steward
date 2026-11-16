import { compareStrings, isToken, type ComponentEntry, type Rule, type SystemModel, type Token, type TokenGroup } from "@steward/model";

/** A color token as checks see it: its Tailwind name and value. */
export interface ColorRef {
  /** `gray-400`, the name used in classes. */
  name: string;
  /** Lowercase `#rrggbb`. */
  hex: string;
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

/** Everything the rules need from the system model, built once per model. */
export interface CheckContext {
  colors: ColorRef[];
  spacing: SpacingStep[];
  button: ButtonRef | null;
  /** Merged-away component name → what replaced it. Accepted merges only. */
  replaced: ReadonlyMap<string, ReplacedComponent>;
  /** System rules by id, so a rule a person turned off is skipped and their severity is used. */
  rules: ReadonlyMap<string, Rule>;
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
      const ref: ColorRef = { name: path.replace(/^color\./, "").replaceAll(".", "-"), hex: node.$value.hex.toLowerCase() };
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
  return { colors, spacing, button, replaced, rules: new Map(model.rules.map((r) => [r.id, r])) };
}
