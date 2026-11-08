import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  children: ReactNode;
}

const variants: Record<Variant, string> = {
  primary: "bg-[#3b82f6] text-white hover:bg-[#2563eb]",
  secondary: "bg-white text-[#374151] border border-[#d1d5db] hover:bg-[#f3f4f6]",
  ghost: "bg-transparent text-[#6b7280] hover:text-[#1f2937]",
};

/** The "official" button. Added in month one; adoption has been uneven. */
export function Button({ variant = "primary", className = "", children, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={`inline-flex items-center rounded-md px-4 py-2 text-sm font-medium transition ${variants[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
