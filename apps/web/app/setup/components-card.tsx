"use client";

import { useId, useState } from "react";
import type { Decision } from "../../lib/decide";
import type { ReviewData } from "../../lib/review-data";
import { Button } from "../button";
import { plural, ReviewCard, StatusBadge } from "./parts";

export function ComponentsCard({ data, busy, run, notice }: { data: ReviewData["components"]; busy: boolean; run: (d: Decision) => void; notice?: string | null }) {
  const [choosing, setChoosing] = useState(false);
  const [keep, setKeep] = useState<Record<string, string>>({});
  const titleId = useId();
  const waiting = data.filter((m) => m.status === "waiting");

  return (
    <ReviewCard
      id={titleId}
      notice={notice}
      anchor="components"
      title="Components"
      summary={plural(data.length, "likely duplicate group")}
      actions={
        <>
          <Button variant="primary" disabled={busy || waiting.length === 0} onClick={() => run({ kind: "accept", ids: waiting.map((m) => m.id) })}>
            {waiting.length === 0 ? "Nothing waiting" : `Accept ${plural(waiting.length, "merge")}`}
          </Button>
          {/* One name, with pressed on or off: changing the name as well would announce "Done choosing, pressed". */}
          <Button aria-pressed={choosing} disabled={waiting.length === 0} className={choosing ? "bg-gray-100" : ""} onClick={() => setChoosing((c) => !c)}>
            Choose which to keep
          </Button>
        </>
      }
    >
      <ul className="flex flex-col gap-3">
        {data.map((m) => {
          const chosen = keep[m.id] ?? m.keep;
          return (
            <li key={m.id} data-item={m.id} className="flex flex-col gap-2 rounded-md border border-gray-200 p-3">
              <div className="flex flex-wrap items-center gap-2">
                {m.members.map((name) => (
                  <code key={name} className="rounded-md bg-gray-100 px-2 py-1 text-sm text-gray-900">
                    {name}
                  </code>
                ))}
                <span className="ml-auto">
                  <StatusBadge status={m.status} />
                </span>
              </div>
              <p className="text-sm text-gray-900">
                Merge into <strong>{chosen}</strong>
              </p>
              <p className="text-sm text-gray-700">{m.reason}</p>
              {choosing && m.status === "waiting" && (
                <fieldset className="flex flex-wrap gap-3">
                  <legend className="mb-1 text-sm text-gray-700">Keep which one?</legend>
                  {m.members.map((name) => (
                    <label key={name} className="flex items-center gap-2 text-sm text-gray-900">
                      <input
                        type="radio"
                        name={`keep-${m.id}`}
                        value={name}
                        checked={chosen === name}
                        onChange={() => setKeep((k) => ({ ...k, [m.id]: name }))}
                        className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                      />
                      {name}
                    </label>
                  ))}
                </fieldset>
              )}
              <div className="flex flex-wrap gap-3">
                {m.status === "waiting" ? (
                  <>
                    <Button
                      disabled={busy}
                      aria-label={`Accept: merge into ${chosen}`}
                      onClick={() => run(chosen === m.keep ? { kind: "accept", ids: [m.id] } : { kind: "keep", id: m.id, keep: chosen })}
                    >
                      Accept
                    </Button>
                    <Button variant="quiet" disabled={busy} aria-label={`Keep ${m.members.join(" and ")} as they are`} onClick={() => run({ kind: "reject", ids: [m.id] })}>
                      Keep both
                    </Button>
                  </>
                ) : (
                  <Button variant="quiet" disabled={busy} aria-label={`Undo the decision on ${m.members.join(", ")}`} onClick={() => run({ kind: "undo", id: m.id })}>
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
