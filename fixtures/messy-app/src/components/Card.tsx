import type { ReactNode } from "react";

interface CardProps {
  title?: string;
  children: ReactNode;
  className?: string;
}

export function Card({ title, children, className = "" }: CardProps) {
  return (
    <section className={`rounded-lg border border-[#e5e7eb] bg-white p-6 shadow-sm ${className}`}>
      {title && <h3 className="mb-[7px] text-base font-semibold text-[#111827]">{title}</h3>}
      <div className="text-sm text-[#9ca3af]">{children}</div>
    </section>
  );
}
