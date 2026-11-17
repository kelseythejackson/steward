/**
 * Steward Review over many files: what `steward check` runs, and later the
 * pull request action. Pure: the caller reads git and the files, this
 * decides what to report and whether the build fails.
 */
import type { ReviewMode, StewardConfig, SystemModel } from "@steward/model";
import { STATIC_CHECKS_NOTE } from "./check.js";
import { checkContext, type CheckContext } from "./context.js";
import { checkFile, coverage } from "./engine.js";
import type { Finding, IgnoredFinding, Note, RuleId } from "./findings.js";
import { SnippetParseError } from "./parse.js";
import { PATTERN_MIN_USES, splitPatterns, type ColorUses } from "./patterns.js";
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
  /** Flags: off-system values and accessibility problems. Sorted by file, then line, column and rule. */
  findings: Finding[];
  /** Colors used in 3+ places across the repo: suggested as tokens instead of flagged. Never fail the build. */
  tokenSuggestions: Finding[];
  /** Flags marked intentional with a `steward-ignore` comment. Healthy, not drift. */
  exceptions: IgnoredFinding[];
  /** Problems with `steward-ignore` comments (no reason, unknown rule, nothing to ignore). */
  notes: Note[];
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

/** Files Review reads: TSX and JSX, but not stories and tests (kept out of the system, as in Setup) or build output. */
export const isReviewable = (path: string) =>
  /\.(?:tsx|jsx)$/.test(path) &&
  !/\.(?:stories|story|test|spec)\.[jt]sx$/.test(path) &&
  !/(?:^|\/)(?:__tests__|__stories__|\.storybook|node_modules|dist|build|\.next|\.steward)\//.test(path);

const byPath = (a: { path: string }, b: { path: string }) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

export interface ReviewOptions {
  /**
   * How often each off-system color is used across the whole repo (see
   * `countColorUses`). Without it, no colors are suggested as tokens.
   */
  colorUses?: ColorUses;
}

/**
 * Pure: runs Review on each file and keeps what's on the given lines. A
 * rule runs only when the config leaves it on and its system rule is
 * enabled. Unknown rule ids should be caught first with `unknownRules`.
 */
export function reviewFiles(files: readonly SourceFile[], model: SystemModel | CheckContext, config: StewardConfig, scope: ReviewScope, reviewOptions: ReviewOptions = {}): ReviewResult {
  const ctx = "tokens" in model ? checkContext(model) : model;
  const options = { off: rulesOff(config) };
  const sorted = [...files].sort(byPath);
  const all: Finding[] = [];
  const exceptions: IgnoredFinding[] = [];
  const notes: Note[] = [];
  const unreadable: ReviewResult["unreadable"] = [];
  for (const file of sorted) {
    try {
      const r = checkFile({ path: file.path, code: file.code }, ctx, options);
      const on = (...lines: number[]) => !file.lines || lines.some((n) => file.lines!.has(n));
      all.push(...r.findings.filter((f) => on(f.line)));
      exceptions.push(...r.ignored.filter((i) => on(i.finding.line, i.commentLine)));
      notes.push(...r.notes.filter((n) => on(n.line, n.covers)));
    } catch (err) {
      if (!(err instanceof SnippetParseError)) throw err;
      unreadable.push({ path: file.path, reason: "it isn't valid TSX or JSX; check that it compiles" });
    }
  }
  const { flags: findings, suggestions: tokenSuggestions } = splitPatterns(all, reviewOptions.colorUses ?? new Map(), ctx.tokenSuggestions);
  const result: ReviewResult = {
    mode: config.mode,
    scope,
    files: sorted.map((f) => f.path),
    findings,
    tokenSuggestions,
    exceptions,
    notes,
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
const PATTERN_LABEL = `${PATTERN_MIN_USES} or more`;

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

/** Findings grouped under their file, with `line:column` lined up per file. */
function byFile(findings: readonly Finding[]): string[] {
  const out: string[] = [];
  for (const file of [...new Set(findings.map((f) => f.file ?? ""))]) {
    const here = findings.filter((f) => (f.file ?? "") === file);
    const width = Math.max(...here.map((f) => atOf(f).length));
    out.push("", file, ...here.flatMap((f) => findingLines(f, width)));
  }
  return out;
}

/** Pure: the short, calm report `steward check` prints. Never says the code is "accessible". */
export function formatReview(r: ReviewResult): string {
  const out = [header(r)];
  if (r.files.length > 0) {
    if (r.findings.length === 0) {
      out.push("", `Nothing to change${r.scope.kind === "changes" ? " on the changed lines" : ""}. Checked ${list(r.checked)}.`);
    } else {
      const files = [...new Set(r.findings.map((f) => f.file ?? ""))];
      out.push(...byFile(r.findings));
      const exact = r.findings.filter((f) => (f.fix.edits?.length ?? 0) > 0).length;
      out.push(
        "",
        `Found ${plural(r.findings.length, "thing")} to change in ${plural(files.length, "file")}` +
          (exact > 0 ? ` (${exact} with an exact fix).` : "."),
      );
    }
  }
  if (r.tokenSuggestions.length > 0) {
    const colors = new Set(r.tokenSuggestions.map((f) => f.pattern?.value));
    out.push("", `Could join your system: ${plural(colors.size, "color")} used in ${PATTERN_LABEL} places, so ${colors.size === 1 ? "it's suggested as a token" : "they're suggested as tokens"} instead of flagged:`);
    out.push(...byFile(r.tokenSuggestions).slice(1));
  }
  if (r.exceptions.length > 0) {
    out.push("", `Marked intentional with steward-ignore (${plural(r.exceptions.length, "flag")}):`);
    for (const e of r.exceptions) out.push(`  ${e.finding.file ?? ""}:${e.finding.line}  ${e.finding.rule}: ${e.reason}`);
  }
  if (r.notes.length > 0) {
    out.push("", `About ${r.notes.length === 1 ? "a steward-ignore comment" : "some steward-ignore comments"}:`);
    for (const n of r.notes) out.push(`  ${n.file ?? ""}:${n.line}  ${n.message}`);
  }
  if (r.unreadable.length > 0) {
    out.push("", `Couldn't read ${plural(r.unreadable.length, "file")} as JSX, so ${r.unreadable.length === 1 ? "it wasn't" : "they weren't"} checked:`);
    for (const u of r.unreadable) out.push(`  ${u.path} (${u.reason})`);
  }
  if (r.skipped.length > 0) out.push("", `Not checked, because they're turned off: ${list(r.skipped)}.`);
  out.push("", verdict(r), STATIC_CHECKS_NOTE);
  return `${out.join("\n")}\n`;
}
