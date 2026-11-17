"use client";

import { useId, useState } from "react";
import type { Decision } from "../../lib/decide";
import type { ReviewData } from "../../lib/review-data";
import { Button } from "../button";
import { plural, ReviewCard, StatusBadge } from "./parts";

export function SpacingCard({ data, busy, run, notice }: { data: ReviewData["spacing"]; busy: boolean; run: (d: Decision) => void; notice?: string | null }) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const listId = useId();
  const waiting = data.snaps.filter((s) => s.status === "waiting");
  const snapping = waiting.flatMap((s) => s.values);
  const max = Math.max(...data.scale.map((s) => s.px), 1);
  const found = new Set([...data.scale.map((s) => `${s.px}px`), ...data.snaps.flatMap((s) => s.values)]).size;

  return (
    <ReviewCard
      id={titleId}
      notice={notice}
      anchor="spacing"
      title="Spacing"
      summary={`${plural(found, "value")} → ${data.scale.length}-step scale`}
      actions={
        <>
          <Button variant="primary" disabled={busy || waiting.length === 0} onClick={() => run({ kind: "accept", ids: waiting.map((s) => s.id) })}>
            {waiting.length === 0 ? "Nothing waiting" : `Accept ${plural(waiting.length, "snap")}`}
          </Button>
          <Button aria-expanded={open} aria-controls={listId} onClick={() => setOpen((o) => !o)}>
            {open ? "Hide each snap" : "Show each snap"}
          </Button>
        </>
      }
    >
      <ul className="flex flex-col gap-2" aria-label="Spacing scale">
        {data.scale.map((s) => (
          <li key={s.px} className="grid grid-cols-[48px_1fr] items-center gap-3 text-sm text-gray-700">
            <span>{s.px}px</span>
            <span aria-hidden="true" className="h-2 rounded-md bg-gray-500" style={{ width: `${Math.max(4, (s.px / max) * 100)}%` }} />
          </li>
        ))}
      </ul>
      <p className="rounded-md bg-gray-100 p-3 text-sm text-gray-900">
        {snapping.length === 0
          ? "Nothing left to snap."
          : `${plural(snapping.length, "one-off value")} like ${snapping.slice(0, 2).join(" and ")} will snap to the nearest step.`}
      </p>
      <div id={listId} hidden={!open} className="flex flex-col gap-2">
        {data.snaps.map((s) => (
          <section key={s.id} data-item={s.id} aria-label={`${s.values.join(", ")} to ${s.step}px`} className="flex flex-col gap-2 rounded-md border border-gray-200 p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-gray-900">
                {s.values.join(", ")} → {s.step}px
              </p>
              <StatusBadge status={s.status} />
            </div>
            <ul className="flex flex-col gap-1">
              {s.places.map((p) => (
                <li key={`${p.file}:${p.line}:${p.value}`} className="font-mono text-xs text-gray-700">
                  {p.file}:{p.line} <span className="text-gray-900">{p.value}</span>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-3">
              {s.status === "waiting" ? (
                <>
                  <Button disabled={busy} aria-label={`Accept: snap ${s.values.join(", ")} to ${s.step}px`} onClick={() => run({ kind: "accept", ids: [s.id] })}>
                    Accept
                  </Button>
                  {s.values.map((v) => (
                    <Button key={v} variant="quiet" disabled={busy} onClick={() => run({ kind: "leave-off", id: s.id, values: [v] })}>
                      Keep {v} as is
                    </Button>
                  ))}
                </>
              ) : (
                <Button variant="quiet" disabled={busy} aria-label={`Undo the decision on ${s.values.join(", ")} to ${s.step}px`} onClick={() => run({ kind: "undo", id: s.id })}>
                  Undo
                </Button>
              )}
            </div>
          </section>
        ))}
      </div>
    </ReviewCard>
  );
}
