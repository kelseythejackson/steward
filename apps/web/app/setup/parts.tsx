import type { ReactNode } from "react";
import type { Status } from "../../lib/review-data";

/** A card on the review screen: title and summary, the before/after, then its actions. */
export function ReviewCard({ id, anchor, title, summary, children, actions }: { id: string; anchor?: string; title: string; summary: string; children: ReactNode; actions: ReactNode }) {
  return (
    <section id={anchor} aria-labelledby={id} className="flex scroll-mt-6 flex-col gap-4 rounded-lg border border-gray-200 bg-white p-6">
      <header className="flex items-baseline justify-between gap-4">
        <h2 id={id} className="text-lg font-semibold text-gray-900">
          {title}
        </h2>
        <p className="text-sm text-gray-700">{summary}</p>
      </header>
      <div className="flex flex-1 flex-col gap-4">{children}</div>
      <div className="flex flex-wrap gap-3">{actions}</div>
    </section>
  );
}

const LABELS: Record<Status, string> = { waiting: "Waiting", accepted: "Accepted", rejected: "Kept as is" };

export function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={`rounded-md px-2 py-1 text-xs font-medium ${status === "waiting" ? "bg-gray-100 text-gray-700" : "bg-gray-900 text-white"}`}>{LABELS[status]}</span>
  );
}

/** A color square. Its hex is read out to screen readers. */
export function Swatch({ hex, label }: { hex: string; label?: string }) {
  return (
    <span className="inline-flex size-8 shrink-0 rounded-md border border-gray-200" style={{ backgroundColor: hex }}>
      <span className="sr-only">{label ?? hex}</span>
    </span>
  );
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
