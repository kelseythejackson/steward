"use client";

import { useId, useRef, useState } from "react";
import { Button } from "../button";

/** A snippet to copy: the text, and a Copy button that says what happened. */
export function CopyBlock({ label, text }: { label: string; text: string }) {
  const [status, setStatus] = useState("");
  const pre = useRef<HTMLPreElement>(null);
  const labelId = useId();

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setStatus("Copied.");
    } catch {
      // No clipboard access (an insecure page, or a browser setting): select it so the person can copy it themselves.
      const range = document.createRange();
      if (pre.current) range.selectNodeContents(pre.current);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      setStatus("Couldn't copy automatically. It's selected: press Cmd+C or Ctrl+C.");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <span id={labelId} className="text-xs text-gray-700">
          {label}
        </span>
        <Button aria-describedby={labelId} onClick={copy}>
          Copy
        </Button>
      </div>
      {/* Wraps instead of scrolling sideways: a scrolling box keyboard users can't focus would hide part of the path. */}
      <pre ref={pre} aria-labelledby={labelId} className="whitespace-pre-wrap break-all rounded-md bg-gray-50 p-3 font-mono text-xs text-gray-900">
        {text}
      </pre>
      <p role="status" aria-live="polite" className="text-xs text-gray-700">
        {status}
      </p>
    </div>
  );
}
