/**
 * Steward Review over many files: what `steward check` runs, and later the
 * pull request action. Pure: the caller reads git and the files, this
 * decides what to report and whether the build fails.
 */
import type { ReviewMode, StewardConfig, SystemModel } from "@steward/model";
import { STATIC_CHECKS_NOTE } from "./check.js";
import { checkContext, type CheckContext } from "./context.js";
import { checkFile, coverage } from "./engine.js";
import type { Finding, RuleId } from "./findings.js";
import { SnippetParseError } from "./parse.js";
import { RULES } from "./rules/index.js";

/** A file to check. `lines` limits findings to those lines (the changed ones); without it, the whole file counts. */
export interface SourceFile {
  path: string;
  code: string;
  lines?: ReadonlySet<number>;
}

/** What was checked: the lines changed since `base`, or every file. */
export type ReviewScope = { kind: "changes"; base: string } | { kind: "all" };

export interface ReviewResult {
  mode: ReviewMode;
  scope: ReviewScope;
  /** Repo-relative paths checked, sorted. */
  files: string[];
  /** Changed lines in the checked files, when only changes were checked. */
  changedLines?: number;
  /** Sorted by file, then line, column and rule. */
  findings: Finding[];
  /** What ran, in plain English. */
  checked: string[];
  /** What didn't run because a person turned it off, in config.json or system.json. */
  skipped: string[];
  /** Files that couldn't be read as JSX, so nothing in them was checked. */
  unreadable: { path: string; reason: string }[];
  /** True only in `error` mode when something was found. `warn` mode never fails. */
  failed: boolean;
}

const RULE_IDS = new Set<string>(RULES.map((r) => r.id));

/** Pure: rule ids in the config that aren't Review rules (a typo, usually), sorted. */
export function unknownRules(config: StewardConfig): string[] {
  return Object.keys(config.rules).filter((id) => !RULE_IDS.has(id)).sort();
}

/** Pure: the Review rules a config turns off. */
export function rulesOff(config: StewardConfig): RuleId[] {
  return RULES.map((r) => r.id).filter((id) => config.rules[id] === "off");
}

const byPath = (a: { path: string }, b: { path: string }) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/**
 * Pure: runs Review on each file and keeps findings on the given lines. A
 * rule runs only when the config leaves it on and its system rule is
 * enabled. Unknown rule ids should be caught first with `unknownRules`.
 */
export function reviewFiles(files: readonly SourceFile[], model: SystemModel | CheckContext, config: StewardConfig, scope: ReviewScope): ReviewResult {
  const ctx = "tokens" in model ? checkContext(model) : model;
  const options = { off: rulesOff(config) };
  const sorted = [...files].sort(byPath);
  const findings: Finding[] = [];
  const unreadable: ReviewResult["unreadable"] = [];
  for (const file of sorted) {
    try {
      const { findings: all } = checkFile({ path: file.path, code: file.code }, ctx, options);
      findings.push(...(file.lines ? all.filter((f) => file.lines!.has(f.line)) : all));
    } catch (err) {
      if (!(err instanceof SnippetParseError)) throw err;
      unreadable.push({ path: file.path, reason: "it isn't valid TSX or JSX; check that it compiles" });
    }
  }
  const result: ReviewResult = {
    mode: config.mode,
    scope,
    files: sorted.map((f) => f.path),
    findings,
    ...coverage(ctx, options),
    unreadable,
    failed: config.mode === "error" && findings.length > 0,
  };
  if (scope.kind === "changes") result.changedLines = sorted.reduce((n, f) => n + (f.lines?.size ?? 0), 0);
  return result;
}

// ---------------------------------------------------------------------------
// The readable summary
// ---------------------------------------------------------------------------

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (xs: readonly string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const MAX_INLINE_REPLACEMENT = 120;

function header(r: ReviewResult): string {
  if (r.scope.kind === "all") return r.files.length === 0 ? "There are no TSX or JSX files to check." : `Checked every file: ${plural(r.files.length, "file")}.`;
  const { base } = r.scope;
  if (r.files.length === 0) return `No TSX or JSX files changed since ${base}, so there was nothing to check.`;
  return `Checked ${plural(r.changedLines ?? 0, "changed line")} in ${plural(r.files.length, "file")}, compared with ${base}.`;
}

const atOf = (f: Finding) => `${f.line}:${f.column}`;

/** One finding, with its `line:column` padded to `width` so a file's findings line up. */
function findingLines(f: Finding, width: number): string[] {
  const at = atOf(f).padEnd(width);
  const pad = " ".repeat(width + 4);
  const lines = [`  ${at}  ${f.message}${f.severity === "error" ? " (required)" : ""}`, `${pad}Why: ${f.evidence}.`, `${pad}Fix: ${f.fix.description}`];
  const r = f.fix.replacement;
  if (r && !r.includes("\n") && r.length <= MAX_INLINE_REPLACEMENT) lines.push(`${pad}Replace with: \`${r}\``);
  return lines;
}

function verdict(r: ReviewResult): string {
  if (r.mode === "warn") return "Mode: warn, so this never fails the build.";
  if (r.failed) return "Mode: error, so this fails the build. Change these lines, or turn a rule off in .steward/config.json.";
  return "Mode: error. Nothing was found, so the build passes.";
}

/** Pure: the short, calm report `steward check` prints. Never says the code is "accessible". */
export function formatReview(r: ReviewResult): string {
  const out = [header(r)];
  if (r.files.length > 0) {
    if (r.findings.length === 0) {
      out.push("", `Nothing to change${r.scope.kind === "changes" ? " on the changed lines" : ""}. Checked ${list(r.checked)}.`);
    } else {
      const files = [...new Set(r.findings.map((f) => f.file ?? ""))];
      for (const file of files) {
        const here = r.findings.filter((f) => (f.file ?? "") === file);
        const width = Math.max(...here.map((f) => atOf(f).length));
        out.push("", file, ...here.flatMap((f) => findingLines(f, width)));
      }
      const exact = r.findings.filter((f) => (f.fix.edits?.length ?? 0) > 0).length;
      out.push(
        "",
        `Found ${plural(r.findings.length, "thing")} to change in ${plural(files.length, "file")}` +
          (exact > 0 ? ` (${exact} with an exact fix).` : "."),
      );
    }
  }
  if (r.unreadable.length > 0) {
    out.push("", `Couldn't read ${plural(r.unreadable.length, "file")} as JSX, so ${r.unreadable.length === 1 ? "it wasn't" : "they weren't"} checked:`);
    for (const u of r.unreadable) out.push(`  ${u.path} (${u.reason})`);
  }
  if (r.skipped.length > 0) out.push("", `Not checked, because they're turned off: ${list(r.skipped)}.`);
  out.push("", verdict(r), STATIC_CHECKS_NOTE);
  return `${out.join("\n")}\n`;
}
