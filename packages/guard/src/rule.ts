import type { RuleCategory } from "@steward/model";
import type { CheckContext } from "./context.js";
import type { Fix, RuleId, Severity, TextEdit } from "./findings.js";
import type { ParsedFile, Position, Range } from "./parse.js";

/** Something a rule checks, tied to the system rule that can turn it off. */
export interface Coverage {
  /** Plain English, e.g. "raw buttons", used in "Checked …" and "Not checked …". */
  label: string;
  /** The system rule in `system.json` behind it, if any. */
  systemRule?: string;
}

/** What a rule's check reports before the engine adds the rule id, severity and file. */
export interface Hit extends Position {
  /** The flagged code, so a fix knows what to replace. */
  range: Range;
  found: string;
  message: string;
  evidence: string;
  fix: Pick<Fix, "description" | "replacement">;
  systemRule?: string;
  /** Rule-specific detail its `fix` needs, e.g. the component to rename to. */
  data?: unknown;
}

/**
 * One Steward Review rule. `check` and `fix` are pure: same file and model,
 * same answer. `fix` returns edits instead of writing anything; nothing in
 * guard changes a file.
 */
export interface GuardRule {
  id: RuleId;
  /** One plain-English sentence about what the rule asks for. */
  description: string;
  category: RuleCategory;
  /** The default. A person's severity on the system rule behind a hit wins. */
  severity: Severity;
  /** What this rule checks for this system. Empty when the system has nothing for it to check yet. */
  covers(ctx: CheckContext): Coverage[];
  check(file: ParsedFile, ctx: CheckContext): Hit[];
  /** Edits that fix one hit, or null when there's no single safe fix. */
  fix?(file: ParsedFile, hit: Hit, ctx: CheckContext): TextEdit[] | null;
}

/** The fix for a hit whose `replacement` is exactly the code at its range. */
export function replaceRange(hit: Hit): TextEdit[] | null {
  return hit.fix.replacement === undefined ? null : [{ ...hit.range, text: hit.fix.replacement }];
}
