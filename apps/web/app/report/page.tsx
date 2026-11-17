import Link from "next/link";
import type { ReactNode } from "react";
import { fixFor, ruleLabel } from "../../lib/fixes";
import { A11Y_LIMIT, DRIFT_LIMIT, health, shownPart as part, MIN_PULL_REQUESTS, PERIODS, periodOf, pullRequestsIn, tiles, topSources, weeklyTrend, type Health, type MainSource } from "../../lib/health";
import { loadRepo } from "../../lib/steward";
import { Button } from "../button";
import { Panel, RepoProblem } from "../ui";
import { TrendChart } from "./trend-chart";

export const dynamic = "force-dynamic";

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600";
const SOURCE_LABELS: Record<MainSource, string> = { "ai-agent": "AI agent", human: "Human", unknown: "Unknown", mixed: "Mixed" };
const pct = (x: number | null) => (x === null ? null : `${Math.round(x * 100)}%`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const day = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" });

const code = (text: string) => <code className="rounded-md bg-gray-100 px-1 font-mono text-sm text-gray-900">{text}</code>;

export default async function ReportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const period = periodOf((await searchParams)["period"]);
  const repo = await loadRepo();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold text-gray-900">System health</h1>
          <p className="text-sm text-gray-700">How consistent your product is, from Steward Review&apos;s checks on your pull requests.</p>
        </div>
        <form method="get" className="flex items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-gray-700">
            Period
            <select name="period" defaultValue={period} className={`rounded-md border border-gray-500 bg-white px-2 py-2 text-sm text-gray-900 ${FOCUS}`}>
              {PERIODS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit">Show</Button>
        </form>
      </header>
      <ReportBody repo={repo} period={period} />
      <p className="text-sm text-gray-700">Steward measures your UI, not your people.</p>
    </div>
  );
}

async function ReportBody({ repo, period }: { repo: Awaited<ReturnType<typeof loadRepo>>; period: ReturnType<typeof periodOf> }) {
  if (repo.kind !== "ready") return <RepoProblem state={repo} />;
  if (repo.historyProblem) return <Message title="Steward couldn't read the check history.">{repo.historyProblem}</Message>;
  if (repo.history.length === 0) {
    return (
      <Message title="No checks recorded yet.">
        <p>
          Each run of {code("steward check")} adds a line to {code(".steward/history.jsonl")}. The Report counts pull requests, so add the Steward Review GitHub Action to check
          each one.
        </p>
      </Message>
    );
  }

  const { pullRequests, localChecks } = pullRequestsIn(repo.history, period, new Date());
  if (pullRequests.length === 0) {
    return (
      <Message title="No pull requests were checked in this period.">
        {localChecks > 0 && (
          <p>
            {plural(localChecks, "local check")} {localChecks === 1 ? "is" : "are"} recorded, but the Report counts pull requests only, so the same changes aren&apos;t counted twice.
          </p>
        )}
        <p>
          Pull request checks run in the Steward Review GitHub Action and are saved as {code("steward-history")} artifacts, one per run. To add a run&apos;s record here, run{" "}
          {code("gh run download <run-id> --pattern 'steward-history-*' --dir .steward/artifacts")}, then{" "}
          {code("find .steward/artifacts -name record.jsonl -exec cat {} + >> .steward/history.jsonl")}.
        </p>
        <p>Or choose a longer period.</p>
      </Message>
    );
  }

  const h = health(pullRequests);
  const trend = weeklyTrend(pullRequests);
  const t = tiles(pullRequests);
  const sources = topSources(pullRequests);

  return (
    <>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <ScoreCard h={h} trend={trend} />
        <section aria-labelledby="trend-title" className="flex flex-col gap-4 rounded-lg border border-gray-200 bg-white p-6">
          <h2 id="trend-title" className="text-sm font-medium text-gray-700">
            Score over time
          </h2>
          {trend.length < 2 ? <p className="text-sm text-gray-700">The trend appears once there are checks in two different weeks.</p> : <TrendChart points={trend} />}
        </section>
      </div>

      <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Tile label="UI built from system components" value={pct(t.builtFromSystem) ?? "No data"} />
        <Tile label="Drift caught before merge" value={t.driftCaught} />
        <Tile
          label="Accessibility problems found"
          value={t.accessibilityFound}
          note="Automated checks catch only some accessibility issues. Test with a keyboard and a screen reader too."
        />
        <Tile label="AI output with no fixes needed" value={pct(t.aiNoFixes) ?? "No AI pull requests"} />
        <Tile label="Fixes accepted" value={t.fixesAccepted} />
      </dl>

      <section aria-labelledby="sources-title" className="flex flex-col gap-4 rounded-lg border border-gray-200 bg-white p-6">
        <h2 id="sources-title" className="text-lg font-semibold text-gray-900">
          Top sources of drift
        </h2>
        {sources.length === 0 ? (
          <p className="text-sm text-gray-700">Nothing found in this period.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 text-gray-700">
              <tr>
                <th scope="col" className="py-2 font-medium">
                  Pattern
                </th>
                <th scope="col" className="py-2 font-medium">
                  Times seen
                </th>
                <th scope="col" className="py-2 font-medium">
                  Main source
                </th>
                <th scope="col" className="py-2 font-medium">
                  Fix
                </th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => {
                const fix = fixFor(s.rule, s.mainSource);
                return (
                  <tr key={s.rule} className="border-b border-gray-200 text-gray-900">
                    <th scope="row" className="py-3 font-normal">
                      {ruleLabel(s.rule)}
                    </th>
                    <td className="py-3">{s.timesSeen}</td>
                    <td className="py-3">{SOURCE_LABELS[s.mainSource]}</td>
                    <td className="py-3">
                      <Link href={fix.href} className={`rounded-md text-gray-900 underline hover:text-gray-700 ${FOCUS}`}>
                        {fix.label}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <p className="text-sm text-gray-700">
        Based on {plural(pullRequests.length, "pull request")} in this period, each counted once by its latest check.
        {localChecks > 0 && ` ${plural(localChecks, "local check")} ${localChecks === 1 ? "isn't" : "aren't"} counted, so the same changes aren't counted twice.`}
      </p>
    </>
  );
}

function Message({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Panel>
      <div className="flex flex-col gap-2 text-sm text-gray-700">
        <p className="font-medium text-gray-900">{title}</p>
        {children}
      </div>
    </Panel>
  );
}

function Tile({ label, value, note }: { label: string; value: ReactNode; note?: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-gray-200 bg-white p-4">
      <dt className="text-sm text-gray-700">{label}</dt>
      <dd className="text-2xl font-semibold text-gray-900">{value}</dd>
      {note && <dd className="text-xs text-gray-700">{note}</dd>}
    </div>
  );
}

function ScoreCard({ h, trend }: { h: Health; trend: readonly { week: string; score: number }[] }) {
  const counted = h.parts.filter((p) => p.value !== null);
  const total = counted.reduce((s, p) => s + p.weight, 0);
  const first = trend[0];
  const last = trend.at(-1);
  const change = first && last && trend.length > 1 ? last.score - first.score : null;

  return (
    <section aria-labelledby="score-title" className="flex flex-col gap-4 rounded-lg border border-gray-900 bg-white p-6">
      <h2 id="score-title" className="text-sm font-medium text-gray-700">
        Health score
      </h2>
      {h.score === null ? (
        <div className="flex flex-col gap-1">
          <p className="text-2xl font-semibold text-gray-900">Not enough data yet</p>
          <p className="text-sm text-gray-700">
            The score needs at least {MIN_PULL_REQUESTS} pull requests; this period has {h.pullRequests}.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <p className="text-gray-900">
            <span className="text-6xl font-semibold">{h.score}</span> <span className="text-base text-gray-700">/ 100</span>
          </p>
          {change !== null && first && last && (
            <p className="text-sm text-gray-700">
              For the whole period. Week by week it went {change === 0 ? "unchanged" : `${change > 0 ? "up" : "down"} ${plural(Math.abs(change), "point")}`}, from {first.score} in the
              week of {day(first.week)} to {last.score}.
            </p>
          )}
        </div>
      )}
      <details className="text-sm text-gray-700">
        <summary className={`cursor-pointer rounded-md font-medium text-gray-900 ${FOCUS}`}>How is this calculated?</summary>
        <div className="mt-3 flex flex-col gap-3">
          <p>A weighted average of four parts, each scored from 0 to 1, using each pull request&apos;s latest check:</p>
          <table className="w-full text-left">
            <thead className="border-b border-gray-200">
              <tr>
                <th scope="col" className="py-1 pr-3 font-medium">
                  Part
                </th>
                <th scope="col" className="py-1 pr-3 font-medium">
                  Weight
                </th>
                <th scope="col" className="py-1 font-medium">
                  This period
                </th>
              </tr>
            </thead>
            <tbody>
              {h.parts.map((p) => (
                <tr key={p.key} className="border-b border-gray-200 align-top">
                  <th scope="row" className="py-2 pr-3 font-normal text-gray-900">
                    {p.label}
                  </th>
                  <td className="py-2 pr-3">{Math.round(p.weight * 100)}%</td>
                  <td className="py-2">
                    {p.measured} {p.rule} {p.value === null ? <strong className="text-gray-900">Not counted: no data.</strong> : <strong className="text-gray-900">Scores {part(p.value)}.</strong>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {h.score !== null && (
            <p>
              Score = 100 × ({counted.map((p) => `${p.weight} × ${part(p.value!)}`).join(" + ")}){total < 1 ? ` ÷ ${Math.round(total * 100) / 100}` : ""} ={" "}
              <strong className="text-gray-900">{h.score}</strong>.
              {total < 1 && " Parts with no data are left out, and the other weights scaled up to fill their place."}
            </p>
          )}
          <p>
            Drift is off-system colors, spacing and components; {DRIFT_LIMIT} or more per pull request scores 0. Accessibility counts Review&apos;s accessibility checks;{" "}
            {A11Y_LIMIT} or more per pull request scores 0. Flags marked intentional and colors suggested as new tokens don&apos;t count against the score.
          </p>
        </div>
      </details>
    </section>
  );
}
