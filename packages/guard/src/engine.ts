import type { SystemModel } from "@steward/model";
import { checkContext, type CheckContext } from "./context.js";
import type { Finding, IgnoredFinding, Note, RuleId, TextEdit } from "./findings.js";
import { parseIgnores } from "./ignore.js";
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
  /** Findings marked intentional with a `steward-ignore` comment (with a reason). Not in `findings`. */
  ignored: IgnoredFinding[];
  /** Problems with `steward-ignore` comments, so a typo never quietly hides nothing. */
  notes: Note[];
}

export interface CheckOptions {
  /** Run only these rules. Default: all of them. */
  rules?: readonly RuleId[];
  /** Rules a person turned off (in `.steward/config.json`). Listed under `skipped`, like system rules that are off. */
  off?: readonly RuleId[];
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
  const result: CheckResult = { findings: [], checked: [], skipped: [], ignored: [], notes: [] };
  const ran = new Set<RuleId>();

  for (const rule of RULES) {
    if (options.rules && !options.rules.includes(rule.id)) continue;
    const covers = rule.covers(ctx);
    if (options.off?.includes(rule.id)) {
      result.skipped.push(...covers.map((c) => c.label));
      continue;
    }
    const on = covers.filter((c) => isOn(c.systemRule));
    result.checked.push(...on.map((c) => c.label));
    result.skipped.push(...covers.filter((c) => !isOn(c.systemRule)).map((c) => c.label));
    if (covers.length > 0 && on.length === 0) continue;
    ran.add(rule.id);
    for (const hit of rule.check(file, ctx)) if (isOn(hit.systemRule)) result.findings.push(toFinding(rule, hit, file, ctx));
  }
  result.findings.sort((a, b) => a.line - b.line || a.column - b.column || ORDER.get(a.rule)! - ORDER.get(b.rule)!);
  applyIgnores(file, result, ran);
  return result;
}

const RULE_IDS = new Set<string>(RULES.map((r) => r.id));
const code = (s: string) => `\`${s}\``;
const list = (xs: readonly string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/**
 * Moves findings covered by a `steward-ignore` comment (with a reason) from
 * `findings` to `ignored`, and adds a note for each comment that doesn't
 * work as written. A comment for a rule that didn't run gets no note: it
 * may matter again when the rule is turned back on.
 */
function applyIgnores(file: ParsedFile, result: CheckResult, ran: ReadonlySet<RuleId>): void {
  const comments = parseIgnores(file.code);
  if (comments.length === 0) return;
  const note = (line: number, covers: number, message: string) => {
    const n: Note = { line, covers, message };
    if (file.path !== undefined) n.file = file.path;
    result.notes.push(n);
  };

  for (const c of comments) {
    const known = c.rules.filter((r) => RULE_IDS.has(r));
    const unknown = c.rules.filter((r) => !RULE_IDS.has(r));
    if (c.rules.length === 0) {
      note(c.line, c.covers, "This steward-ignore doesn't name a rule, so nothing is ignored. Write the rule first, like `// steward-ignore use-system-component: why`.");
      continue;
    }
    if (unknown.length > 0) {
      note(c.line, c.covers, `This steward-ignore names ${list(unknown.map(code))}, which ${unknown.length === 1 ? "isn't a Review rule" : "aren't Review rules"}. The rules are ${list(RULES.map((r) => code(r.id)))}.`);
    }
    if (known.length === 0) continue;
    const covered = result.findings.filter((f) => f.line === c.covers && known.includes(f.rule));
    if (c.reason === "") {
      if (covered.length > 0) {
        note(c.line, c.covers, `This steward-ignore has no reason, so it isn't applied. Add one after a colon so the next person knows why: \`// steward-ignore ${known.join(", ")}: <why>\`.`);
      }
      continue;
    }
    result.ignored.push(...covered.map((finding) => ({ finding, reason: c.reason, commentLine: c.line })));
    result.findings = result.findings.filter((f) => !covered.includes(f));
    const unused = known.filter((r) => ran.has(r as RuleId) && !covered.some((f) => f.rule === r));
    if (unused.length > 0) {
      note(c.line, c.covers, `Nothing on line ${c.covers} is flagged by ${list(unused.map(code))}, so this steward-ignore can be removed${unused.length < known.length ? " for that rule" : ""}.`);
    }
  }
}

/** What `checkFile` would check and skip, without a file: for reports that cover many files, or none. */
export function coverage(model: SystemModel | CheckContext, options: CheckOptions = {}): Pick<CheckResult, "checked" | "skipped"> {
  const ctx = contextOf(model);
  const isOn = (systemRule: string | undefined) => systemRule === undefined || ctx.rules.get(systemRule)?.enabled !== false;
  const out: Pick<CheckResult, "checked" | "skipped"> = { checked: [], skipped: [] };
  for (const rule of RULES) {
    if (options.rules && !options.rules.includes(rule.id)) continue;
    const covers = rule.covers(ctx);
    const off = options.off?.includes(rule.id) ?? false;
    out.checked.push(...covers.filter((c) => !off && isOn(c.systemRule)).map((c) => c.label));
    out.skipped.push(...covers.filter((c) => off || !isOn(c.systemRule)).map((c) => c.label));
  }
  return out;
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
