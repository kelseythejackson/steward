import type { InputHTMLAttributes } from "react";

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
}

export function TextField({ label, hint, id, className = "", ...rest }: TextFieldProps) {
  return (
    <div className="mb-4">
      {label && (
        <label htmlFor={id} className="mb-1 block text-sm font-medium text-[#374151]">
          {label}
        </label>
      )}
      <input
        id={id}
        className={`h-[42px] w-full rounded-md border border-[#d1d5db] px-3 text-sm text-[#111827] outline-none focus:border-[#3b82f6] ${className}`}
        {...rest}
      />
      {hint && <p className="mt-1 text-xs text-[#9ca3af]">{hint}</p>}
    </div>
  );
}
