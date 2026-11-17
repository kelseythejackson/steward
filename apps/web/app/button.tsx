import type { ComponentProps } from "react";

/** Steward's own Button, the system's Button for this app. Always `type="button"` unless told otherwise. */
type Props = ComponentProps<"button"> & { variant?: "primary" | "secondary" | "quiet" };

const BASE =
  "inline-flex items-center justify-center rounded-md text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50";
const VARIANTS = {
  primary: "bg-gray-900 px-4 py-2 text-white hover:bg-gray-800",
  secondary: "border border-gray-300 bg-white px-4 py-2 text-gray-900 hover:bg-gray-50",
  quiet: "px-1 text-gray-700 underline hover:text-gray-900",
} as const;

export function Button({ variant = "secondary", className = "", type = "button", ...props }: Props) {
  return <button type={type} className={`${BASE} ${VARIANTS[variant]} ${className}`} {...props} />;
}
