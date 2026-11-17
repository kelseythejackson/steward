/**
 * The Report's numbers, from the check history. Pure.
 *
 * Product, not people: everything is counted per pull request or in total,
 * and grouped only by rule or source type. Nothing here knows who wrote
 * anything, and PR numbers are used only to count each pull request once.
 */
import type { HistoryRecord, SourceType } from "@steward/model";

export type Period = "30d" | "90d" | "all";
export const PERIODS: readonly { value: Period; label: string; days: number | null }[] = [
  { value: "30d", label: "Last 30 days", days: 30 },
  { value: "90d", label: "Last 90 days", days: 90 },
  { value: "all", label: "All time", days: null },
];
export const periodOf = (v: unknown): Period => (PERIODS.some((p) => p.value === v) ? (v as Period) : "30d");

/** Rules that count as drift: off-system values. The rest (a11y-*) are accessibility. */
export const DRIFT_RULES: readonly string[] = ["no-hardcoded-color", "no-arbitrary-spacing", "use-system-component"];
const isA11y = (rule: string) => rule.startsWith("a11y-");

/** The formula. Shown on the page, so keep these the only source of the numbers. */
export const WEIGHTS = { components: 0.3, drift: 0.3, accessibility: 0.25, ai: 0.15 } as const;
/** Drift per pull request at which that part scores nothing. */
export const DRIFT_LIMIT = 10;
/** Accessibility problems per pull request at which that part scores nothing. */
export const A11Y_LIMIT = 5;
/** The score needs this many pull requests to mean anything. */
export const MIN_PULL_REQUESTS = 3;

export const driftOf = (r: HistoryRecord) => DRIFT_RULES.reduce((n, rule) => n + (r.problems[rule] ?? 0), 0);
export const a11yOf = (r: HistoryRecord) => Object.entries(r.problems).reduce((n, [rule, c]) => n + (isA11y(rule) ? c : 0), 0);

/** One pull request: its first check (what arrived) and its latest (after fixes during review). */
export interface PullRequest {
  first: HistoryRecord;
  latest: HistoryRecord;
}

/**
 * Pure: pull requests whose latest check falls in the period, each once.
 * Local checks (no PR) are left out, so changes aren't counted twice;
 * `localChecks` says how many.
 */
export function pullRequestsIn(history: readonly HistoryRecord[], period: Period, now: Date): { pullRequests: PullRequest[]; localChecks: number } {
  const days = PERIODS.find((p) => p.value === period)!.days;
  const from = days === null ? -Infinity : now.getTime() - days * 86_400_000;
  const inPeriod = (r: HistoryRecord) => Date.parse(r.date) >= from && Date.parse(r.date) <= now.getTime();
  const byPr = new Map<number, HistoryRecord[]>();
  let localChecks = 0;
  for (const r of history) {
    if (r.pr === null) {
      if (inPeriod(r)) localChecks++;
      continue;
    }
    byPr.set(r.pr, [...(byPr.get(r.pr) ?? []), r]);
  }
  const pullRequests: PullRequest[] = [];
  for (const records of byPr.values()) {
    const sorted = [...records].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
    const pr = { first: sorted[0]!, latest: sorted.at(-1)! };
    if (inPeriod(pr.latest)) pullRequests.push(pr);
  }
  return { pullRequests: pullRequests.sort((a, b) => Date.parse(a.latest.date) - Date.parse(b.latest.date)), localChecks };
}

export interface ScorePart {
  key: keyof typeof WEIGHTS;
  label: string;
  weight: number;
  /** 0–1, or null when there's no data for it (then it's left out and the other weights scale up). */
  value: number | null;
  /** The measurement in plain English, with this repo's numbers. */
  measured: string;
  /** How the measurement becomes 0–1. */
  rule: string;
}

export interface Health {
  /** 0–100, or null with too few pull requests. */
  score: number | null;
  parts: ScorePart[];
  pullRequests: number;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const one = (x: number) => (Math.round(x * 10) / 10).toString();
const plural = (n: number, one_: string, many = `${one_}s`) => `${n} ${n === 1 ? one_ : many}`;

/** Pure: the parts of the score and the score itself. */
export function health(prs: readonly PullRequest[], minPullRequests = MIN_PULL_REQUESTS): Health {
  const n = prs.length;
  const system = prs.reduce((s, p) => s + p.latest.components.system, 0);
  const total = prs.reduce((s, p) => s + p.latest.components.total, 0);
  const drift = n === 0 ? 0 : prs.reduce((s, p) => s + driftOf(p.latest), 0) / n;
  const a11y = n === 0 ? 0 : prs.reduce((s, p) => s + a11yOf(p.latest), 0) / n;
  const ai = prs.filter((p) => p.latest.source === "ai-agent");
  const aiClean = ai.filter((p) => driftOf(p.first) + a11yOf(p.first) === 0).length;

  const parts: ScorePart[] = [
    {
      key: "components",
      label: "Built from the system",
      weight: WEIGHTS.components,
      value: total === 0 ? null : system / total,
      measured: total === 0 ? "No elements with a system version were checked." : `${system} of ${total} elements with a system version use it.`,
      rule: "Used as it is.",
    },
    {
      key: "drift",
      label: "Drift per pull request",
      weight: WEIGHTS.drift,
      value: n === 0 ? null : Math.max(0, 1 - drift / DRIFT_LIMIT),
      measured: `${one(drift)} off-system colors, spacing values or components per pull request.`,
      rule: `0 scores full marks; ${DRIFT_LIMIT} or more scores none.`,
    },
    {
      key: "accessibility",
      label: "Accessibility per pull request",
      weight: WEIGHTS.accessibility,
      value: n === 0 ? null : Math.max(0, 1 - a11y / A11Y_LIMIT),
      measured: `${one(a11y)} accessibility problems per pull request.`,
      rule: `0 scores full marks; ${A11Y_LIMIT} or more scores none.`,
    },
    {
      key: "ai",
      label: "Clean AI output",
      weight: WEIGHTS.ai,
      value: ai.length === 0 ? null : aiClean / ai.length,
      measured: ai.length === 0 ? "No pull requests were labeled as written by an AI agent." : `${aiClean} of ${plural(ai.length, "AI-written pull request")} needed no fixes.`,
      rule: "Used as it is.",
    },
  ];

  const counted = parts.filter((p) => p.value !== null);
  const weight = counted.reduce((s, p) => s + p.weight, 0);
  const score = n < minPullRequests || weight === 0 ? null : Math.round((100 * counted.reduce((s, p) => s + p.weight * p.value!, 0)) / weight);
  return { score, parts, pullRequests: n };
}

/** Monday of the ISO week, `YYYY-MM-DD`, in UTC. */
export function weekOf(iso: string): string {
  const d = new Date(iso);
  const day = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)).toISOString().slice(0, 10);
}

/** Pure: the score for each week's pull requests (by their latest check), oldest first. */
export function weeklyTrend(prs: readonly PullRequest[]): { week: string; score: number; pullRequests: number }[] {
  const weeks = new Map<string, PullRequest[]>();
  for (const p of prs) {
    const w = weekOf(p.latest.date);
    weeks.set(w, [...(weeks.get(w) ?? []), p]);
  }
  return [...weeks]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([week, list]) => ({ week, score: health(list, 1).score, pullRequests: list.length }))
    .filter((w): w is { week: string; score: number; pullRequests: number } => w.score !== null);
}

export interface Tiles {
  /** Share of elements with a system version that use it, or null. */
  builtFromSystem: number | null;
  /** Off-system values found on each pull request's first check. */
  driftCaught: number;
  /** Accessibility problems found on each pull request's first check. */
  accessibilityFound: number;
  /** Share of AI-written pull requests with nothing to fix on their first check, or null. */
  aiNoFixes: number | null;
  /** Steward's one-click suggestions committed. */
  fixesAccepted: number;
}

export function tiles(prs: readonly PullRequest[]): Tiles {
  const h = health(prs, 1);
  return {
    builtFromSystem: h.parts.find((p) => p.key === "components")!.value,
    driftCaught: prs.reduce((s, p) => s + driftOf(p.first), 0),
    accessibilityFound: prs.reduce((s, p) => s + a11yOf(p.first), 0),
    aiNoFixes: h.parts.find((p) => p.key === "ai")!.value,
    fixesAccepted: prs.reduce((s, p) => s + (p.latest.fixesAccepted ?? 0), 0),
  };
}

export type MainSource = SourceType | "mixed";

export interface DriftSource {
  rule: string;
  timesSeen: number;
  /** The source type behind most of it, or "mixed" when none is behind 60% or more. */
  mainSource: MainSource;
}

/** Pure: what Review found most (on each pull request's first check), by rule, with the source type behind it. Never by person. */
export function topSources(prs: readonly PullRequest[], limit = 5): DriftSource[] {
  const byRule = new Map<string, Map<SourceType, number>>();
  for (const p of prs) {
    for (const [rule, count] of Object.entries(p.first.problems)) {
      if (count === 0) continue;
      const sources = byRule.get(rule) ?? new Map<SourceType, number>();
      sources.set(p.latest.source, (sources.get(p.latest.source) ?? 0) + count);
      byRule.set(rule, sources);
    }
  }
  return [...byRule]
    .map(([rule, sources]) => {
      const timesSeen = [...sources.values()].reduce((a, b) => a + b, 0);
      const [top, topCount] = [...sources].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]!;
      return { rule, timesSeen, mainSource: topCount / timesSeen >= 0.6 ? top : ("mixed" as const) };
    })
    .sort((a, b) => b.timesSeen - a.timesSeen || (a.rule < b.rule ? -1 : 1))
    .slice(0, limit);
}

/** A part's value as the page shows it: up to three decimals, no trailing zeros (0.875, 0.8). Precise enough that the shown sum gives the score. */
export const shownPart = (v: number) => Number(v.toFixed(3)).toString();

export { pct };
