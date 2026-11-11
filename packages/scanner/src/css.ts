/** Replaces comments with spaces, keeping newlines so line numbers stay right. */
export function blankComments(code: string, scss: boolean): string {
  const blank = (s: string) => s.replace(/[^\n]/g, " ");
  let out = code.replace(/\/\*[\s\S]*?\*\//g, blank);
  // SCSS line comments. Skip `//` right after `:` so `url(http://…)` survives.
  if (scss) out = out.replace(/(^|[^:])(\/\/[^\n]*)/gm, (_m, before: string, comment: string) => before + blank(comment));
  return out;
}

/** One declaration (`color: #fff`) or at-rule statement (`@apply p-4`) inside a rule, with offsets into the original source. */
export interface CssDeclaration {
  /** Lowercase property (`color`), custom properties as written (`--brandColor`), or `@apply`. */
  prop: string;
  /** The value as written, trimmed, without `!important` removed. */
  value: string;
  /** Offset of the declaration's first character. */
  start: number;
  /** Offset of the value's first character. */
  valueStart: number;
}

export interface CssRule {
  /**
   * The full selector with SCSS nesting resolved (`.card .title`,
   * `.btn:hover`), or `""` for declarations directly inside an at-rule
   * like `@theme`.
   */
  selector: string;
  /** Enclosing at-rule preludes, outermost first, e.g. `["@media (prefers-color-scheme: dark)"]`. */
  atRules: string[];
  declarations: CssDeclaration[];
  /** Offset of the rule's `{`. */
  start: number;
}

/** Splits on commas outside parentheses and brackets: `a, b:is(c, d)` → `["a", "b:is(c, d)"]`. */
function splitSelectors(selector: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i];
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (ch === "," && depth === 0) {
      out.push(selector.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(selector.slice(start).trim());
  return out.filter(Boolean);
}

/** Resolves a nested selector against its parent: `&:hover` → `.btn:hover`, `.title` → `.card .title`. */
export function resolveNested(parent: string, child: string): string {
  const children = splitSelectors(child.replace(/\s+/g, " "));
  if (parent === "") return children.join(", ");
  const parents = splitSelectors(parent);
  return parents.flatMap((p) => children.map((c) => (c.includes("&") ? c.replaceAll("&", p) : `${p} ${c}`))).join(", ");
}

function declaration(code: string, from: number, to: number): CssDeclaration | null {
  const text = code.slice(from, to);
  const lead = text.length - text.trimStart().length;
  const body = text.trim();
  if (body === "") return null;
  if (body.startsWith("@apply")) {
    const value = body.slice("@apply".length).trim();
    return { prop: "@apply", value, start: from + lead, valueStart: from + lead + body.indexOf(value, "@apply".length) };
  }
  if (body.startsWith("@")) return null; // @include, @extend and other at-rule statements carry no colors
  const colon = body.indexOf(":");
  if (colon <= 0) return null;
  const rawProp = body.slice(0, colon).trim();
  if (!/^(?:\$|--?)?[a-zA-Z_][\w-]*$/.test(rawProp)) return null;
  const rest = body.slice(colon + 1);
  const value = rest.trim();
  const valueStart = from + lead + colon + 1 + (rest.length - rest.trimStart().length);
  const keepCase = rawProp.startsWith("--") || rawProp.startsWith("$");
  return { prop: keepCase ? rawProp : rawProp.toLowerCase(), value, start: from + lead, valueStart };
}

/**
 * Pure: reads a stylesheet into rules and their declarations. Handles what
 * the old regex splitting got wrong: `;` and braces inside strings and
 * `url(data:…)`, SCSS nesting (with `&`), and declarations both before and
 * after a nested rule. Comments are ignored; offsets point into `code`.
 */
export function parseCss(code: string, scss = false): CssRule[] {
  const text = blankComments(code, scss);
  type Frame = { rule: CssRule | null; selector: string; atRules: string[] };
  // Top-level declarations are SCSS variables (`$brand: #3b82f6;`); they live in a rule with no selector.
  const root: Frame = { rule: { selector: "", atRules: [], declarations: [], start: 0 }, selector: "", atRules: [] };
  const stack: Frame[] = [root];
  const rules: CssRule[] = [root.rule!];
  let quote: string | null = null;
  let parens = 0;
  let start = 0;

  const flush = (end: number) => {
    const top = stack[stack.length - 1]!;
    if (top.rule) {
      const d = declaration(code, start, end);
      if (d) top.rule.declarations.push(d);
    }
    start = end + 1;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(") parens++;
    else if (ch === ")") parens = Math.max(0, parens - 1);
    else if (parens > 0) continue;
    else if (ch === ";") flush(i);
    else if (ch === "{") {
      const prelude = text.slice(start, i).trim();
      const parent = stack[stack.length - 1]!;
      let frame: Frame;
      if (prelude.startsWith("@")) {
        frame = { rule: null, selector: parent.selector, atRules: [...parent.atRules, prelude.replace(/\s+/g, " ")] };
        // Declarations straight inside an at-rule (`@theme { --color-x: … }`, nested `@media` in SCSS) belong to the enclosing selector.
        frame.rule = { selector: parent.selector, atRules: frame.atRules, declarations: [], start: i };
      } else {
        const selector = resolveNested(parent.selector, prelude);
        frame = { rule: { selector, atRules: parent.atRules, declarations: [], start: i }, selector, atRules: parent.atRules };
      }
      rules.push(frame.rule!);
      stack.push(frame);
      start = i + 1;
    } else if (ch === "}") {
      flush(i);
      if (stack.length > 1) stack.pop();
    }
  }
  return rules.filter((r) => r.declarations.length > 0);
}
