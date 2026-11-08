import type { MouseEventHandler, ReactNode } from "react";

type Size = "md" | "lg";

interface CTAButtonProps {
  children: ReactNode;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  size?: Size;
  href?: string;
}

// Marketing wanted a "bigger, rounder" button for the upgrade flow.
// Cursor generated this one; it rendered as an <a> when href is set.
export function CTAButton({ children, onClick, size = "md", href }: CTAButtonProps) {
  const sizing = size === "lg" ? "px-7 py-[13px] text-base" : "px-5 py-2.5 text-sm";
  const base = `inline-flex items-center justify-center rounded-full bg-[#3b83f7] font-semibold text-white shadow-sm hover:bg-[#3b82f6] ${sizing}`;

  if (href) {
    return (
      <a href={href} className={base}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={base}>
      {children}
    </button>
  );
}
