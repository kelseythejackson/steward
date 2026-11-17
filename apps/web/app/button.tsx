"use client";

import type { ComponentProps, MouseEvent } from "react";

/**
 * Steward's own Button, the system's Button for this app. Always
 * `type="button"` unless told otherwise.
 *
 * `disabled` is announced with `aria-disabled` and the click is ignored,
 * but the button stays focusable: a truly disabled button drops keyboard
 * focus to the page, so people lose their place mid-task.
 */
type Props = ComponentProps<"button"> & { variant?: "primary" | "secondary" | "quiet" };

const BASE =
  "inline-flex items-center justify-center rounded-md text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 aria-disabled:cursor-not-allowed aria-disabled:opacity-50";
const VARIANTS = {
  primary: "bg-gray-900 px-4 py-2 text-white hover:bg-gray-800 aria-disabled:hover:bg-gray-900",
  secondary: "border border-gray-500 bg-white px-4 py-2 text-gray-900 hover:bg-gray-50 aria-disabled:hover:bg-white",
  quiet: "px-1 text-gray-700 underline hover:text-gray-900",
} as const;

export function Button({ variant = "secondary", className = "", type = "button", disabled, onClick, ...props }: Props) {
  function click(e: MouseEvent<HTMLButtonElement>) {
    if (disabled) {
      e.preventDefault(); // also stops a disabled submit button from submitting its form
      return;
    }
    onClick?.(e);
  }
  return <button type={type} aria-disabled={disabled || undefined} className={`${BASE} ${VARIANTS[variant]} ${className}`} onClick={click} {...props} />;
}
