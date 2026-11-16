import { compareStrings } from "@steward/model";
import { EVAL_CHECKS, emptyByCheck, type RunResult } from "./score.js";

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function table(head: string[], rows: string[][]): string {
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const line = (cells: string[]) => cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]!) : c.padStart(widths[i]!))).join("  ");
  return [line(head), line(widths.map((w) => "-".repeat(w))), ...rows.map(line)].join("\n");
}

/** Pure: the comparison table for every saved run. Deterministic for the same results. */
export function summarize(results: readonly RunResult[]): string {
  if (results.length === 0) return "No runs saved yet. Score a run with `pnpm eval:score <copy> --label <prompt>-<n>`.\n";

  const conditions = [...new Set(results.map((r) => r.condition))].sort(compareStrings);
  const prompts = [...new Set(results.map((r) => r.prompt))].sort(compareStrings);

  const overall = conditions.map((c) => {
    const runs = results.filter((r) => r.condition === c);
    const lines = runs.reduce((n, r) => n + r.totals.addedLines, 0);
    const problems = runs.reduce((n, r) => n + r.totals.problems, 0);
    const byCheck = emptyByCheck();
    for (const r of runs) for (const k of EVAL_CHECKS) byCheck[k.id] += r.totals.byCheck[k.id] ?? 0;
    const parse = runs.reduce((n, r) => n + r.totals.parseErrors, 0);
    return [
      c,
      String(runs.length),
      String(lines),
      String(problems),
      lines === 0 ? "–" : fmt((problems / lines) * 100),
      ...EVAL_CHECKS.map((k) => String(byCheck[k.id])),
      String(parse),
    ];
  });

  const perPrompt = prompts.map((p) => [
    p,
    ...conditions.map((c) => {
      const runs = results.filter((r) => r.condition === c && r.prompt === p);
      if (runs.length === 0) return "–";
      const mean = runs.reduce((n, r) => n + r.totals.problems, 0) / runs.length;
      return `${fmt(mean)} (${runs.length} run${runs.length === 1 ? "" : "s"})`;
    }),
  ]);

  const minRuns = Math.min(...conditions.flatMap((c) => prompts.map((p) => results.filter((r) => r.condition === c && r.prompt === p).length)));

  return [
    `Scored ${results.length} run${results.length === 1 ? "" : "s"} across ${conditions.length} condition${conditions.length === 1 ? "" : "s"}. Only lines the AI tool added are counted.`,
    "",
    table(["Condition", "Runs", "Lines added", "Problems", "Per 100 lines", ...EVAL_CHECKS.map((k) => k.short), "Unreadable files"], overall),
    "",
    "Average problems per run, by prompt:",
    "",
    table(["Prompt", ...conditions], perPrompt),
    "",
    minRuns < 3
      ? "Some prompts have fewer than 3 runs in a condition, so differences there are mostly noise."
      : "With a few runs per prompt, treat small differences as noise and look for consistent gaps.",
    "These are static checks. They catch some problems, not all, and they don't measure whether the UI works.",
    "",
  ].join("\n");
}
