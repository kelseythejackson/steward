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
 * A comment on its own line covers the next line; one after code covers its
 * own line. The reason is required: without one, nothing is ignored.
 */

export interface IgnoreComment {
  /** The line the comment is on (1-based). */
  line: number;
  /** The line whose flags it covers. */
  covers: number;
  /** Rule ids as written, in order. */
  rules: string[];
  /** The reason after the colon, trimmed; `""` when there isn't one. */
  reason: string;
}

/** `//` or `/*`, then `steward-ignore`, then the rest of the line. */
const COMMENT = /(\/\/|\/\*)\s*steward-ignore\b(.*)$/;

/** Pure: every `steward-ignore` comment in the code, in line order. Single-line comments only. */
export function parseIgnores(code: string): IgnoreComment[] {
  const out: IgnoreComment[] = [];
  code.split("\n").forEach((text, i) => {
    const m = COMMENT.exec(text);
    if (!m) return;
    const before = text.slice(0, m.index).trim();
    let rest = m[2]!;
    if (m[1] === "/*") rest = rest.replace(/\*\/.*$/, "");
    const colon = rest.indexOf(":");
    const ids = colon === -1 ? rest : rest.slice(0, colon);
    const reason = colon === -1 ? "" : rest.slice(colon + 1).trim();
    const line = i + 1;
    // `{/* ... */}` on its own line is a comment-only line too.
    const ownLine = before === "" || before === "{";
    out.push({ line, covers: ownLine ? line + 1 : line, rules: ids.split(/[\s,]+/).filter((s) => s !== ""), reason });
  });
  return out;
}
