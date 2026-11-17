"use client";

import { useEffect, useId, useMemo, useRef, useState, type DragEvent } from "react";
import type { Decision } from "../../lib/decide";
import { nameForMovedColor } from "../../lib/names";
import type { ReviewData } from "../../lib/review-data";
import { Button } from "../button";
import { plural, ReviewCard, StatusBadge, Swatch } from "./parts";

interface Group {
  /** The token's path before any edit; new groups (a color moved out on its own) have none. */
  from: string | null;
  path: string;
  members: string[];
}

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600";

export function ColorsCard({ data, busy, run }: { data: ReviewData["colors"]; busy: boolean; run: (d: Decision) => void }) {
  const [editing, setEditing] = useState(false);
  const waiting = data.merges.filter((m) => m.status === "waiting");
  const titleId = useId();
  // When the editor closes, focus goes back to the button that opened it, so keyboard users don't lose their place.
  const editButton = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  useEffect(() => {
    if (wasEditing.current && !editing) editButton.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

  return (
    <ReviewCard
      id={titleId}
      anchor="colors"
      title="Colors"
      summary={`${plural(data.found.length, "color")} → ${plural(data.tokens.length, "token")}`}
      actions={
        editing ? null : (
          <>
            <Button variant="primary" disabled={busy || waiting.length === 0} onClick={() => run({ kind: "accept", ids: waiting.map((m) => m.id) })}>
              {waiting.length === 0 ? "Nothing waiting" : `Accept ${plural(waiting.length, "color merge")}`}
            </Button>
            <Button ref={editButton} disabled={busy} onClick={() => setEditing(true)}>
              Edit merge
            </Button>
          </>
        )
      }
    >
      {editing ? (
        <EditGroups tokens={data.tokens} busy={busy} onCancel={() => setEditing(false)} onSave={(groups) => (run({ kind: "color-groups", groups }), setEditing(false))} />
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <h3 className="text-sm text-gray-700">Found in code</h3>
            <ul className="flex flex-wrap gap-1" aria-label="Colors found in code">
              {data.found.map((hex) => (
                <li key={hex}>
                  <Swatch hex={hex} />
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="text-sm text-gray-700">Suggested tokens</h3>
            <ul className="flex flex-wrap gap-3" aria-label="Suggested color tokens">
              {data.tokens.map((t) => (
                <li key={t.path} className="flex w-[56px] flex-col items-center gap-1">
                  <Swatch hex={t.hex} label={`${t.name}, ${t.hex}`} />
                  <span aria-hidden="true" className="w-full truncate text-center text-xs text-gray-700">
                    {t.name}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          {data.merges.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm text-gray-700">Merges</h3>
              <ul className="flex flex-col gap-2">
                {data.merges.map((m) => (
                  <li key={m.id} className="flex flex-col gap-2 rounded-md border border-gray-200 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {m.members.map((hex) => (
                        <Swatch key={hex} hex={hex} />
                      ))}
                      <span aria-hidden="true" className="text-gray-500">
                        →
                      </span>
                      <span className="sr-only">merge into</span>
                      <Swatch hex={m.hex} label={m.name} />
                      <code className="text-sm text-gray-900">{m.name}</code>
                      <span className="ml-auto">
                        <StatusBadge status={m.status} />
                      </span>
                    </div>
                    <p className="text-sm text-gray-700">{m.reason}</p>
                    {m.status === "waiting" ? (
                      <div className="flex flex-wrap gap-3">
                        <Button disabled={busy} aria-label={`Accept: merge into ${m.name}`} onClick={() => run({ kind: "accept", ids: [m.id] })}>
                          Accept
                        </Button>
                        <Button variant="quiet" disabled={busy} aria-label={`Keep ${m.members.join(" and ")} apart`} onClick={() => run({ kind: "reject", ids: [m.id] })}>
                          Keep apart
                        </Button>
                      </div>
                    ) : (
                      <div>
                        <Button variant="quiet" disabled={busy} onClick={() => run({ kind: "undo", id: m.id })}>
                          Undo
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </ReviewCard>
  );
}

/**
 * Rearranging color groups: drag a swatch onto another group, or use the
 * Move form (the keyboard way). Rename a token by editing its name.
 * Only groups that changed are saved.
 */
function EditGroups({ tokens, busy, onCancel, onSave }: { tokens: ReviewData["colors"]["tokens"]; busy: boolean; onCancel: () => void; onSave: (groups: { members: string[]; path: string }[]) => void }) {
  const initial = useMemo<Group[]>(() => tokens.map((t) => ({ from: t.path, path: t.path, members: [...t.members] })), [tokens]);
  const [groups, setGroups] = useState<Group[]>(initial);
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  const [announce, setAnnounce] = useState("");
  const hintId = useId();

  /** Moves `hex` into group `to`, or into a new group of its own when `to` is "own". */
  function move(hex: string, to: number | "own") {
    setGroups((gs) => {
      const fromIndex = gs.findIndex((g) => g.members.includes(hex));
      if (fromIndex === -1 || fromIndex === to) return gs;
      const next = gs.map((g) => ({ ...g, members: g.members.filter((m) => m !== hex) }));
      if (to === "own") {
        const path = nameForMovedColor(gs[fromIndex]!.path, hex, gs.map((g) => g.path));
        next.push({ from: null, path, members: [hex] });
        setAnnounce(`Moved ${hex} into a token of its own, ${path}.`);
      } else {
        next[to]!.members.push(hex);
        setAnnounce(`Moved ${hex} into ${next[to]!.path}.`);
      }
      return next;
    });
  }

  const changed = groups.filter((g) => {
    const before = initial.find((i) => i.from !== null && i.from === g.from);
    return !before || before.path !== g.path || before.members.join() !== g.members.join();
  });
  const toSave = changed.filter((g) => g.members.length > 0).map((g) => ({ members: g.members, path: g.path }));

  function onDragStart(e: DragEvent, hex: string) {
    e.dataTransfer.setData("text/plain", hex);
    e.dataTransfer.effectAllowed = "move";
  }
  function onDrop(e: DragEvent, to: number) {
    e.preventDefault();
    setDropTarget(null);
    const hex = e.dataTransfer.getData("text/plain");
    if (hex) move(hex, to);
  }

  return (
    <div className="flex flex-col gap-4">
      <p id={hintId} className="text-sm text-gray-700">
        Drag a color onto another group, or choose one below and press Move. Rename a token by editing its name. Only groups you change are saved.
      </p>
      <MoveForm groups={groups} onMove={move} />
      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>
      <ul className="flex flex-col gap-2" aria-describedby={hintId}>
        {groups.map((g, i) =>
          g.members.length === 0 && g.from !== null && !changed.includes(g) ? null : (
            <li
              key={g.from ?? g.path}
              onDragOver={(e) => {
                e.preventDefault();
                setDropTarget(i);
              }}
              onDragLeave={() => setDropTarget((t) => (t === i ? null : t))}
              onDrop={(e) => onDrop(e, i)}
              className={`flex flex-col gap-2 rounded-md border p-3 ${dropTarget === i ? "border-blue-600 bg-gray-50" : "border-gray-200"}`}
            >
              <label className="flex flex-col gap-1 text-xs text-gray-700">
                Token name
                <input
                  value={g.path}
                  onChange={(e) => setGroups((gs) => gs.map((x, j) => (j === i ? { ...x, path: e.target.value } : x)))}
                  className={`rounded-md border border-gray-500 px-2 py-1 font-mono text-sm text-gray-900 ${FOCUS}`}
                />
              </label>
              {g.members.length === 0 ? (
                <p className="text-sm text-gray-700">No colors left. This token goes away when you save.</p>
              ) : (
                <ul className="flex flex-wrap gap-3">
                  {g.members.map((hex) => (
                    <li key={hex} className="flex items-center gap-2">
                      <span draggable onDragStart={(e) => onDragStart(e, hex)} className="cursor-grab">
                        <Swatch hex={hex} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ),
        )}
      </ul>
      <div className="flex flex-wrap gap-3">
        <Button variant="primary" disabled={busy || toSave.length === 0} onClick={() => onSave(toSave)}>
          {toSave.length === 0 ? "No changes yet" : `Save ${plural(toSave.length, "group")}`}
        </Button>
        <Button disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * The keyboard way to move a color: pick the color, pick where it goes, then
 * press Move. Nothing moves while someone is still choosing.
 */
function MoveForm({ groups, onMove }: { groups: Group[]; onMove: (hex: string, to: number | "own") => void }) {
  const colors = groups.flatMap((g) => g.members.map((hex) => ({ hex, from: g.path })));
  const [hex, setHex] = useState("");
  const [to, setTo] = useState("");
  const colorId = useId();
  const toId = useId();
  // Opening the editor puts focus on its first control, so the next Tab doesn't skip past it.
  const first = useRef<HTMLSelectElement>(null);
  useEffect(() => first.current?.focus(), []);
  const from = colors.find((c) => c.hex === hex)?.from;
  return (
    <form
      className="flex flex-wrap items-end gap-3 rounded-md bg-gray-50 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!hex || !to) return;
        onMove(hex, to === "own" ? "own" : Number(to));
        setHex("");
        setTo("");
      }}
    >
      <div className="flex flex-col gap-1">
        <label htmlFor={colorId} className="text-xs text-gray-700">
          Color
        </label>
        <select ref={first} id={colorId} value={hex} onChange={(e) => setHex(e.target.value)} className={`rounded-md border border-gray-500 bg-white px-2 py-1 font-mono text-sm text-gray-900 ${FOCUS}`}>
          <option value="">Choose a color</option>
          {colors.map((c) => (
            <option key={c.hex} value={c.hex}>
              {c.hex} (in {c.from})
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={toId} className="text-xs text-gray-700">
          Into
        </label>
        <select id={toId} value={to} onChange={(e) => setTo(e.target.value)} className={`rounded-md border border-gray-500 bg-white px-2 py-1 font-mono text-sm text-gray-900 ${FOCUS}`}>
          <option value="">Choose a group</option>
          {groups.map((g, j) =>
            g.path === from || (g.members.length === 0 && g.from !== null) ? null : (
              <option key={g.from ?? g.path} value={j}>
                {g.path}
              </option>
            ),
          )}
          <option value="own">Its own token</option>
        </select>
      </div>
      <Button type="submit" disabled={!hex || !to}>
        Move
      </Button>
    </form>
  );
}
