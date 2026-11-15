import { compareStrings, isToken, type ComponentEntry, type Rule, type SystemModel, type Token, type TokenGroup } from "@steward/model";
import type { CheckId } from "./findings.js";

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

/** The shared component to use instead of a raw `<button>`. */
export interface ButtonRef {
  name: string;
  importLine: string;
  hasPrimary: boolean;
}

/** Everything the checks need from the system model, built once per model. */
export interface CheckContext {
  colors: ColorRef[];
  spacing: SpacingStep[];
  button: ButtonRef | null;
  /** System rules by id, so a rule a person turned off skips its check. */
  rules: ReadonlyMap<string, Rule>;
}

/** Which system rule each check enforces. Colors have none of their own: the check runs whenever there are color tokens. */
export const CHECK_RULES: Readonly<Record<CheckId, string | undefined>> = {
  "hardcoded-color": undefined,
  "arbitrary-spacing": "spacing-tokens-only",
  "raw-button": "no-raw-button",
  "img-alt": "a11y-img-alt",
  "icon-button-label": "a11y-icon-button-label",
};

/** A check runs unless the system has its rule and a person turned it off. */
export function isCheckOn(ctx: CheckContext, check: CheckId): boolean {
  const id = CHECK_RULES[check];
  return id === undefined || ctx.rules.get(id)?.enabled !== false;
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
  return c ? { name: c.name, importLine: importLine(c), hasPrimary: c.variants.includes("primary") } : null;
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
  return { colors, spacing, button: findButton(model), rules: new Map(model.rules.map((r) => [r.id, r])) };
}
