import type { ReactNode } from "react";

interface PanelProps {
  heading?: string;
  children: ReactNode;
}

// Same thing as Card with a different radius. Nobody noticed for six months.
export function Panel({ heading, children }: PanelProps) {
  return (
    <div className="rounded-xl border border-[#e4e4e7] bg-white p-[13px] shadow-sm">
      {heading ? <h3 className="mb-2 text-base font-semibold text-[#1f2937]">{heading}</h3> : null}
      <div className="text-sm text-[#9ca3af]">{children}</div>
    </div>
  );
}
