import type { SystemModel } from "@steward/model";
import { checkContext, type CheckContext } from "./context.js";
import type { Finding, RuleId, TextEdit } from "./findings.js";
import { parseFile, type ParsedFile } from "./parse.js";
import type { GuardRule, Hit } from "./rule.js";
import { RULES } from "./rules/index.js";

export interface CheckResult {
  /** Sorted by line, column, then rule order. */
  findings: Finding[];
  /** What ran, in plain English, e.g. "spacing off the scale". */
  checked: string[];
  /** What didn't run because a person turned its system rule off. */
  skipped: string[];
}

export interface CheckOptions {
  /** Run only these rules. Default: all of them. */
  rules?: readonly RuleId[];
}

const ORDER = new Map(RULES.map((r, i) => [r.id, i]));

const contextOf = (model: SystemModel | CheckContext): CheckContext => ("tokens" in model ? checkContext(model) : model);

function toFinding(rule: GuardRule, hit: Hit, file: ParsedFile, ctx: CheckContext): Finding {
  const systemRule = hit.systemRule === undefined ? undefined : ctx.rules.get(hit.systemRule);
  const finding: Finding = {
    rule: rule.id,
    severity: systemRule?.severity ?? rule.severity,
    category: rule.category,
    line: hit.line,
    column: hit.column,
    found: hit.found,
    message: hit.message,
    evidence: hit.evidence,
    fix: { ...hit.fix },
  };
  if (file.path !== undefined) finding.file = file.path;
  if (hit.systemRule !== undefined) finding.systemRule = hit.systemRule;
  const edits = rule.fix?.(file, hit, ctx) ?? null;
  if (edits && edits.length > 0) finding.fix.edits = edits;
  return finding;
}

/**
 * Runs Steward Review's rules on one file. Pure and deterministic. A rule
 * (or part of one) whose system rule a person turned off is skipped, and a
 * person's severity on a system rule wins over the rule's default. Throws
 * `SnippetParseError` when the code can't be read as JSX.
 */
export function checkFile(input: ParsedFile | { path?: string; code: string }, model: SystemModel | CheckContext, options: CheckOptions = {}): CheckResult {
  const ctx = contextOf(model);
  const file = "elements" in input ? input : parseFile(input);
  const isOn = (systemRule: string | undefined) => systemRule === undefined || ctx.rules.get(systemRule)?.enabled !== false;
  const result: CheckResult = { findings: [], checked: [], skipped: [] };

  for (const rule of RULES) {
    if (options.rules && !options.rules.includes(rule.id)) continue;
    const covers = rule.covers(ctx);
    const on = covers.filter((c) => isOn(c.systemRule));
    result.checked.push(...on.map((c) => c.label));
    result.skipped.push(...covers.filter((c) => !isOn(c.systemRule)).map((c) => c.label));
    if (covers.length > 0 && on.length === 0) continue;
    for (const hit of rule.check(file, ctx)) if (isOn(hit.systemRule)) result.findings.push(toFinding(rule, hit, file, ctx));
  }
  result.findings.sort((a, b) => a.line - b.line || a.column - b.column || ORDER.get(a.rule)! - ORDER.get(b.rule)!);
  return result;
}

const same = (a: TextEdit, b: TextEdit) => a.start === b.start && a.end === b.end && a.text === b.text;

function overlaps(a: TextEdit, b: TextEdit): boolean {
  const aInsert = a.start === a.end;
  const bInsert = b.start === b.end;
  if (aInsert && bInsert) return false;
  if (aInsert) return b.start <= a.start && a.start < b.end;
  if (bInsert) return a.start <= b.start && b.start < a.end;
  return a.start < b.end && b.start < a.end;
}

export interface FixResult {
  /** The corrected code. */
  code: string;
  /** Findings whose fix was applied. */
  fixed: Finding[];
  /** Findings left as they were: no safe fix, or their edits clashed with an earlier fix. */
  notFixed: Finding[];
}

/**
 * Pure: applies the fixes in `findings` to `code` and returns the corrected
 * code. A finding's edits apply all together or not at all. Identical edits
 * (like the same import added twice) are made once. Writes nothing.
 */
export function applyFixes(code: string, findings: readonly Finding[]): FixResult {
  const accepted: TextEdit[] = [];
  const fixed: Finding[] = [];
  const notFixed: Finding[] = [];
  for (const f of findings) {
    const edits = f.fix.edits ?? [];
    const fresh = edits.filter((e) => !accepted.some((a) => same(a, e)));
    if (edits.length === 0 || fresh.some((e) => accepted.some((a) => overlaps(a, e)))) {
      notFixed.push(f);
      continue;
    }
    accepted.push(...fresh);
    fixed.push(f);
  }
  // Apply from the end so earlier offsets stay valid; inserts at the same spot keep their order.
  const ordered = accepted.map((e, i) => ({ e, i })).sort((x, y) => y.e.start - x.e.start || y.i - x.i);
  let out = code;
  for (const { e } of ordered) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return { code: out, fixed, notFixed };
}
