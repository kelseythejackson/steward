/**
 * `.steward/history.jsonl`: one line per `steward check` run, appended and
 * never rewritten. It feeds the Report dashboard.
 *
 * Product, not people: a record holds counts about the UI and the *source
 * type* of the code (`ai-agent`, `human` or `unknown`), never a name,
 * email, username or anything counted per person. Records are built from
 * a fixed list of fields, so nothing else can slip in. Report shows totals
 * over time and by source type only, never a per-PR or per-author view.
 */
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export const HISTORY_FILE = "history.jsonl";
export const HISTORY_VERSION = 1;

/** Where the changed code came from, judged from PR labels or a known AI bot account only. */
export type SourceType = "ai-agent" | "human" | "unknown";

export interface HistoryRecord {
  v: typeof HISTORY_VERSION;
  /** When the check ran, ISO 8601. */
  date: string;
  /** `changes`: lines changed since the base branch; `all`: every file. */
  scope: "changes" | "all";
  /** The pull request, so several pushes to one PR count once. Null outside a PR. */
  pr: number | null;
  source: SourceType;
  /** Files checked. */
  files: number;
  /** Changed lines checked; null when every file was checked. */
  changedLines: number | null;
  /** Problems by Review rule id, accessibility rules included. Every rule is listed, with 0 when it found nothing. */
  problems: Record<string, number>;
  /** Colors suggested as tokens instead of flagged. */
  tokenSuggestions: number;
  /** Flags marked intentional with steward-ignore. */
  exceptions: number;
  /** Steward's one-click suggestions on this PR now committed. Null outside a PR. */
  fixesAccepted: number | null;
  /** Elements on the checked lines that use a system component, out of those the system has a component for. */
  components: { system: number; total: number; share: number | null };
}

/** Every field a record may have, in the order they're written. Anything else is refused. */
export const HISTORY_FIELDS = [
  "v",
  "date",
  "scope",
  "pr",
  "source",
  "files",
  "changedLines",
  "problems",
  "tokenSuggestions",
  "exceptions",
  "fixesAccepted",
  "components",
] as const satisfies readonly (keyof HistoryRecord)[];

/**
 * Every Review rule id a record's `problems` may name. Anything else is refused, so a key can never
 * carry a name or a per-person count (`"jane-doe": 3`). Kept in step with Review's rules by a test in
 * packages/guard. Add new ids here; never remove one, or older history would stop being readable.
 */
export const HISTORY_RULE_IDS: readonly string[] = [
  "a11y-accessible-name",
  "a11y-focus-visible",
  "a11y-img-alt",
  "a11y-interactive-element",
  "a11y-label-inputs",
  "a11y-text-contrast",
  "no-arbitrary-spacing",
  "no-hardcoded-color",
  "use-system-component",
];
const RULE_IDS = new Set(HISTORY_RULE_IDS);

/** A UTC timestamp exactly as `Date.toISOString()` writes it: nothing else can ride along in a date. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

const COMPONENT_FIELDS = ["system", "total", "share"] as const;
const SOURCES = new Set<SourceType>(["ai-agent", "human", "unknown"]);

export class HistoryError extends Error {
  override name = "HistoryError";
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const isCount = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

/**
 * Pure: checks a record against the allowed fields and types. Throws
 * `HistoryError` for any field not on the list (an `author`, say) or a
 * value of the wrong kind. `date` must be an ISO 8601 UTC time and `problems`
 * keys must be Review's rule ids, so neither can carry a name.
 */
export function checkHistoryRecord(value: unknown): HistoryRecord {
  const fail = (problem: string): never => {
    throw new HistoryError(`A history record ${problem}.`);
  };
  if (!isRecord(value)) return fail("should be an object");
  const extra = Object.keys(value).filter((k) => !(HISTORY_FIELDS as readonly string[]).includes(k));
  // Unknown keys aren't repeated in the message (it's shown on the Report page): one could be a name.
  if (extra.length > 0) fail(`has ${extra.length === 1 ? "a field" : `${extra.length} fields`} history doesn't keep`);
  for (const k of HISTORY_FIELDS) if (!(k in value)) fail(`is missing "${k}"`);

  if (value["v"] !== HISTORY_VERSION) fail(`has version ${JSON.stringify(value["v"])}`);
  if (typeof value["date"] !== "string" || !ISO_DATE.test(value["date"]) || Number.isNaN(Date.parse(value["date"]))) {
    fail('has a "date" that isn\'t an ISO 8601 UTC time like 2026-11-17T20:36:54.035Z');
  }
  if (value["scope"] !== "changes" && value["scope"] !== "all") fail('has a "scope" other than "changes" or "all"');
  if (value["pr"] !== null && !(isCount(value["pr"]) && value["pr"] > 0)) fail('has a "pr" that isn\'t a pull request number');
  if (!SOURCES.has(value["source"] as SourceType)) fail('has a "source" other than "ai-agent", "human" or "unknown"');
  for (const k of ["files", "tokenSuggestions", "exceptions"]) if (!isCount(value[k])) fail(`has a "${k}" that isn't a count`);
  for (const k of ["changedLines", "fixesAccepted"]) if (value[k] !== null && !isCount(value[k])) fail(`has a "${k}" that isn't a count`);

  const problems = value["problems"];
  if (!isRecord(problems)) return fail('has "problems" that aren\'t counts by rule');
  for (const [k, n] of Object.entries(problems)) {
    // The key is echoed only if it's a known rule id: an unknown key might be a name, and errors are shown.
    if (!RULE_IDS.has(k)) fail('has a "problems" key that isn\'t one of Review\'s rule ids');
    if (!isCount(n)) fail(`has "problems.${k}" that isn't a count`);
  }
  const c = value["components"];
  if (!isRecord(c)) return fail('has "components" that aren\'t { system, total, share }');
  const extraC = Object.keys(c).filter((k) => !(COMPONENT_FIELDS as readonly string[]).includes(k));
  if (extraC.length > 0) fail('has a "components" field history doesn\'t keep');
  if (!isCount(c["system"]) || !isCount(c["total"]) || c["system"] > c["total"]) fail('has "components" counts that don\'t add up');
  if (c["share"] !== null && (typeof c["share"] !== "number" || c["share"] < 0 || c["share"] > 1)) fail('has a "components.share" outside 0–1');
  return value as unknown as HistoryRecord;
}

/** Pure: one line of JSON (no newline), fields in a fixed order, problems sorted. Checks the record first. */
export function serializeHistoryRecord(record: HistoryRecord): string {
  checkHistoryRecord(record);
  const problems = Object.fromEntries(Object.entries(record.problems).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const ordered: Record<string, unknown> = {};
  for (const k of HISTORY_FIELDS) ordered[k] = k === "problems" ? problems : k === "components" ? { system: record.components.system, total: record.components.total, share: record.components.share } : record[k];
  return JSON.stringify(ordered);
}

/** Pure: reads history.jsonl text. Blank lines are skipped; a bad line throws with its line number. */
export function parseHistory(text: string): HistoryRecord[] {
  const out: HistoryRecord[] = [];
  text.split("\n").forEach((line, i) => {
    if (line.trim() === "") return;
    try {
      out.push(checkHistoryRecord(JSON.parse(line)));
    } catch (err) {
      throw new HistoryError(`.steward/${HISTORY_FILE} line ${i + 1}: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
  return out;
}

export function historyPath(repoRoot: string): string {
  return join(repoRoot, ".steward", HISTORY_FILE);
}

/** Appends one record to `.steward/history.jsonl`, creating it if needed. Never rewrites what's there. Returns the path. */
export async function appendHistory(repoRoot: string, record: HistoryRecord): Promise<string> {
  await mkdir(join(repoRoot, ".steward"), { recursive: true });
  const path = historyPath(repoRoot);
  // If the last line has no newline (a hand edit, or a crash mid-write), start a fresh line so the records don't run together.
  let start = "";
  try {
    const existing = await readFile(path, "utf8");
    if (existing.length > 0 && !existing.endsWith("\n")) start = "\n";
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  await appendFile(path, `${start}${serializeHistoryRecord(record)}\n`, "utf8");
  return path;
}

/** A line of history.jsonl that couldn't be read, and why. */
export interface HistoryProblem {
  line: number;
  message: string;
}

/**
 * Pure: reads history.jsonl text, keeping every valid record and listing
 * the lines that aren't (a damaged write, a hand edit, git conflict
 * markers). One bad line never hides the rest.
 */
export function parseHistoryLines(text: string): { records: HistoryRecord[]; problems: HistoryProblem[] } {
  const records: HistoryRecord[] = [];
  const problems: HistoryProblem[] = [];
  text.split("\n").forEach((line, i) => {
    if (line.trim() === "") return;
    try {
      records.push(checkHistoryRecord(JSON.parse(line)));
    } catch (err) {
      problems.push({ line: i + 1, message: err instanceof SyntaxError ? "isn't valid JSON" : err instanceof Error ? err.message : String(err) });
    }
  });
  return { records, problems };
}

/** Reads `.steward/history.jsonl`, with any lines that couldn't be read. Empty when there isn't one yet. */
export async function readHistoryLines(repoRoot: string): Promise<{ records: HistoryRecord[]; problems: HistoryProblem[] }> {
  try {
    return parseHistoryLines(await readFile(historyPath(repoRoot), "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { records: [], problems: [] };
    throw err;
  }
}

/** Reads `.steward/history.jsonl`'s valid records, skipping lines that can't be read; empty when there isn't one yet. */
export async function readHistory(repoRoot: string): Promise<HistoryRecord[]> {
  return (await readHistoryLines(repoRoot)).records;
}
