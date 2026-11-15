import type { SystemModel } from "@steward/model";
import { checkContext, isCheckOn, type CheckContext } from "./context.js";
import type { CheckId, Finding } from "./findings.js";
import { readSnippet, type Snippet } from "./jsx.js";
import { checkArbitrarySpacing } from "./rules/arbitrary-spacing.js";
import { checkIconButtonLabels, checkImgAlt, checkRawButtons } from "./rules/elements.js";
import { checkHardcodedColors } from "./rules/hardcoded-color.js";

/** Said wherever accessibility checks report, so passing them is never read as "accessible". */
export const STATIC_CHECKS_NOTE =
  "These are static checks. They catch some accessibility problems, not all, so passing them doesn't make a screen accessible on its own.";

/** Every check, in the order findings on the same spot are listed. */
export const CHECKS: readonly { id: CheckId; label: string; run: (snippet: Snippet, ctx: CheckContext) => Finding[] }[] = [
  { id: "hardcoded-color", label: "colors outside the system", run: checkHardcodedColors },
  { id: "arbitrary-spacing", label: "spacing off the scale", run: checkArbitrarySpacing },
  { id: "raw-button", label: "raw buttons", run: checkRawButtons },
  { id: "img-alt", label: "image alt text", run: checkImgAlt },
  { id: "icon-button-label", label: "icon-only button labels", run: checkIconButtonLabels },
];

export interface CheckResult {
  findings: Finding[];
  /** Checks that didn't run because a person turned their rule off. */
  skipped: CheckId[];
}

const ORDER = new Map(CHECKS.map((c, i) => [c.id, i]));

/**
 * Runs the drift checks on a piece of JSX against the system model. Pure and
 * deterministic: findings come sorted by position. Steward Review calls the
 * same function on each changed file. Throws `SnippetParseError` when the code
 * can't be read as JSX.
 */
export function checkCode(code: string, model: SystemModel | CheckContext): CheckResult {
  const ctx = "tokens" in model ? checkContext(model) : model;
  const snippet = readSnippet(code);
  const findings: Finding[] = [];
  const skipped: CheckId[] = [];
  for (const check of CHECKS) {
    if (!isCheckOn(ctx, check.id)) skipped.push(check.id);
    else findings.push(...check.run(snippet, ctx));
  }
  findings.sort((a, b) => a.line - b.line || a.column - b.column || ORDER.get(a.check)! - ORDER.get(b.check)!);
  return { findings, skipped };
}

const MAX_INLINE_REPLACEMENT = 120;
const labelOf = (id: CheckId) => CHECKS.find((c) => c.id === id)!.label;
const list = (xs: readonly string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** Pure: a short, calm report of a check, for people and AI tools alike. */
export function describeCheck(result: CheckResult): string {
  const { findings, skipped } = result;
  const ran = CHECKS.filter((c) => !skipped.includes(c.id)).map((c) => c.label);
  const lines: string[] = [];
  if (findings.length === 0) {
    lines.push(`No problems found. Checked ${list(ran)}.`);
  } else {
    lines.push(`Found ${findings.length === 1 ? "1 thing" : `${findings.length} things`} to change:`, "");
    findings.forEach((f, i) => {
      lines.push(`${i + 1}. Line ${f.line}: ${f.message}`, `   Why: ${f.evidence}.`, `   Fix: ${f.fix.description}`);
      const r = f.fix.replacement;
      if (r && !r.includes("\n") && r.length <= MAX_INLINE_REPLACEMENT) lines.push(`   Replace with: \`${r}\``);
    });
  }
  if (skipped.length > 0) lines.push("", `Not checked, because their rules are turned off: ${list(skipped.map(labelOf))}.`);
  lines.push("", STATIC_CHECKS_NOTE);
  return `${lines.join("\n")}\n`;
}
