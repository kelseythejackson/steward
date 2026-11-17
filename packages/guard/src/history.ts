/**
 * The history record for one Review run, built from the result. Pure: the
 * CLI appends it to `.steward/history.jsonl`.
 *
 * Product, not people. The only thing known about who wrote the code is
 * its source type, worked out here from PR labels or a known AI bot
 * account. The account itself is used for that and dropped; it never
 * reaches the record.
 */
import { DEFAULT_SOURCE_HINTS, HISTORY_VERSION, type HistoryRecord, type SourceHints, type SourceType, type SystemModel } from "@steward/model";
import { checkContext, type CheckContext } from "./context.js";
import { checkFile } from "./engine.js";
import { parseFile, SnippetParseError } from "./parse.js";
import type { ReviewResult, SourceFile } from "./review.js";
import { RULES } from "./rules/index.js";

/** What a pull request says about where its code came from. Read, classified, then dropped. */
export interface SourceSignals {
  labels: readonly string[];
  /** The PR's author account, only to see whether it's a known AI bot. */
  author?: string;
}

/**
 * Pure: `ai-agent` or `human` from a label, or `ai-agent` when the PR was
 * opened by a known AI bot account. Anything else is `unknown`: a person's
 * account is never assumed to mean `human`. Conflicting labels are `unknown`.
 */
export function sourceType(signals: SourceSignals, hints: Partial<SourceHints> = {}): SourceType {
  const h = { ...DEFAULT_SOURCE_HINTS, ...hints };
  const labels = new Set(signals.labels.map((l) => l.trim().toLowerCase()));
  const ai = h.aiLabels.some((l) => labels.has(l.toLowerCase()));
  const human = h.humanLabels.some((l) => labels.has(l.toLowerCase()));
  if (ai && human) return "unknown";
  if (ai) return "ai-agent";
  if (human) return "human";
  if (signals.author && h.aiBots.some((b) => b.toLowerCase() === signals.author!.toLowerCase())) return "ai-agent";
  return "unknown";
}

/**
 * Pure: on the checked lines, how many elements use a system component,
 * out of those the system has a component for: system uses, plus raw
 * elements and merged-away duplicates that Review would swap for one
 * (marked intentional or not). Plain divs and spans don't count.
 */
export function componentUse(files: readonly SourceFile[], model: SystemModel | CheckContext): { system: number; total: number } {
  const ctx = "tokens" in model ? checkContext(model) : model;
  let system = 0;
  let other = 0;
  for (const file of files) {
    const on = (line: number) => !file.lines || file.lines.has(line);
    try {
      const parsed = parseFile({ path: file.path, code: file.code });
      system += parsed.elements.filter((e) => on(e.line) && ctx.componentNames.has(e.name) && !ctx.replaced.has(e.name)).length;
      const r = checkFile(parsed, ctx, { rules: ["use-system-component"] });
      other += [...r.findings, ...r.ignored.map((i) => i.finding)].filter((f) => on(f.line)).length;
    } catch (err) {
      if (!(err instanceof SnippetParseError)) throw err;
    }
  }
  return { system, total: system + other };
}

export interface HistoryInputs {
  /** ISO 8601. */
  date: string;
  pr: number | null;
  source: SourceType;
  fixesAccepted: number | null;
  components: { system: number; total: number };
}

/** Pure: the history record for a Review run. Only counts and the source type; every rule is listed. */
export function historyRecord(result: ReviewResult, inputs: HistoryInputs): HistoryRecord {
  const problems: Record<string, number> = {};
  for (const { id } of RULES) problems[id] = result.findings.filter((f) => f.rule === id).length;
  const { system, total } = inputs.components;
  return {
    v: HISTORY_VERSION,
    date: inputs.date,
    scope: result.scope.kind,
    pr: inputs.pr,
    source: inputs.source,
    files: result.files.length,
    changedLines: result.changedLines ?? null,
    problems,
    tokenSuggestions: result.tokenSuggestions.length,
    exceptions: result.exceptions.length,
    fixesAccepted: inputs.fixesAccepted,
    components: { system, total, share: total === 0 ? null : Number((system / total).toFixed(3)) },
  };
}
