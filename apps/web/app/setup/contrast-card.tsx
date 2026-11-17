"use client";

import { useId } from "react";
import { contrastSummary } from "../../lib/contrast-summary";
import type { Decision } from "../../lib/decide";
import type { ReviewData } from "../../lib/review-data";
import { Button } from "../button";
import { plural, ReviewCard, StatusBadge } from "./parts";

const ratio = (r: number) => `${r.toFixed(1)}:1`;

/** A sample of the pair as it reads: "Aa" in the text color on the background. */
function Sample({ foreground, background }: { foreground: string; background: string }) {
  return (
    <span aria-hidden="true" className="inline-flex shrink-0 rounded-md border border-gray-200 px-2 py-1 text-sm font-medium" style={{ color: foreground, backgroundColor: background }}>
      Aa
    </span>
  );
}

export function ContrastCard({ data, names, busy, run, notice }: { data: ReviewData["contrast"]; names: Record<string, string>; busy: boolean; run: (d: Decision) => void; notice?: string | null }) {
  const titleId = useId();
  const waiting = data.filter((c) => c.status === "waiting");
  const accepted = data.filter((c) => c.status === "accepted").length;
  const name = (hex: string) => names[hex] ?? hex;

  return (
    <ReviewCard
      id={titleId}
      notice={notice}
      anchor="contrast"
      title="Contrast"
      summary={contrastSummary(data.length, accepted)}
      actions={
        <Button variant="primary" disabled={busy || waiting.length === 0} onClick={() => run({ kind: "accept", ids: waiting.map((c) => c.id) })}>
          {waiting.length === 0 ? "Nothing waiting" : `Accept ${plural(waiting.length, "fix", "fixes")}`}
        </Button>
      }
    >
      <ul className="flex flex-col gap-2">
        {data.map((c) => {
          const after = c.fix.replaces === "foreground" ? { foreground: c.fix.hex, background: c.background } : { foreground: c.foreground, background: c.fix.hex };
          return (
            <li key={c.id} data-item={c.id} className="flex flex-col gap-2 rounded-md border border-gray-200 p-3">
              <div className="flex justify-end">
                <StatusBadge status={c.status} stillFails />
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm text-gray-900">
                <Sample foreground={c.foreground} background={c.background} />
                <span>
                  {name(c.foreground)} on {name(c.background)}: {ratio(c.ratio)}, needs {ratio(c.required)}
                </span>
                <span aria-hidden="true" className="text-gray-500">
                  →
                </span>
                <Sample foreground={after.foreground} background={after.background} />
                <span>
                  use {c.fix.name} for the {c.fix.replaces === "foreground" ? "text" : "background"}: {ratio(c.fix.ratio)}
                </span>
              </div>
              <p className="text-sm text-gray-700">{c.reason}</p>
              <div className="flex flex-wrap gap-3">
                {c.status === "waiting" ? (
                  <>
                    <Button disabled={busy} aria-label={`Accept: use ${c.fix.name} for ${name(c.foreground)} on ${name(c.background)}`} onClick={() => run({ kind: "accept", ids: [c.id] })}>
                      Accept
                    </Button>
                    <Button variant="quiet" disabled={busy} aria-label={`Decline the fix for ${name(c.foreground)} on ${name(c.background)}`} onClick={() => run({ kind: "reject", ids: [c.id] })}>
                      Decline
                    </Button>
                  </>
                ) : (
                  <Button variant="quiet" disabled={busy} aria-label={`Undo the decision on ${name(c.foreground)} on ${name(c.background)}`} onClick={() => run({ kind: "undo", id: c.id })}>
                    Undo
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </ReviewCard>
  );
}
