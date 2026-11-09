import type { ContrastUse } from "@steward/model";

/** Interaction states checked separately. Responsive prefixes count as `base`; `focus-visible` counts as `focus`. */
export type InteractionState = "base" | "hover" | "focus";

/** One place in the code where a foreground and background color are used together. */
export interface PairOccurrence {
  /** Canonical 6-digit hex. */
  foreground: string;
  background: string;
  use: ContrastUse;
  state: InteractionState;
  /** Path relative to the repo root, with forward slashes. */
  file: string;
  line: number;
  /** Enclosing component, or the CSS selector. */
  component?: string;
  /** True when no background was set in this file, so white was assumed. */
  backgroundAssumed: boolean;
}

/** An element (or CSS rule) that removes its focus outline without a visible replacement. */
export interface FocusFinding {
  file: string;
  line: number;
  component?: string;
  /** Tag name (`input`) or CSS selector. */
  element: string;
  /** Plain-English explanation with a suggested fix. */
  reason: string;
}

/** Something the contrast check couldn't judge, and why. Reported, never silently dropped. */
export interface ContrastSkip {
  file: string;
  line: number;
  reason: string;
}

export interface ContrastExtraction {
  pairs: PairOccurrence[];
  focus: FocusFinding[];
  skipped: ContrastSkip[];
}
