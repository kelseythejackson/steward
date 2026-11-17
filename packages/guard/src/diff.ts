/**
 * Which lines a change added, read from `git diff -U0`. `steward check` and
 * the eval check only these lines, so problems already in the code don't
 * count against a change.
 */

/** Added line numbers (1-based, in the new file) by repo-relative path. */
export type AddedLines = Map<string, Set<number>>;

const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/**
 * Pure: parses `git diff -U0 --no-color --no-renames` output. Deleted files
 * are skipped. A hunk like `+12,0` adds nothing; `+12` alone adds one line.
 */
export function parseAddedLines(diff: string): AddedLines {
  const out: AddedLines = new Map();
  let current: Set<number> | null = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      const target = line.slice(4);
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
