import { parse, type ParserOptions } from "@babel/parser";
import traverse from "@babel/traverse";

type Node = Parameters<typeof traverse>[0];
type N<T extends Node["type"]> = Extract<Node, { type: T }>;
export type JsxElementNode = N<"JSXElement">;
export type JsxChild = JsxElementNode["children"][number];

/** A position in the code as the person gave it: 1-based line and column. */
export interface Position {
  line: number;
  column: number;
}

/** A stretch of the code as the person gave it: 0-based offsets, `end` exclusive. */
export interface Range {
  start: number;
  end: number;
}

/** One class in a `className`, with where it is. */
export interface ClassUse extends Position {
  /** A single class, e.g. `hover:bg-[#3b82f6]`. */
  className: string;
  /** Exactly the class's characters, so a fix can swap it. */
  range: Range;
}

/** One inline style value, e.g. `style={{ color: "#3a81f5" }}`. */
export interface StyleUse extends Position {
  /** The style property, e.g. `color` or `backgroundColor`. */
  property: string;
  value: string;
}

/** One JSX element, with what the checks ask about it. */
export interface ElementUse extends Position {
  /** Where the tag name is in the opening tag, and in the closing tag when there is one. */
  nameRange: Range;
  closingNameRange?: Range;
  /** `button`, `img`, `Button`, `Icons.Close`. */
  name: string;
  /** Attribute names present, e.g. `alt`, `aria-label`. */
  attributes: ReadonlySet<string>;
  /** Static string attribute values, e.g. `alt` → `""`. */
  values: ReadonlyMap<string, string>;
  /** Expression attribute values as written, e.g. `htmlFor={id}` → `id`, so a label can be matched to its input. */
  expressions: ReadonlyMap<string, string>;
  /** Enclosing JSX element names in this file, nearest first, e.g. `["label", "form"]`. */
  ancestors: readonly string[];
  /** Has `{...props}`, so any attribute might be set. */
  spread: boolean;
  /** The opening tag as written, e.g. `<button className="p-2">`. */
  openingTag: string;
  /** The whole element as written. */
  source: string;
  node: JsxElementNode;
}

/** What the checks read from a piece of JSX. Built once, then shared by every check. */
export interface Snippet {
  classes: ClassUse[];
  styles: StyleUse[];
  elements: ElementUse[];
}

/**
 * A parsed source file (or snippet) that rules check. `path` is relative to
 * the repo root, with forward slashes, like the component paths in the
 * system model; it's absent for a loose snippet.
 */
export interface ParsedFile extends Snippet {
  path?: string;
  code: string;
  /** True when the code parsed as a module on its own, so imports can be added to it. */
  isModule: boolean;
  /** Imported names and where they come from: `Button` → `"../components/Button"`. */
  imports: ReadonlyMap<string, string>;
  /** Where a new import line goes: after the last import, or after any directives at the top. */
  importAt: number;
}

export class SnippetParseError extends Error {
  override name = "SnippetParseError";
}

const PARSE_OPTIONS: ParserOptions = { sourceType: "module", plugins: ["jsx", "typescript"], errorRecovery: true };
const FRAGMENT_OPEN = "<>";

function tryParse(code: string): ReturnType<typeof parse> | null {
  try {
    const ast = parse(code, PARSE_OPTIONS);
    return ast.errors && ast.errors.length > 0 ? null : ast;
  } catch {
    return null;
  }
}

function nameOf(n: N<"JSXOpeningElement">["name"]): string {
  if (n.type === "JSXIdentifier") return n.name;
  if (n.type === "JSXNamespacedName") return `${n.namespace.name}:${n.name.name}`;
  return `${nameOf(n.object as N<"JSXOpeningElement">["name"])}.${n.property.name}`;
}

/** Names of the JSX elements around a path, nearest first. */
function ancestorsOf(path: { parentPath: { node: Node; parentPath: unknown } | null }): string[] {
  const out: string[] = [];
  let p = path.parentPath as { node: Node; parentPath: unknown } | null;
  while (p) {
    if (p.node.type === "JSXElement") out.push(nameOf(p.node.openingElement.name));
    p = p.parentPath as { node: Node; parentPath: unknown } | null;
  }
  return out;
}

/** Attributes whose strings are classes: `className`, `class`, and props like `inputClassName`. */
const CLASS_ATTRIBUTE = /^class$|classname$/i;

/**
 * Whether a string could hold Tailwind classes. Like Tailwind's own content
 * scanner (and Steward's), any string counts, so class maps and `cva()`
 * variants are checked too, except import paths, type literals and JSX
 * attributes that aren't classes (`alt`, `href`, `style`, …).
 */
function mayHoldClasses(path: { parent: Node; findParent: (f: (p: { node: Node }) => boolean) => { node: Node } | null }): boolean {
  const parent = path.parent;
  if (parent.type === "ImportDeclaration" || parent.type === "ExportAllDeclaration" || parent.type === "ExportNamedDeclaration") return false;
  if (parent.type === "TSLiteralType" || parent.type === "TSExternalModuleReference") return false;
  const attr = path.findParent((p) => p.node.type === "JSXAttribute")?.node as N<"JSXAttribute"> | undefined;
  if (!attr) return true;
  const name = attr.name.type === "JSXIdentifier" ? attr.name.name : attr.name.name.name;
  return CLASS_ATTRIBUTE.test(name);
}

/**
 * Parses a piece of JSX: a whole file, a component, or loose markup like
 * `<button>…</button><img />` (wrapped in a fragment to parse). Throws
 * `SnippetParseError` when it isn't JSX that can be read.
 */
export function readSnippet(code: string): ParsedFile {
  return parseFile({ code });
}

/** Parses a file or snippet for the rules. `path` (repo-relative) is kept on the result. */
export function parseFile(input: { path?: string | undefined; code: string }): ParsedFile {
  const { code } = input;
  let source = code;
  let shift = 0;
  let ast = tryParse(code);
  if (!ast) {
    source = `${FRAGMENT_OPEN}${code}</>`;
    shift = FRAGMENT_OPEN.length;
    ast = tryParse(source);
  }
  if (!ast) throw new SnippetParseError("I couldn't read that as JSX, so nothing was checked. Send a component or a piece of markup, like `<button className=\"p-2\">Save</button>`.");

  // Offsets → positions in the code as given (the fragment wrapper only shifts line 1).
  const lineStarts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === "\n") lineStarts.push(i + 1);
  const at = (offset: number): Position => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    const column = offset - lineStarts[lo]! + 1 - (lo === 0 ? shift : 0);
    return { line: lo + 1, column };
  };

  const range = (start: number, end: number): Range => ({ start: start - shift, end: end - shift });
  const snippet: Snippet = { classes: [], styles: [], elements: [] };
  const addClasses = (text: string, start: number) => {
    for (const m of text.matchAll(/\S+/g)) snippet.classes.push({ className: m[0], range: range(start + m.index, start + m.index + m[0].length), ...at(start + m.index) });
  };
  traverse(ast, {
    StringLiteral(path) {
      if (mayHoldClasses(path)) addClasses(path.node.value, path.node.start! + 1);
    },
    TemplateElement(path) {
      if (mayHoldClasses(path)) addClasses(path.node.value.raw, path.node.start!);
    },
    JSXElement(path) {
      const node = path.node;
      const opening = node.openingElement;
      const attributes = new Set<string>();
      const values = new Map<string, string>();
      const expressions = new Map<string, string>();
      let spread = false;
      for (const a of opening.attributes) {
        if (a.type === "JSXSpreadAttribute") {
          spread = true;
          continue;
        }
        const name = a.name.type === "JSXIdentifier" ? a.name.name : `${a.name.namespace.name}:${a.name.name.name}`;
        attributes.add(name);
        const v = a.value;
        if (v?.type === "StringLiteral") values.set(name, v.value);
        else if (v?.type === "JSXExpressionContainer" && v.expression.type === "StringLiteral") values.set(name, v.expression.value);
        else if (v?.type === "JSXExpressionContainer" && v.expression.type === "TemplateLiteral" && v.expression.expressions.length === 0) {
          values.set(name, v.expression.quasis[0]?.value.cooked ?? "");
        } else if (v?.type === "JSXExpressionContainer" && v.expression.type !== "JSXEmptyExpression") {
          expressions.set(name, source.slice(v.expression.start!, v.expression.end!));
        }

        if (name === "style" && v?.type === "JSXExpressionContainer" && v.expression.type === "ObjectExpression") {
          for (const p of v.expression.properties) {
            if (p.type !== "ObjectProperty") continue;
            const key = p.key.type === "Identifier" ? p.key.name : p.key.type === "StringLiteral" ? p.key.value : null;
            if (key === null) continue;
            const val = p.value;
            if (val.type === "StringLiteral") snippet.styles.push({ property: key, value: val.value, ...at(val.start! + 1) });
            else if (val.type === "TemplateLiteral" && val.expressions.length === 0) {
              snippet.styles.push({ property: key, value: val.quasis[0]?.value.cooked ?? "", ...at(val.quasis[0]!.start!) });
            }
          }
        }
      }
      const closing = node.closingElement;
      snippet.elements.push({
        nameRange: range(opening.name.start!, opening.name.end!),
        ...(closing ? { closingNameRange: range(closing.name.start!, closing.name.end!) } : {}),
        name: nameOf(opening.name),
        attributes,
        values,
        expressions,
        ancestors: ancestorsOf(path),
        spread,
        openingTag: source.slice(opening.start!, opening.end!),
        source: source.slice(node.start!, node.end!),
        node,
        ...at(opening.start!),
      });
    },
  });

  const byPosition = (a: Position, b: Position) => a.line - b.line || a.column - b.column;
  snippet.classes.sort(byPosition);
  snippet.styles.sort(byPosition);
  snippet.elements.sort(byPosition);

  const imports = new Map<string, string>();
  let importAt = 0;
  const program = ast.program;
  const lastDirective = program.directives?.at(-1);
  if (lastDirective) importAt = lastDirective.end! - shift;
  for (const stmt of program.body) {
    if (stmt.type !== "ImportDeclaration") continue;
    importAt = stmt.end! - shift;
    for (const spec of stmt.specifiers) imports.set(spec.local.name, stmt.source.value);
  }
  const file: ParsedFile = { ...snippet, code, isModule: shift === 0, imports, importAt };
  if (input.path !== undefined) file.path = input.path;
  return file;
}

/**
 * Whether children give an element an accessible name: visible text, an
 * expression (it might be text), or an image with alt text. Icons alone don't.
 */
export function hasTextContent(children: readonly JsxChild[]): boolean {
  return children.some((c) => {
    if (c.type === "JSXText") return c.value.trim() !== "";
    if (c.type === "JSXExpressionContainer") return c.expression.type !== "JSXEmptyExpression";
    if (c.type === "JSXSpreadChild") return true;
    if (c.type === "JSXFragment") return hasTextContent(c.children);
    const opening = c.openingElement;
    if (opening.attributes.some((a) => a.type === "JSXSpreadAttribute")) return true;
    const named = opening.attributes.some(
      (a) => a.type === "JSXAttribute" && a.name.type === "JSXIdentifier" && (a.name.name === "alt" || a.name.name === "aria-label") && !(a.value?.type === "StringLiteral" && a.value.value === ""),
    );
    if (named) return true;
    return hasTextContent(c.children);
  });
}
