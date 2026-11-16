import { checkFile, RULES, SnippetParseError, type CheckContext, type RuleId } from "@steward/guard";

/** Steward Review's rules, as the eval counts them. */
export type EvalCheck = RuleId;

/** Short column names for the summary table. */
const SHORT: Record<RuleId, string> = {
  "no-hardcoded-color": "Color",
  "no-arbitrary-spacing": "Spacing",
  "use-system-component": "Component",
  "a11y-img-alt": "Alt text",
  "a11y-accessible-name": "Name",
  "a11y-label-inputs": "Label",
  "a11y-interactive-element": "Click target",
  "a11y-focus-visible": "Focus",
  "a11y-text-contrast": "Contrast",
};

export const EVAL_CHECKS: readonly { id: EvalCheck; label: string; short: string }[] = RULES.map((r) => ({ id: r.id, label: r.id, short: SHORT[r.id] }));

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

/** Pure: findings on the added lines of one file, in the guard's order (line, column, rule). */
export function scoreFile(path: string, code: string, added: ReadonlySet<number>, ctx: CheckContext): FileScore {
  const score: FileScore = { path, addedLines: added.size, findings: [] };
  try {
    score.findings = checkFile({ path, code }, ctx)
      .findings.filter((f) => added.has(f.line))
      .map((f) => ({ check: f.rule, line: f.line, column: f.column, found: f.found, message: f.message }));
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
