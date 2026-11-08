import type { ReactNode } from "react";

interface PrimaryBtnProps {
  label?: string;
  children?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  fullWidth?: boolean;
}

// Written for the Settings page by a contractor who didn't know Button existed.
export const PrimaryBtn = ({ label, children, onClick, disabled, fullWidth }: PrimaryBtnProps) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`rounded-md bg-[#3a81f5] px-[18px] py-[9px] text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 ${
      fullWidth ? "w-full" : ""
    }`}
  >
    {label ?? children}
  </button>
);
