import type { RuleCategory } from "@steward/model";

/** The checks Steward Review runs. Each lives in `rules/` and is a pure function. */
export type CheckId = "hardcoded-color" | "arbitrary-spacing" | "raw-button" | "img-alt" | "icon-button-label";

export interface Fix {
  /** What to do, in plain English. */
  description: string;
  /** The code to put in place of `found`, when there's one clear answer. */
  replacement?: string;
}

/** One problem in a piece of code, with its reason, evidence and a suggested fix. */
export interface Finding {
  check: CheckId;
  /** The system rule this check enforces, when the model has one (e.g. `spacing-tokens-only`). */
  ruleId?: string;
  category: RuleCategory;
  /** 1-based, in the code as given. */
  line: number;
  /** 1-based, in the code as given. */
  column: number;
  /** The code that was flagged, e.g. a class or an element's opening tag. */
  found: string;
  /** What's wrong, calmly. */
  message: string;
  /** The facts behind it, e.g. "ΔE 0.6 from blue-500 (#3b82f6)". */
  evidence: string;
  fix: Fix;
}
