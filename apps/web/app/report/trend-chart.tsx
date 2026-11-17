import { useId } from "react";
import { MIN_PULL_REQUESTS, steadyChange, type TrendPoint } from "../../lib/health";

/** Plot height in px. The plot stretches sideways; its height and all text stay the same size at any width. */
const H = 160;
const TOP = 12;
const BOTTOM = 148;
const y = (score: number) => BOTTOM - (score / 100) * (BOTTOM - TOP);
const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * The health score by week, as a line. Labels are HTML, not SVG text, so
 * they keep their size on narrow screens; only the line and gridlines
 * stretch (at a constant stroke width), and the points are HTML dots so
 * they never squash. Screen readers get a summary and the weekly numbers.
 */
export function TrendChart({ points }: { points: readonly TrendPoint[] }) {
  const titleId = useId();
  const first = points[0]!;
  const last = points.at(-1)!;
  /** Across the plot, in percent, with a little room at each end for the dots. */
  const x = (i: number) => (points.length === 1 ? 50 : 3 + (i * 94) / (points.length - 1));
  const steady = steadyChange(points);
  const thin = points.filter((p) => p.thin).length;
  const summary = steady
    ? `From ${steady.first.score} in the week of ${day(steady.first.week)} to ${steady.last.score} in the week of ${day(steady.last.week)}, over ${points.length} weeks.`
    : `${points.length} weeks, from ${day(first.week)} to ${day(last.week)}. Too few pull requests in most weeks to compare them yet.`;
  const thinNote =
    thin === 0 ? null : `Hollow dots: ${thin === 1 ? "a week" : `${thin} weeks`} with fewer than ${MIN_PULL_REQUESTS} pull requests, where one pull request can move the score a lot.`;

  return (
    <figure className="flex flex-col gap-2">
      <div className="flex gap-2">
        <div aria-hidden="true" className="relative h-[160px] w-[32px] shrink-0 text-xs text-gray-700">
          {[100, 50, 0].map((v) => (
            <span key={v} className="absolute right-0 -translate-y-1/2" style={{ top: y(v) }}>
              {v}
            </span>
          ))}
        </div>
        <div role="img" aria-labelledby={titleId} className="relative h-[160px] min-w-0 flex-1">
          <span id={titleId} className="sr-only">{`Health score by week. ${summary}`}</span>
          <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" aria-hidden="true" className="absolute inset-0 h-full w-full">
            {[0, 50, 100].map((v) => (
              <line key={v} x1={0} x2={100} y1={y(v)} y2={y(v)} className="stroke-gray-200" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            ))}
            <polyline points={points.map((p, i) => `${x(i)},${y(p.score)}`).join(" ")} className="fill-none stroke-gray-900" strokeWidth={2} vectorEffect="non-scaling-stroke" />
          </svg>
          {points.map((p, i) => (
            <span
              key={p.week}
              aria-hidden="true"
              className={`absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-gray-900 ${p.thin ? "bg-white" : "bg-gray-900"}`}
              style={{ left: `${x(i)}%`, top: y(p.score) }}
            />
          ))}
        </div>
      </div>
      <div aria-hidden="true" className="flex gap-2 text-xs text-gray-700">
        <span className="w-[32px] shrink-0" />
        <div className={`flex flex-1 ${points.length === 1 ? "justify-center" : "justify-between"}`}>
          <span>{day(first.week)}</span>
          {points.length > 1 && <span>{day(last.week)}</span>}
        </div>
      </div>
      <figcaption className="flex flex-col gap-1 text-sm text-gray-700">
        <span>{summary}</span>
        {thinNote && <span>{thinNote}</span>}
      </figcaption>
      <table className="sr-only">
        <caption>Health score by week</caption>
        <thead>
          <tr>
            <th scope="col">Week of</th>
            <th scope="col">Score</th>
            <th scope="col">Pull requests</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.week}>
              <td>{day(p.week)}</td>
              <td>{p.score}</td>
              <td>{p.thin ? `${p.pullRequests} (few)` : p.pullRequests}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
