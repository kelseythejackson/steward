"use client";

import { useState, useTransition } from "react";
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
export function SetupReview({ data, version, summary }: { data: ReviewData; version: string; summary: string }) {
  const [busy, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const names = Object.fromEntries(data.colors.tokens.flatMap((t) => t.members.map((m) => [m, t.name])));

  function run(decision: Decision) {
    setMessage(null);
    startTransition(async () => {
      const r = await decide(version, decision);
      setMessage({ ok: r.ok, text: r.message });
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <ol className="flex gap-2 text-xs" aria-label="Setup steps">
        <li className="rounded-md border border-gray-300 px-3 py-1 text-gray-700">1. Scan: done</li>
        <li aria-current="step" className="rounded-md border border-gray-900 px-3 py-1 font-medium text-gray-900">
          2. Review
        </li>
      </ol>
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-gray-900">We found your design system. Here&apos;s a cleaner version.</h1>
        <p className="text-sm text-gray-700">{summary} Review each suggestion: accept it, change it, or keep things as they are. Your code doesn&apos;t change.</p>
      </header>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" disabled={busy || data.waiting === 0} onClick={() => run({ kind: "accept-all" })}>
          {data.waiting === 0 ? "Nothing waiting for a decision" : `Accept all ${plural(data.waiting, "suggestion")}`}
        </Button>
        <p role="status" aria-live="polite" className={`text-sm ${message && !message.ok ? "font-medium text-gray-900" : "text-gray-700"}`}>
          {busy ? "Saving and re-scanning…" : (message?.text ?? "")}
        </p>
      </div>
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <ColorsCard data={data.colors} busy={busy} run={run} />
        <SpacingCard data={data.spacing} busy={busy} run={run} />
        <ComponentsCard data={data.components} busy={busy} run={run} />
        <ContrastCard data={data.contrast} names={names} busy={busy} run={run} />
      </div>
    </div>
  );
}
