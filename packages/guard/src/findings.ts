import type { RuleCategory, RuleSeverity } from "@steward/model";
import type { Position, Range } from "./parse.js";

/** The rules Steward Review runs. Each lives in `rules/`. */
export type RuleId = "no-hardcoded-color" | "no-arbitrary-spacing" | "use-system-component" | "a11y-img-alt" | "a11y-icon-button-label";

export type Severity = RuleSeverity;

/** One change to the code: replace `range` with `text`. An insert has `start === end`. */
export interface TextEdit extends Range {
  text: string;
}

export interface Fix {
  /** What to do, in plain English. */
  description: string;
  /** The code to put in place of `found`, when there's one clear answer. */
  replacement?: string;
  /** The exact edits that make the change, when the rule can make it safely. `applyFixes` applies them. */
  edits?: TextEdit[];
}

/** One problem in a file, with its reason, evidence and a suggested fix. */
export interface Finding extends Position {
  rule: RuleId;
  /** `warn` unless a person set the system rule behind it to `error`. */
  severity: Severity;
  category: RuleCategory;
  /** Repo-relative path, when the code came from a file. */
  file?: string;
  /** The system rule this enforces, when the model has one (e.g. `spacing-tokens-only`), so a person can turn it off. */
  systemRule?: string;
  /** The code that was flagged, e.g. a class or an element's opening tag. */
  found: string;
  /** What's wrong, calmly. */
  message: string;
  /** The facts behind it, e.g. "ΔE 0.6 from blue-500 (#3b82f6)". */
  evidence: string;
  fix: Fix;
}
