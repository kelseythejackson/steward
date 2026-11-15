import { CHECKS, checkCode, readSnippet, SnippetParseError, type CheckContext, type CheckId } from "@steward/guard";
import { compareStrings } from "@steward/model";
import { findReplacedUses } from "./replaced.js";

/** The guard's checks, plus the eval-only replaced-component count. */
export type EvalCheck = CheckId | "replaced-component";

export const EVAL_CHECKS: readonly { id: EvalCheck; label: string }[] = [
  ...CHECKS.map((c) => ({ id: c.id, label: c.label })),
  { id: "replaced-component", label: "replaced components" },
];

export interface EvalFinding {
  check: EvalCheck;
  line: number;
  column: number;
  found: string;
  message: string;
}

export interface FileScore {
  path: string;
  addedLines: number;
  findings: EvalFinding[];
  /** Set when the file couldn't be read as JSX, so nothing in it was checked. */
  parseError?: string;
}

export interface RunTotals {
  addedLines: number;
  problems: number;
  byCheck: Record<EvalCheck, number>;
  parseErrors: number;
}

export interface RunResult {
  /** `with` or `without`, from the copy's folder name. */
  condition: string;
  /** `pricing-1`. */
  label: string;
  /** `pricing`, the label without its run number. */
  prompt: string;
  files: FileScore[];
  totals: RunTotals;
}

/** Source files worth checking. Generated folders and type declarations are skipped. */
export const isScored = (path: string) =>
  /\.(tsx|jsx|ts|js)$/.test(path) && !path.endsWith(".d.ts") && !/(^|\/)(node_modules|dist|\.steward)\//.test(path);

/** Pure: findings on the added lines of one file. */
export function scoreFile(
  path: string,
  code: string,
  added: ReadonlySet<number>,
  ctx: CheckContext,
  replaced: ReadonlyMap<string, string>,
): FileScore {
  const score: FileScore = { path, addedLines: added.size, findings: [] };
  try {
    const guard = checkCode(code, ctx).findings.map((f) => ({
      check: f.check as EvalCheck,
      line: f.line,
      column: f.column,
      found: f.found,
      message: f.message,
    }));
    const swaps = findReplacedUses(readSnippet(code), replaced).map((u) => ({
      check: "replaced-component" as const,
      line: u.line,
      column: u.column,
      found: u.found,
      message: `Uses a component that was merged into \`${u.keeper}\`.`,
    }));
    score.findings = [...guard, ...swaps]
      .filter((f) => added.has(f.line))
      .sort((a, b) => a.line - b.line || a.column - b.column || compareStrings(a.check, b.check));
  } catch (err) {
    if (!(err instanceof SnippetParseError)) throw err;
    score.parseError = err.message;
  }
  return score;
}

export function emptyByCheck(): Record<EvalCheck, number> {
  return Object.fromEntries(EVAL_CHECKS.map((c) => [c.id, 0])) as Record<EvalCheck, number>;
}

/** Pure: adds up a run's files. */
export function totalsOf(files: readonly FileScore[]): RunTotals {
  const byCheck = emptyByCheck();
  let problems = 0;
  for (const f of files) {
    for (const finding of f.findings) {
      byCheck[finding.check] += 1;
      problems += 1;
    }
  }
  return {
    addedLines: files.reduce((n, f) => n + f.addedLines, 0),
    problems,
    byCheck,
    parseErrors: files.filter((f) => f.parseError !== undefined).length,
  };
}

/** `pricing-1` → `pricing`. A label with no run number is its own prompt. */
export const promptOf = (label: string) => label.replace(/-\d+$/, "");
