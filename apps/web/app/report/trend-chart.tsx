import { useId } from "react";

const W = 600;
const H = 160;
const TOP = 16;
const BOTTOM = 136;
const y = (score: number) => BOTTOM - (score / 100) * (BOTTOM - TOP);
const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" });

/** The health score by week, as a line. Screen readers get a summary and the weekly numbers as a table. */
export function TrendChart({ points }: { points: readonly { week: string; score: number; pullRequests: number }[] }) {
  const titleId = useId();
  const first = points[0]!;
  const last = points.at(-1)!;
  const x = (i: number) => (points.length === 1 ? W / 2 : 40 + (i * (W - 56)) / (points.length - 1));
  const summary = `From ${first.score} in the week of ${day(first.week)} to ${last.score} in the week of ${day(last.week)}, over ${points.length} weeks.`;

  return (
    <figure className="flex flex-col gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-[160px] w-full" role="img" aria-labelledby={titleId}>
        <title id={titleId}>{`Health score by week. ${summary}`}</title>
        {[0, 50, 100].map((v) => (
          <g key={v}>
            <line x1={32} x2={W} y1={y(v)} y2={y(v)} className="stroke-gray-200" strokeWidth={1} />
            <text x={0} y={y(v) + 4} className="fill-gray-700 text-xs">
              {v}
            </text>
          </g>
        ))}
        <polyline points={points.map((p, i) => `${x(i)},${y(p.score)}`).join(" ")} className="fill-none stroke-gray-900" strokeWidth={2} />
        {points.map((p, i) => (
          <circle key={p.week} cx={x(i)} cy={y(p.score)} r={3.5} className="fill-gray-900" />
        ))}
        <text x={x(0)} y={H - 4} textAnchor={points.length === 1 ? "middle" : "start"} className="fill-gray-700 text-xs">
          {day(first.week)}
        </text>
        {points.length > 1 && (
          <text x={x(points.length - 1)} y={H - 4} textAnchor="end" className="fill-gray-700 text-xs">
            {day(last.week)}
          </text>
        )}
      </svg>
      <figcaption className="text-sm text-gray-700">{summary}</figcaption>
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
              <td>{p.pullRequests}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
