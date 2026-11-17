/**
 * Which lines a change added, read from `git diff -U0`. `steward check` and
 * the eval check only these lines, so problems already in the code don't
 * count against a change.
 */

/**
 * Pure: a path as `git diff` writes it after `+++ `. Git adds a tab after a
 * name with spaces in it, and wraps names with quotes, backslashes or
 * control characters in C-style quotes (`"b/q\\"uote.tsx"`), with octal
 * escapes for raw bytes.
 */
export function diffPath(raw: string): string {
  const text = raw.replace(/\t$/, "");
  if (!text.startsWith('"') || !text.endsWith('"') || text.length < 2) return text;
  const bytes: number[] = [];
  const simple: Record<string, number> = { n: 10, t: 9, r: 13, a: 7, b: 8, f: 12, v: 11, '"': 34, "\\": 92 };
  // By code point, so characters outside the Basic Multilingual Plane (emoji) stay whole.
  const chars = [...text.slice(1, -1)];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]!;
    if (c !== "\\") {
      bytes.push(...Buffer.from(c, "utf8"));
      continue;
    }
    const next = chars[i + 1] ?? "";
    if (/[0-7]/.test(next)) {
      bytes.push(parseInt(chars.slice(i + 1, i + 4).join(""), 8));
      i += 3;
    } else {
      bytes.push(simple[next] ?? next.charCodeAt(0));
      i += 1;
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

/** Added line numbers (1-based, in the new file) by repo-relative path. */
export type AddedLines = Map<string, Set<number>>;

const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/**
 * Pure: parses `git diff -U0 --no-color` output (with renames found or not). Deleted files
 * are skipped. A hunk like `+12,0` adds nothing; `+12` alone adds one line.
 */
export function parseAddedLines(diff: string): AddedLines {
  const out: AddedLines = new Map();
  let current: Set<number> | null = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      const target = diffPath(line.slice(4));
      if (target === "/dev/null") {
        current = null;
      } else {
        const path = target.replace(/^b\//, "");
        current = out.get(path) ?? new Set<number>();
        out.set(path, current);
      }
      continue;
    }
    const hunk = HUNK.exec(line);
    if (hunk && current) {
      const start = Number(hunk[1]);
      const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
      for (let n = start; n < start + count; n++) current.add(n);
    }
  }
  for (const [path, lines] of out) if (lines.size === 0) out.delete(path);
  return out;
}

/** Pure: every line of a new (untracked) file counts as added. */
export function allLines(code: string): Set<number> {
  const count = code.length === 0 ? 0 : code.replace(/\n$/, "").split("\n").length;
  return new Set(Array.from({ length: count }, (_, i) => i + 1));
}
