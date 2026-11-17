"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { Decision } from "../../lib/decide";
import type { ReviewData } from "../../lib/review-data";
import { Button } from "../button";
import { decide } from "./actions";
import { ColorsCard } from "./colors-card";
import { ComponentsCard } from "./components-card";
import { ContrastCard } from "./contrast-card";
import { plural } from "./parts";
import { SpacingCard } from "./spacing-card";

/** The Setup review screen: the scan summary, Accept all, and a card per kind of suggestion. */
export function SetupReview({ data, version, summary, readOnly = false }: { data: ReviewData; version: string; summary: string; readOnly?: boolean }) {
  const [saving, startTransition] = useTransition();
  // Read-only (Steward's own test fixture): every decision control is disabled, and the banner says why.
  const busy = saving || readOnly;
  const [message, setMessage] = useState<{ ok: boolean; text: string; card: string | null } | null>(null);
  const names = Object.fromEntries(data.colors.tokens.flatMap((t) => t.members.map((m) => [m, t.name])));

  // Where focus was when a decision started: the item (`data-item`) and its card. After saving, focus goes back
  // there (to the item's new Undo, say), or to the card's heading if the item is gone, never to the page itself.
  const returnTo = useRef<{ item: string | null; card: string | null } | null>(null);
  const clicked = useRef<HTMLElement | null>(null);

  function run(decision: Decision) {
    setMessage(null);
    const focused = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    const active = clicked.current?.isConnected ? clicked.current : focused;
    clicked.current = null;
    returnTo.current = { item: active?.closest("[data-item]")?.getAttribute("data-item") ?? null, card: active?.closest("section[id]")?.id ?? null };
    const card = returnTo.current.card;
    startTransition(async () => {
      const r = await decide(version, decision);
      setMessage({ ok: r.ok, text: r.message, card });
    });
  }

  /** The last save's message, shown in the card it came from (not while saving). */
  const noticeFor = (card: string) => (!saving && message?.card === card ? message.text : null);

  useEffect(() => {
    if (saving || !returnTo.current) return;
    const { item, card } = returnTo.current;
    returnTo.current = null;
    // Leave focus alone if it's still on something on the page (a card button that stayed, say).
    if (document.activeElement && document.activeElement !== document.body) return;
    const itemEl = item ? document.querySelector<HTMLElement>(`[data-item="${CSS.escape(item)}"]`) : null;
    const target = itemEl?.querySelector<HTMLElement>("button") ?? (card ? document.querySelector<HTMLElement>(`#${CSS.escape(card)} h2`) : null);
    target?.focus();
  }, [saving, data]);

  return (
    // Remembers what was clicked: Safari doesn't focus a button on click, so focus alone can't say which card a decision came from.
    <div className="flex flex-col gap-6" onClickCapture={(e) => (clicked.current = e.target instanceof HTMLElement ? e.target : null)}>
      <ol className="flex gap-2 text-xs" aria-label="Setup steps">
        <li className="rounded-md border border-gray-500 px-3 py-1 text-gray-700">1. Scan: done</li>
        <li aria-current="step" className="rounded-md border border-gray-900 px-3 py-1 font-medium text-gray-900">
          2. Decide
        </li>
      </ol>
      <header className="flex flex-col gap-2">
        <p className="text-sm font-medium text-gray-700">Setup</p>
        <h1 className="text-2xl font-semibold text-gray-900">We found your design system. Here&apos;s a cleaner version.</h1>
        <p className="text-sm text-gray-700">{summary} Decide on each suggestion: accept it, change it, or keep things as they are. Your code doesn&apos;t change.</p>
      </header>
      {readOnly && (
        <p className="rounded-md border border-gray-500 bg-gray-50 p-3 text-sm text-gray-900">
          This is Steward&apos;s own test fixture, and its tests depend on it, so you can look but not change anything here. To try decisions, run{" "}
          <code className="rounded-md bg-gray-100 px-1 font-mono text-sm">pnpm -F web demo</code>: it opens a fresh copy you can change.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" disabled={busy || data.waiting === 0} onClick={() => run({ kind: "accept-all" })}>
          {data.waiting === 0 ? "Nothing waiting for a decision" : `Accept all ${plural(data.waiting, "suggestion")}`}
        </Button>
        <p role="status" aria-live="polite" className={`text-sm ${message && !message.ok ? "font-medium text-gray-900" : "text-gray-700"}`}>
          {saving ? "Saving and re-scanning…" : (message?.text ?? "")}
        </p>
      </div>
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <ColorsCard data={data.colors} busy={busy} run={run} notice={noticeFor("colors")} />
        <SpacingCard data={data.spacing} busy={busy} run={run} notice={noticeFor("spacing")} />
        <ComponentsCard data={data.components} busy={busy} run={run} notice={noticeFor("components")} />
        <ContrastCard data={data.contrast} names={names} busy={busy} run={run} notice={noticeFor("contrast")} />
      </div>
    </div>
  );
}
