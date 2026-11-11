import { parse } from "@babel/parser";
import traverse, { type NodePath } from "@babel/traverse";
import { compareStrings } from "@steward/model";
import type { SourceFile } from "../colors/types.js";
import { classAlternatives } from "../contrast/jsx.js";
import { classPatterns } from "./patterns.js";
import type { ComponentInfo, ComponentInventory } from "./types.js";

type Node = Parameters<typeof traverse>[0];
type N<T extends Node["type"]> = Extract<Node, { type: T }>;
type FnPath = NodePath<N<"FunctionDeclaration"> | N<"FunctionExpression"> | N<"ArrowFunctionExpression">>;
type TypeDecl = N<"TSInterfaceDeclaration"> | N<"TSTypeAliasDeclaration">;

const INTERACTIVE = new Set(["a", "button", "input", "select", "textarea", "summary", "label"]);
const sorted = (xs: Iterable<string>) => [...new Set(xs)].sort(compareStrings);

export const isComponentFile = (path: string) => path.endsWith(".tsx");

/**
 * The name an anonymous default export goes by: the file name in
 * PascalCase (`user-card.tsx` → `UserCard`), or the folder's for an
 * `index.tsx` (`Card/index.tsx` → `Card`). That's how it's imported and rendered.
 */
export function nameFromFile(file: string): string {
  const parts = file.split("/");
  let base = parts[parts.length - 1]!.replace(/\.[^.]+$/, "");
  if (base === "index" && parts.length > 1) base = parts[parts.length - 2]!;
  return base
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join("");
}

function jsxName(name: N<"JSXOpeningElement">["name"]): string {
  if (name.type === "JSXIdentifier") return name.name;
  if (name.type === "JSXNamespacedName") return `${name.namespace.name}:${name.name.name}`;
  return `${jsxName(name.object as N<"JSXOpeningElement">["name"])}.${name.property.name}`;
}

function keyName(key: Node): string | null {
  if (key.type === "Identifier") return key.name;
  if (key.type === "StringLiteral") return key.value;
  return null;
}

/** Follows `memo(...)`, `forwardRef(...)` and TS wrappers to the function inside. */
function functionOf(p: NodePath): FnPath | null {
  if (p.isArrowFunctionExpression() || p.isFunctionExpression() || p.isFunctionDeclaration()) return p as FnPath;
  if (p.isTSAsExpression() || p.isTSSatisfiesExpression() || p.isParenthesizedExpression()) return functionOf(p.get("expression") as NodePath);
  if (p.isCallExpression()) {
    const first = p.get("arguments")[0];
    return first ? functionOf(first as NodePath) : null;
  }
  return null;
}

/** Every JSX element (or fragment) an expression can evaluate to. */
function rootsOf(p: NodePath, out: { tags: string[]; elements: NodePath<N<"JSXElement">>[] }): void {
  if (p.isJSXElement()) {
    out.tags.push(jsxName(p.node.openingElement.name));
    out.elements.push(p);
  } else if (p.isJSXFragment()) out.tags.push("fragment");
  else if (p.isParenthesizedExpression() || p.isTSAsExpression() || p.isTSNonNullExpression()) rootsOf(p.get("expression") as NodePath, out);
  else if (p.isConditionalExpression()) {
    rootsOf(p.get("consequent"), out);
    rootsOf(p.get("alternate"), out);
  } else if (p.isLogicalExpression()) {
    if (p.node.operator !== "&&") rootsOf(p.get("left"), out);
    rootsOf(p.get("right"), out);
  }
}

interface PropsShape {
  props: Set<string>;
  extendsTypes: Set<string>;
  variantType: Node | null;
}

/** Reads prop names from a props type: inline literals, same-file interfaces and aliases, and intersections. */
function readType(type: Node, decls: Map<string, TypeDecl>, code: string, shape: PropsShape, depth = 0): void {
  if (depth > 5) return;
  const members = (body: Node[]) => {
    for (const m of body) {
      if ((m.type === "TSPropertySignature" || m.type === "TSMethodSignature") && !m.computed) {
        const k = keyName(m.key as Node);
        if (!k) continue;
        shape.props.add(k);
        if (k === "variant" && m.type === "TSPropertySignature" && m.typeAnnotation) shape.variantType = m.typeAnnotation.typeAnnotation as Node;
      }
    }
  };
  if (type.type === "TSTypeLiteral") members(type.members as Node[]);
  else if (type.type === "TSIntersectionType") for (const t of type.types) readType(t as Node, decls, code, shape, depth + 1);
  else if (type.type === "TSTypeReference") {
    const decl = type.typeName.type === "Identifier" ? decls.get(type.typeName.name) : undefined;
    if (!decl) shape.extendsTypes.add(code.slice(type.start!, type.end!));
    else if (decl.type === "TSTypeAliasDeclaration") readType(decl.typeAnnotation as Node, decls, code, shape, depth + 1);
    else {
      members(decl.body.body as Node[]);
      for (const h of decl.extends ?? []) {
        const name = h.expression.type === "Identifier" ? h.expression.name : null;
        const local = name ? decls.get(name) : undefined;
        if (local) readType({ type: "TSTypeReference", typeName: h.expression } as unknown as Node, decls, code, shape, depth + 1);
        else shape.extendsTypes.add(code.slice(h.start!, h.end!));
      }
    }
  }
}

function unionValues(type: Node | null, decls: Map<string, TypeDecl>): string[] {
  if (!type) return [];
  if (type.type === "TSTypeReference" && type.typeName.type === "Identifier") {
    const d = decls.get(type.typeName.name);
    return d?.type === "TSTypeAliasDeclaration" ? unionValues(d.typeAnnotation as Node, decls) : [];
  }
  if (type.type === "TSUnionType") return type.types.flatMap((t) => unionValues(t as Node, decls));
  if (type.type === "TSLiteralType" && type.literal.type === "StringLiteral") return [type.literal.value];
  return [];
}

function behaviorOf(fn: FnPath, roots: { tags: string[]; elements: NodePath<N<"JSXElement">>[] }): string[] {
  const traits = new Set<string>();
  const isKey = (n: Node) => (n.type === "MemberExpression" || n.type === "OptionalMemberExpression") && n.property.type === "Identifier" && n.property.name === "key";
  fn.traverse({
    JSXAttribute(p) {
      if (p.node.name.type !== "JSXIdentifier") return;
      const name = p.node.name.name;
      if (name === "role" && p.node.value?.type === "StringLiteral") traits.add(`sets role="${p.node.value.value}"`);
      if (name === "aria-modal") traits.add("sets aria-modal");
    },
    "CallExpression|OptionalCallExpression"(p) {
      const callee = (p.node as N<"CallExpression">).callee as Node;
      if ((callee.type === "MemberExpression" || callee.type === "OptionalMemberExpression") && callee.property.type === "Identifier" && callee.property.name === "focus") {
        traits.add("moves focus");
      }
    },
    BinaryExpression(p) {
      if (!["===", "!==", "==", "!="].includes(p.node.operator)) return;
      const { left, right } = p.node;
      const literal = left.type === "StringLiteral" ? left : right.type === "StringLiteral" ? right : null;
      const other = literal === left ? right : left;
      if (literal && isKey(other as Node)) traits.add(`handles the ${literal.value} key`);
    },
  });
  for (const el of roots.elements) {
    const opening = el.node.openingElement;
    const tag = jsxName(opening.name);
    if (!/^[a-z]/.test(tag) || INTERACTIVE.has(tag)) continue;
    if (opening.attributes.some((a) => a.type === "JSXAttribute" && a.name.type === "JSXIdentifier" && a.name.name === "onClick")) {
      traits.add(`handles clicks on its root <${tag}>`);
    }
  }
  if (roots.tags.includes("a")) traits.add("renders a link");
  return sorted(traits);
}

function rootClassPatterns(elements: readonly NodePath<N<"JSXElement">>[]): string[] {
  const lists: string[] = [];
  for (const el of elements) {
    for (const a of el.node.openingElement.attributes) {
      if (a.type !== "JSXAttribute" || a.name.type !== "JSXIdentifier" || a.name.name !== "className") continue;
      if (a.value?.type === "StringLiteral") lists.push(a.value.value);
      else if (a.value?.type === "JSXExpressionContainer" && a.value.expression.type !== "JSXEmptyExpression") {
        lists.push(...classAlternatives(a.value.expression as Node, el.scope));
      }
    }
  }
  return classPatterns(...lists);
}

interface FileAnalysis {
  components: ComponentInfo[];
  /** Names of every element rendered in the file, one entry per use. */
  rendered: string[];
}

function analyzeFile(code: string, file: string): FileAnalysis {
  const ast = parse(code, { sourceType: "module", plugins: ["typescript", "jsx"] });
  const components: ComponentInfo[] = [];
  const rendered: string[] = [];

  traverse(ast, {
    JSXOpeningElement(p) {
      rendered.push(jsxName(p.node.name));
    },
    Program(program) {
      const body = program.get("body");
      const decls = new Map<string, TypeDecl>();
      const exportedNames = new Set<string>();
      for (const stmt of body) {
        const inner = stmt.isExportNamedDeclaration() || stmt.isExportDefaultDeclaration() ? stmt.node.declaration : stmt.node;
        if (inner?.type === "TSInterfaceDeclaration" || inner?.type === "TSTypeAliasDeclaration") decls.set(inner.id.name, inner);
        if (stmt.isExportNamedDeclaration()) {
          for (const s of stmt.node.specifiers) if (s.type === "ExportSpecifier" && s.local.type === "Identifier") exportedNames.add(s.local.name);
        }
        if (stmt.isExportDefaultDeclaration() && stmt.node.declaration.type === "Identifier") exportedNames.add(stmt.node.declaration.name);
      }

      const add = (name: string, fnPath: FnPath | null, line: number, exported: boolean) => {
        if (!fnPath || !/^[A-Z]/.test(name)) return;
        const roots = { tags: [] as string[], elements: [] as NodePath<N<"JSXElement">>[] };
        const fnBody = fnPath.get("body") as NodePath;
        if (!fnBody.isBlockStatement()) rootsOf(fnBody, roots);
        else {
          fnBody.traverse({
            Function(p) {
              p.skip();
            },
            ReturnStatement(p) {
              const arg = p.get("argument");
              if (arg.node) rootsOf(arg as NodePath, roots);
            },
          });
        }
        if (roots.tags.length === 0) return;

        const shape: PropsShape = { props: new Set(), extendsTypes: new Set(), variantType: null };
        let spreadsRest = false;
        const param = fnPath.node.params[0] as Node | undefined;
        if (param?.type === "ObjectPattern") {
          for (const prop of param.properties) {
            if (prop.type === "RestElement") spreadsRest = true;
            else if (!prop.computed) {
              const k = keyName(prop.key as Node);
              if (k) shape.props.add(k);
            }
          }
        }
        const annotation = param && "typeAnnotation" in param ? param.typeAnnotation : null;
        if (annotation?.type === "TSTypeAnnotation") readType(annotation.typeAnnotation as Node, decls, code, shape);

        components.push({
          name,
          file,
          line,
          exported: exported || exportedNames.has(name),
          props: sorted(shape.props),
          spreadsRest,
          extendsTypes: sorted(shape.extendsTypes),
          variants: sorted(unionValues(shape.variantType, decls)),
          rootElements: sorted(roots.tags),
          rootClassPatterns: rootClassPatterns(roots.elements),
          behavior: behaviorOf(fnPath, roots),
          usages: 0,
        });
      };

      for (const stmt of body) {
        const exported = stmt.isExportNamedDeclaration() || stmt.isExportDefaultDeclaration();
        const target = (exported ? stmt.get("declaration") : stmt) as NodePath;
        if (target.isFunctionDeclaration() && target.node.id) {
          add(target.node.id.name, target as FnPath, target.node.loc?.start.line ?? 0, exported);
        } else if (stmt.isExportDefaultDeclaration() && !target.isIdentifier() && !target.isClassDeclaration()) {
          // `export default function () {}`, `export default () => …`, `export default memo(function () {})`.
          const fn = target.isFunctionDeclaration() ? (target as FnPath) : functionOf(target);
          add(nameFromFile(file), fn, stmt.node.loc?.start.line ?? 0, true);
        } else if (target.isVariableDeclaration()) {
          for (const d of target.get("declarations")) {
            const id = d.node.id;
            const init = d.get("init");
            if (id.type !== "Identifier" || !init.node) continue;
            add(id.name, functionOf(init as NodePath), d.node.loc?.start.line ?? 0, exported);
          }
        }
      }
    },
  });

  return { components, rendered };
}

/** Lists the React components defined in one TSX file. Throws if the file can't be parsed. */
export function inventoryFile(code: string, file: string): ComponentInfo[] {
  return analyzeFile(code, file).components;
}

/**
 * Pure: lists every React component across a set of files, with how many
 * places render each one. Files that fail to parse are listed in `skipped`.
 */
export function collectComponents(files: readonly SourceFile[]): ComponentInventory {
  const components: ComponentInfo[] = [];
  const usages = new Map<string, number>();
  const skipped: ComponentInventory["skipped"] = [];
  let filesScanned = 0;
  for (const f of [...files].sort((a, b) => compareStrings(a.path, b.path))) {
    if (!isComponentFile(f.path)) continue;
    filesScanned++;
    try {
      const r = analyzeFile(f.content, f.path);
      components.push(...r.components);
      for (const name of r.rendered) usages.set(name, (usages.get(name) ?? 0) + 1);
    } catch (err) {
      skipped.push({ file: f.path, reason: err instanceof Error ? err.message.split("\n")[0]! : String(err) });
    }
  }
  return {
    components: components
      .map((c) => ({ ...c, usages: usages.get(c.name) ?? 0 }))
      .sort((a, b) => compareStrings(a.name, b.name) || compareStrings(a.file, b.file)),
    filesScanned,
    skipped,
  };
}
