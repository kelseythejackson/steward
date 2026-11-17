import traverse, { type NodePath } from "@babel/traverse";
import { parseCode, type ParsedCode } from "./parse.js";

/**
 * `steward-ignore` comments: how a person marks a Review flag as
 * intentional, with a reason, right where the code is.
 *
 * ```tsx
 * // steward-ignore use-system-component: marketing hero needs a custom button
 * <button className="hero-cta">Start</button>
 *
 * {/* steward-ignore no-hardcoded-color, a11y-text-contrast: partner's brand color *\/}
 * <p className="text-[#ff6b00]">Powered by Partner</p>
 *
 * <img src="/divider.svg" /> // steward-ignore a11y-img-alt: decorative, hidden from screen readers by its parent
 * ```
 *
 * A comment on its own line covers the next line; one on the same line as
 * code covers that line. Either way, when a JSX element starts on the
 * covered line, its whole opening tag is covered (however many lines its
 * attributes take), and when a plain statement starts there, all of its
 * lines are. The reason is required: without one, nothing is ignored.
 *
 * Only real comments count: `//` and `/* *\/` in code, `{/* *\/}` in JSX.
 * `// steward-ignore …` typed between JSX tags is text that shows on the
 * page, so it's reported (`inText`) but never applied.
 */

export interface IgnoreComment {
  /** The line the comment is on (1-based). */
  line: number;
  /** The first line whose flags it covers. */
  covers: number;
  /** The last line whose flags it covers (the same as `covers` for a one-line element or statement). */
  through: number;
  /** Rule ids as written, in order. */
  rules: string[];
  /** The reason after the colon, trimmed; `""` when there isn't one. */
  reason: string;
  /** Written as JSX text, not a comment, so it renders on the page and isn't applied. */
  inText?: true;
}

const MARKER = /^\s*steward-ignore\b([\s\S]*)$/;
const TEXT_MARKER = /(\/\/|\/\*)\s*steward-ignore\b(.*)$/;

/** `rule-a, rule-b: reason` → rule ids and reason. */
function readBody(body: string): Pick<IgnoreComment, "rules" | "reason"> {
  const colon = body.indexOf(":");
  const ids = colon === -1 ? body : body.slice(0, colon);
  const reason = colon === -1 ? "" : body.slice(colon + 1).replace(/\s+/g, " ").trim();
  return { rules: ids.split(/[\s,]+/).filter((s) => s !== ""), reason };
}

/** Statements whose lines are all covered: not blocks, functions or JSX, which can hold a whole component. */
function coversWhole(path: NodePath): boolean {
  if (!path.isStatement() || path.isBlockStatement() || path.isFunctionDeclaration() || path.isClassDeclaration()) return false;
  if (path.isIfStatement() || path.isLoop() || path.isTryStatement() || path.isSwitchStatement() || path.isLabeledStatement()) return false;
  let nested = false;
  path.traverse({
    enter(p) {
      if (p.isFunction() || p.isClass() || p.isJSXElement() || p.isJSXFragment()) {
        nested = true;
        p.stop();
      }
    },
  });
  return !nested;
}

/** Pure: every `steward-ignore` comment in the code, in line order. `parsed` saves parsing the code again. */
export function parseIgnores(code: string, parsed: ParsedCode | null = code.includes("steward-ignore") ? parseCode(code) : null): IgnoreComment[] {
  if (!parsed) return [];
  const { ast, source, shift } = parsed;
  const out: IgnoreComment[] = [];

  for (const c of ast.comments ?? []) {
    const m = MARKER.exec(c.value);
    if (!m) continue;
    const start = c.loc!.start;
    const end = c.loc!.end;
    // Offsets in the code as given (the fragment wrapper, if any, only shifts them).
    const from = c.start! - shift;
    const to = c.end! - shift;
    const before = code.slice(code.lastIndexOf("\n", from - 1) + 1, from).trim();
    const lineEnd = code.indexOf("\n", to);
    const after = code.slice(to, lineEnd === -1 ? code.length : lineEnd).trim();
    // `{/* … */}` alone on its line is a comment-only line too.
    const ownLine = (before === "" || before === "{") && (after === "" || after === "}");
    const covers = ownLine ? end.line + 1 : start.line;
    out.push({ line: start.line, covers, through: covers, ...readBody(m[1]!) });
  }

  // Comment-like text between JSX tags: shown on the page, so never applied.
  const text: IgnoreComment[] = [];
  const targets = new Map(out.map((c) => [c.covers, c.covers]));
  traverse(ast, {
    JSXText(path) {
      const { node } = path;
      source
        .slice(node.start!, node.end!)
        .split("\n")
        .forEach((segment, i) => {
          const m = TEXT_MARKER.exec(segment);
          if (!m) return;
          const line = node.loc!.start.line + i;
          let body = m[2]!;
          if (m[1] === "/*") body = body.replace(/\*\/.*$/, "");
          text.push({ line, covers: line + 1, through: line + 1, ...readBody(body), inText: true });
        });
    },
    enter(path) {
      const loc = path.node.loc;
      if (!loc || !targets.has(loc.start.line)) return;
      const last = path.isJSXElement() ? path.node.openingElement.loc!.end.line : coversWhole(path) ? loc.end.line : loc.start.line;
      if (last > targets.get(loc.start.line)!) targets.set(loc.start.line, last);
    },
  });
  for (const c of out) c.through = targets.get(c.covers)!;
  return [...out, ...text].sort((a, b) => a.line - b.line);
}
