"use client";

import { useRef, useState } from "react";
import { Button } from "../button";

/** A snippet to copy: the text, and a Copy button that says what happened. */
export function CopyBlock({ label, text }: { label: string; text: string }) {
  const [status, setStatus] = useState("");
  const pre = useRef<HTMLPreElement>(null);
  /** Clears the status first, so a second copy is announced again rather than going unnoticed. */
  function announce(text: string) {
    setStatus("");
    requestAnimationFrame(() => setStatus(text));
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      announce("Copied.");
    } catch {
      // No clipboard access (an insecure page, or a browser setting): select it so the person can copy it themselves.
      const range = document.createRange();
      if (pre.current) range.selectNodeContents(pre.current);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      announce("Couldn't copy automatically. It's selected: press Cmd+C or Ctrl+C.");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-gray-700">{label}</span>
        {/* Named for what it copies: a page of identical "Copy" buttons is hard to tell apart in a screen reader's list. */}
        <Button aria-label={`Copy: ${label}`} onClick={copy}>
          Copy
        </Button>
      </div>
      {/* Wraps instead of scrolling sideways: a scrolling box keyboard users can't focus would hide part of the path. */}
      <pre ref={pre} className="whitespace-pre-wrap break-all rounded-md bg-gray-50 p-3 font-mono text-xs text-gray-900">
        {text}
      </pre>
      <p role="status" aria-live="polite" className="text-xs text-gray-700">
        {status}
      </p>
    </div>
  );
}
