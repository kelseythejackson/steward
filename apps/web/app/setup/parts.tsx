import type { ReactNode } from "react";
import type { Status } from "../../lib/review-data";

/** A card on the review screen: title and summary, the before/after, then its actions. */
export function ReviewCard({
  id,
  anchor,
  title,
  summary,
  notice,
  children,
  actions,
}: {
  id: string;
  anchor?: string;
  title: string;
  summary: string;
  /** The last save's message, when it was made from this card. Shown here too, since the top of the page may be out of view; announced once, from the top. */
  notice?: string | null | undefined;
  children: ReactNode;
  actions: ReactNode;
}) {
  return (
    <section id={anchor} aria-labelledby={id} className="flex scroll-mt-6 flex-col gap-4 rounded-lg border border-gray-200 bg-white p-6">
      <header className="flex items-baseline justify-between gap-4">
        {/* Focusable from script (not by Tab), so focus can land here after a save removes the item it was on. */}
        <h2 id={id} tabIndex={-1} className="rounded-md text-lg font-semibold text-gray-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
          {title}
        </h2>
        <p className="text-sm text-gray-700">{summary}</p>
      </header>
      {notice && (
        <p aria-hidden="true" className="rounded-md bg-gray-100 p-3 text-sm text-gray-900">
          {notice}
        </p>
      )}
      <div className="flex flex-1 flex-col gap-4">{children}</div>
      <div className="flex flex-wrap gap-3">{actions}</div>
    </section>
  );
}

const LABELS: Record<Status, string> = { waiting: "Waiting", accepted: "Accepted", rejected: "Kept as is" };

/**
 * Where a suggestion stands. `stillFails`: a declined contrast fix, which
 * still fails WCAG AA, so it isn't shown as done ("raise the floor").
 */
export function StatusBadge({ status, stillFails = false }: { status: Status; stillFails?: boolean }) {
  if (status === "rejected" && stillFails) {
    return <span className="rounded-md border border-gray-900 bg-white px-2 py-1 text-xs font-medium text-gray-900">Declined: still fails</span>;
  }
  return (
    <span className={`rounded-md px-2 py-1 text-xs font-medium ${status === "waiting" ? "bg-gray-100 text-gray-700" : "bg-gray-900 text-white"}`}>{LABELS[status]}</span>
  );
}

/**
 * A color square. With `caption`, its hex shows underneath, so nobody has
 * to tell colors apart by sight alone; without, the hex (or `label`) is
 * still read out to screen readers. The outline is strong enough to see a
 * white swatch on a white card.
 */
export function Swatch({ hex, label, caption = false }: { hex: string; label?: string; caption?: boolean }) {
  const square = <span aria-hidden={caption || undefined} className="inline-flex size-8 shrink-0 rounded-md border border-gray-500" style={{ backgroundColor: hex }} />;
  if (caption) {
    return (
      <span className="inline-flex flex-col items-center gap-1">
        {square}
        <span className="font-mono text-xs text-gray-700">{label ?? hex}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex size-8 shrink-0 rounded-md border border-gray-500" style={{ backgroundColor: hex }}>
      <span className="sr-only">{label ?? hex}</span>
    </span>
  );
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
