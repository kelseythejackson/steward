import { parse } from "@babel/parser";
import traverse, { type NodePath, type Scope } from "@babel/traverse";
import { compareStrings } from "@steward/model";
import { parse as parseColor, formatHex } from "culori";
import { parseClassList, type ClassListStyle, type ResolvedColor, type StateStyle, type ThemeColors } from "./classes.js";
import type { ContrastExtraction, ContrastSkip, FocusFinding, InteractionState, PairOccurrence } from "./types.js";
import { isLargeText } from "./wcag.js";
import { pushTo } from "../collections.js";

type Node = Parameters<typeof traverse>[0];
type N<T extends Node["type"]> = Extract<Node, { type: T }>;
type JSXElementPath = NodePath<N<"JSXElement">>;

/** A file can't tell us what's behind its root elements; Steward assumes white and says so. */
const WHITE: ResolvedColor = { hex: "#ffffff", alpha: 1 };
const MAX_ALTERNATIVES = 64;
const STATES: readonly InteractionState[] = ["base", "hover", "focus"];
const STATE_ORDER: Readonly<Record<InteractionState, number>> = { base: 0, hover: 1, focus: 2 };
const FORM_CONTROLS = new Set(["input", "select", "textarea"]);
const NON_TEXT_INPUTS = new Set(["checkbox", "radio", "range", "color", "hidden", "file", "image"]);
const FOCUSABLE_TAGS = new Set(["button", "a", "input", "select", "textarea", "summary"]);

export const SKIP_SEMI_TRANSPARENT = "semi-transparent color; contrast depends on what's behind it";
export const SKIP_UNKNOWN_TEXT = "text color is set outside this file";
export const SKIP_TOO_MANY = `more than ${MAX_ALTERNATIVES} class combinations; only the first ${MAX_ALTERNATIVES} were checked`;
export const SKIP_VARIANTS = "colors under variants like dark: or disabled: aren't checked yet";

/** Color utilities, so an ignored `dark:bg-gray-900` is noted but `disabled:opacity-50` isn't. */
const COLOR_UTILITY = /^!?(?:text|bg|border(?:-[xytrblse])?|ring|outline|divide|placeholder|fill|stroke)-/;

/** What an element inherits from its ancestors in the same file. */
interface Context {
  text: ResolvedColor | undefined;
  bg: ResolvedColor;
  bgAssumed: boolean;
  sizePx: number;
  weight: number;
}

/** What a file's root elements start from: no known text color, white assumed behind, body text at the root font size. */
const rootContext = (rootPx: number): Context => ({ text: undefined, bg: WHITE, bgAssumed: true, sizePx: rootPx, weight: 400 });

// ---------------------------------------------------------------------------
// Static class resolution: every class string an expression could produce
// ---------------------------------------------------------------------------

/** Set when a class expression had more combinations than `MAX_ALTERNATIVES`, so some weren't checked. */
export interface AlternativeLimits {
  truncated: boolean;
}

function dedupe(xs: readonly string[], limits: AlternativeLimits): string[] {
  const unique = [...new Set(xs)];
  if (unique.length > MAX_ALTERNATIVES) limits.truncated = true;
  return unique.slice(0, MAX_ALTERNATIVES);
}
const product = (a: readonly string[], b: readonly string[], limits: AlternativeLimits, sep = "") => dedupe(a.flatMap((x) => b.map((y) => x + sep + y)), limits);

function unwrap(node: Node): Node {
  let n = node;
  while (n.type === "TSAsExpression" || n.type === "TSSatisfiesExpression" || n.type === "TSNonNullExpression" || n.type === "ParenthesizedExpression") {
    n = n.expression;
  }
  return n;
}

function propertyKey(key: Node): string | null {
  if (key.type === "Identifier") return key.name;
  if (key.type === "StringLiteral") return key.value;
  if (key.type === "NumericLiteral") return String(key.value);
  return null;
}

/** Follows a `const` binding to its initializer. */
function constInit(name: string, scope: Scope): { init: Node; scope: Scope } | null {
  const binding = scope.getBinding(name);
  if (!binding || !["const", "let", "var"].includes(binding.kind)) return null;
  const decl = binding.path.node;
  if (decl.type !== "VariableDeclarator" || !decl.init) return null;
  return { init: decl.init, scope: binding.path.scope };
}

function resolveObject(node: Node, scope: Scope): N<"ObjectExpression"> | null {
  const n = unwrap(node);
  if (n.type === "ObjectExpression") return n;
  if (n.type === "Identifier") {
    const found = constInit(n.name, scope);
    if (found) {
      const init = unwrap(found.init);
      if (init.type === "ObjectExpression") return init;
    }
  }
  return null;
}

/**
 * Every class string an expression could evaluate to, resolved statically
 * within the file: literals, templates, same-file constants, class maps
 * (`variants[variant]`), conditionals, `&&`/`||`, and `cn()`/`clsx()` calls
 * with object arguments. Anything dynamic contributes nothing.
 */
export function classAlternatives(node: Node, scope: Scope, depth = 0, limits: AlternativeLimits = { truncated: false }): string[] {
  if (depth > 10) return [""];
  const next = (n: Node, s: Scope = scope) => classAlternatives(n, s, depth + 1, limits);
  const n = unwrap(node);
  switch (n.type) {
    case "StringLiteral":
      return [n.value];
    case "TemplateLiteral": {
      let acc = [n.quasis[0]?.value.cooked ?? ""];
      n.expressions.forEach((expr, i) => {
        acc = product(acc, next(expr as Node), limits);
        acc = acc.map((a) => a + (n.quasis[i + 1]?.value.cooked ?? ""));
      });
      return acc;
    }
    case "Identifier": {
      const found = constInit(n.name, scope);
      return found ? next(found.init, found.scope) : [""];
    }
    case "MemberExpression": {
      const obj = resolveObject(n.object, scope);
      if (!obj) return [""];
      let wanted: string | null = null;
      if (!n.computed && n.property.type === "Identifier") wanted = n.property.name;
      else if (n.computed && n.property.type === "StringLiteral") wanted = n.property.value;
      const values = obj.properties.flatMap((p) => {
        if (p.type !== "ObjectProperty") return [];
        if (wanted !== null && propertyKey(p.key) !== wanted) return [];
        return [p.value as Node];
      });
      const out = dedupe(values.flatMap((v) => next(v)), limits);
      return out.length > 0 ? out : [""];
    }
    case "ConditionalExpression":
      return dedupe([...next(n.consequent), ...next(n.alternate)], limits);
    case "LogicalExpression":
      return n.operator === "&&" ? dedupe([...next(n.right), ""], limits) : dedupe([...next(n.left), ...next(n.right)], limits);
    case "CallExpression": {
      // cn(), clsx(), classnames(), twMerge(): each argument adds classes; object keys are optional.
      let acc = [""];
      for (const arg of n.arguments) {
        if (arg.type === "ObjectExpression") {
          const keys = arg.properties.flatMap((p) => (p.type === "ObjectProperty" && !p.computed ? [propertyKey(p.key)].filter((k): k is string => k !== null) : []));
          acc = product(acc, ["", ...keys], limits, " ");
        } else if (arg.type !== "SpreadElement" && arg.type !== "ArgumentPlaceholder") {
          acc = product(acc, next(arg as Node), limits, " ");
        }
      }
      return acc;
    }
    default:
      return [""];
  }
}

// ---------------------------------------------------------------------------
// Element helpers
// ---------------------------------------------------------------------------

type Opening = N<"JSXOpeningElement">;

function attribute(opening: Opening, name: string): N<"JSXAttribute"> | undefined {
  return opening.attributes.find((a): a is N<"JSXAttribute"> => a.type === "JSXAttribute" && a.name.type === "JSXIdentifier" && a.name.name === name);
}

function stringAttribute(opening: Opening, name: string): string | undefined {
  const v = attribute(opening, name)?.value;
  return v?.type === "StringLiteral" ? v.value : undefined;
}

function tabIndexOf(opening: Opening): number | undefined {
  const v = attribute(opening, "tabIndex")?.value;
  if (!v) return undefined;
  if (v.type === "StringLiteral") return Number(v.value);
  if (v.type !== "JSXExpressionContainer") return undefined;
  const e = v.expression;
  if (e.type === "NumericLiteral") return e.value;
  if (e.type === "UnaryExpression" && e.operator === "-" && e.argument.type === "NumericLiteral") return -e.argument.value;
  return undefined;
}

/** Lowercase tag for host elements (`div`, `button`), null for components (`Card`). */
function hostTag(opening: Opening): string | null {
  return opening.name.type === "JSXIdentifier" && /^[a-z]/.test(opening.name.name) ? opening.name.name : null;
}

const SKIP_KEYS = new Set(["loc", "start", "end", "leadingComments", "trailingComments", "innerComments", "extra", "range"]);

function containsJsx(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  if (Array.isArray(node)) return node.some(containsJsx);
  const type = (node as { type?: string }).type;
  if (type === "JSXElement" || type === "JSXFragment") return true;
  return Object.entries(node).some(([k, v]) => !SKIP_KEYS.has(k) && containsJsx(v));
}

/** Does the element show text (or a form value), an icon, or neither? */
function contentKind(el: N<"JSXElement">, tag: string): "text" | "icon" | null {
  if (tag === "input") {
    const type = stringAttribute(el.openingElement, "type");
    return type && NON_TEXT_INPUTS.has(type) ? null : "text";
  }
  if (tag === "textarea" || tag === "select") return "text";
  let hasText = false;
  let hasSvg = false;
  for (const child of el.children) {
    if (child.type === "JSXText" && child.value.trim() !== "") hasText = true;
    else if (child.type === "JSXExpressionContainer" && child.expression.type !== "JSXEmptyExpression" && !containsJsx(child.expression)) hasText = true;
    else if (child.type === "JSXElement" && child.openingElement.name.type === "JSXIdentifier" && child.openingElement.name.name === "svg") hasSvg = true;
  }
  return hasText ? "text" : hasSvg ? "icon" : null;
}

/** Text color and background from an inline `style={{ ... }}` object with literal values. */
function inlineStyle(opening: Opening): StateStyle {
  const out: StateStyle = {};
  const v = attribute(opening, "style")?.value;
  if (v?.type !== "JSXExpressionContainer" || v.expression.type !== "ObjectExpression") return out;
  for (const prop of v.expression.properties) {
    if (prop.type !== "ObjectProperty" || prop.value.type !== "StringLiteral") continue;
    const key = propertyKey(prop.key);
    const parsed = parseColor(prop.value.value);
    if (!parsed) continue;
    const color = { hex: formatHex(parsed), alpha: parsed.alpha ?? 1 };
    if (key === "color") out.text = color;
    else if (key === "backgroundColor" || key === "background") out.bg = color;
  }
  return out;
}

function componentName(path: NodePath): string | undefined {
  const fn = path.findParent(
    (p) =>
      (p.node.type === "FunctionDeclaration" && p.node.id != null) ||
      ((p.node.type === "ArrowFunctionExpression" || p.node.type === "FunctionExpression") && p.parentPath?.node.type === "VariableDeclarator"),
  );
  if (!fn) return undefined;
  if (fn.node.type === "FunctionDeclaration") return fn.node.id?.name;
  const decl = fn.parentPath?.node;
  return decl?.type === "VariableDeclarator" && decl.id.type === "Identifier" ? decl.id.name : undefined;
}

const realBg = (bg: StateStyle["bg"]): ResolvedColor | undefined => (bg && bg !== "transparent" ? bg : undefined);

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/**
 * Pure: finds the text/background (and form border/background) color pairs
 * used together in one TSX file, plus focusable elements that remove their
 * focus outline. Backgrounds come from the element or its nearest ancestor
 * in the same file; when there is none, white is assumed and marked.
 *
 * Throws if the file can't be parsed.
 */
export function extractJsxContrast(code: string, file: string, theme: ThemeColors = {}, rootPx = 16): ContrastExtraction {
  const ast = parse(code, { sourceType: "module", plugins: ["typescript", "jsx"] });
  const ROOT = rootContext(rootPx);
  const pairs: PairOccurrence[] = [];
  const focus: FocusFinding[] = [];
  const skipped: ContrastSkip[] = [];
  const seenPairs = new Set<string>();
  const seenSkips = new Set<string>();

  // Map each JSX element to the elements rendered directly inside it (through maps and conditionals too).
  const children = new Map<Node | null, JSXElementPath[]>();
  traverse(ast, {
    JSXElement(path) {
      const parent = path.findParent((p) => p.node.type === "JSXElement");
      const key = parent?.node ?? null;
      pushTo(children, key, path);
    },
  });

  const skip = (line: number, reason: string) => {
    const key = `${line}\n${reason}`;
    if (seenSkips.has(key)) return;
    seenSkips.add(key);
    skipped.push({ file, line, reason });
  };

  const addPair = (p: Omit<PairOccurrence, "file" | "component">, component: string | undefined) => {
    const key = [p.foreground, p.background, p.use, p.state, p.line, p.backgroundAssumed].join("|");
    if (seenPairs.has(key)) return;
    seenPairs.add(key);
    pairs.push(component === undefined ? { ...p, file } : { ...p, file, component });
  };

  const visit = (path: JSXElementPath, contexts: readonly Context[]) => {
    const el = path.node;
    const opening = el.openingElement;
    const tag = hostTag(opening);
    const kids = children.get(el) ?? [];

    // A component's own styling lives in another file: its children start from scratch.
    if (!tag) {
      for (const kid of kids) visit(kid, [ROOT]);
      return;
    }

    const classAttr = attribute(opening, "className");
    const line = (classAttr ?? opening).loc?.start.line ?? 0;
    const component = componentName(path);
    const classValue = classAttr?.value;
    const limits: AlternativeLimits = { truncated: false };
    const classStrings =
      classValue?.type === "StringLiteral"
        ? [classValue.value]
        : classValue?.type === "JSXExpressionContainer" && classValue.expression.type !== "JSXEmptyExpression"
          ? classAlternatives(classValue.expression as Node, path.scope, 0, limits)
          : [""];
    const inline = inlineStyle(opening);
    const styles: ClassListStyle[] = classStrings.map((cls) => {
      const s = parseClassList(cls, theme, rootPx);
      if (inline.text || inline.bg) s.states.base = { ...s.states.base, ...inline };
      return s;
    });

    if (styles.some((st) => st.ignored.some((cls) => COLOR_UTILITY.test(cls.slice(cls.lastIndexOf(":") + 1))))) skip(line, SKIP_VARIANTS);

    const kind = contentKind(el, tag);
    const childContexts = new Map<string, Context>();

    for (const ctx of contexts) {
      for (const style of styles) {
        const base = style.states.base ?? {};
        const baseText = base.text ?? ctx.text;
        const ownBg = realBg(base.bg);
        const baseBg = ownBg ?? ctx.bg;
        const baseAssumed = ownBg ? false : ctx.bgAssumed;
        const sizePx = style.fontSizePx ?? ctx.sizePx;
        const weight = style.fontWeight ?? ctx.weight;

        if (kind) {
          const use = kind === "icon" ? "ui" : isLargeText(sizePx, weight) ? "large-text" : "text";
          for (const state of STATES) {
            const st = style.states[state];
            if (state !== "base" && !(st?.text || realBg(st?.bg))) continue;
            const fg = st?.text ?? baseText;
            const stBg = state === "base" ? undefined : realBg(st?.bg);
            const bg = stBg ?? baseBg;
            if (!fg) {
              if (state === "base") skip(line, SKIP_UNKNOWN_TEXT);
              continue;
            }
            if (fg.alpha < 1 || bg.alpha < 1) {
              skip(line, SKIP_SEMI_TRANSPARENT);
              continue;
            }
            addPair({ foreground: fg.hex, background: bg.hex, use, state, line, backgroundAssumed: stBg ? false : baseAssumed }, component);
          }
        }

        if (FORM_CONTROLS.has(tag)) {
          // A control's border is what shows where it is, so it needs 3:1 against what's behind it.
          for (const state of STATES) {
            const border = state === "base" ? base.border : style.states[state]?.border;
            if (!border) continue;
            if (border.alpha < 1 || ctx.bg.alpha < 1) {
              skip(line, SKIP_SEMI_TRANSPARENT);
              continue;
            }
            addPair({ foreground: border.hex, background: ctx.bg.hex, use: "ui", state, line, backgroundAssumed: ctx.bgAssumed }, component);
          }
        }

        const child: Context = { text: baseText, bg: baseBg, bgAssumed: baseAssumed, sizePx, weight };
        const key = JSON.stringify(child);
        if (!childContexts.has(key)) {
          if (childContexts.size < MAX_ALTERNATIVES) childContexts.set(key, child);
          else limits.truncated = true;
        }
      }
    }

    if (limits.truncated) skip(line, SKIP_TOO_MANY);

    const tabIndex = tabIndexOf(opening);
    const focusable =
      (FOCUSABLE_TAGS.has(tag) && !(tag === "input" && stringAttribute(opening, "type") === "hidden")) || (tabIndex !== undefined && tabIndex >= 0);
    const removed = focusable ? styles.find((s) => s.removesOutline && !s.hasFocusIndicator) : undefined;
    if (removed) {
      const noun = tag === "a" ? "link" : FOCUSABLE_TAGS.has(tag) ? tag : "element";
      const borderOnly = removed.states.focus?.border ? " A border color change alone isn't enough." : "";
      const finding: FocusFinding = {
        file,
        line,
        element: tag,
        reason: `This ${noun} removes its focus outline (\`${removed.outlineClass}\`) and has no other visible focus style.${borderOnly} Add a \`focus-visible:ring-2\` or \`focus-visible:outline\`.`,
      };
      if (component !== undefined) finding.component = component;
      focus.push(finding);
    }

    for (const kid of kids) visit(kid, [...childContexts.values()]);
  };

  for (const root of children.get(null) ?? []) visit(root, [ROOT]);

  // Stable sort: same-line entries keep the order the alternatives were found in.
  pairs.sort((a, b) => a.line - b.line || STATE_ORDER[a.state] - STATE_ORDER[b.state]);
  focus.sort((a, b) => a.line - b.line);
  skipped.sort((a, b) => a.line - b.line || compareStrings(a.reason, b.reason));
  return { pairs, focus, skipped };
}
