import type { SystemModel } from "@steward/model";
import type { CheckContext } from "./context.js";
import { checkFile, type CheckResult } from "./engine.js";

/** Said wherever accessibility checks report, so passing them is never read as "accessible". */
/** What the spacing check leaves out, said wherever people read about it. Layout sizes are often one-offs on purpose, so flagging them would mostly be noise. */
export const SPACING_SCOPE_NOTE = "Spacing is checked on padding, margin and gap; widths and heights (like `w-[320px]`) aren't checked.";

export const STATIC_CHECKS_NOTE =
  "These are static checks. They catch some accessibility problems, not all, so passing them doesn't make a screen accessible on its own.";

/**
 * Runs every rule on a piece of JSX with no file path: what the
 * `check_snippet` MCP tool uses. Throws `SnippetParseError` when the code
 * can't be read as JSX.
 */
export function checkCode(code: string, model: SystemModel | CheckContext): CheckResult {
  return checkFile({ code }, model);
}

const MAX_INLINE_REPLACEMENT = 120;
const list = (xs: readonly string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** Pure: a short, calm report of a check, for people and AI tools alike. */
export function describeCheck(result: CheckResult): string {
  const { findings, checked, skipped } = result;
  const lines: string[] = [];
  if (findings.length === 0) {
    lines.push(`No problems found. Checked ${list(checked)}.`);
  } else {
    lines.push(`Found ${findings.length === 1 ? "1 thing" : `${findings.length} things`} to change:`, "");
    findings.forEach((f, i) => {
      const required = f.severity === "error" ? " (required)" : "";
      lines.push(`${i + 1}. Line ${f.line}${required}: ${f.message}`, `   Why: ${f.evidence}.`, `   Fix: ${f.fix.description}`);
      const r = f.fix.replacement;
      if (r && !r.includes("\n") && r.length <= MAX_INLINE_REPLACEMENT) lines.push(`   Replace with: \`${r}\``);
    });
  }
  if (result.ignored.length > 0) {
    lines.push("", `Marked intentional with steward-ignore: ${result.ignored.map((i) => `line ${i.finding.line} (${i.finding.rule}: ${i.reason})`).join("; ")}.`);
  }
  for (const n of result.notes) lines.push("", `Line ${n.line}: ${n.message}`);
  if (skipped.length > 0) lines.push("", `Not checked, because their rules are turned off: ${list(skipped)}.`);
  lines.push("", STATIC_CHECKS_NOTE);
  return `${lines.join("\n")}\n`;
}
