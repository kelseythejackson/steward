/**
 * What Steward Review says on a GitHub pull request: one comment per changed
 * line with findings (with a one-click `suggestion` block when the fix is
 * safe and stays on that line), and one summary comment. Pure: the caller
 * talks to the GitHub API.
 */
import { createHash } from "node:crypto";
import { STATIC_CHECKS_NOTE } from "./check.js";
import { applyFixes } from "./engine.js";
import type { Finding, Note, RuleId } from "./findings.js";
import type { ReviewResult, SourceFile } from "./review.js";
import { RULES } from "./rules/index.js";

/** Hidden in the summary comment so a new push updates it instead of adding another. */
export const SUMMARY_MARKER = "<!-- steward-review:summary -->";
const FINGERPRINT_MARKER = /<!-- steward-review:fp=([0-9a-f]+) -->/;

/** A review comment on one line of the pull request's head commit. */
export interface LineComment {
  /** Path from the root of the GitHub repo. */
  path: string;
  line: number;
  body: string;
  /** Same file, line text and findings → same fingerprint, so a new push doesn't post it again. */
  fingerprint: string;
  /** How many of this line's findings the suggestion block fixes. */
  oneClick: number;
}

/** Plain-English names for the summary table. */
export const RULE_LABELS: Readonly<Record<RuleId, string>> = {
  "no-hardcoded-color": "Colors outside the system",
  "no-arbitrary-spacing": "Spacing off the scale",
  "use-system-component": "Components to swap for the system's",
  "a11y-img-alt": "Images without alt text",
  "a11y-accessible-name": "Icon-only buttons and links without a name",
  "a11y-label-inputs": "Form fields without a label",
  "a11y-interactive-element": "Click handlers on divs and spans",
  "a11y-focus-visible": "Focus outlines removed with nothing in their place",
  "a11y-text-contrast": "Color pairs below WCAG AA contrast",
};

/**
 * Pure: makes text safe for GitHub Markdown. Outside code spans, `<` and `>`
 * become entities, so `<button>` shows up instead of being dropped as HTML.
 */
export function markdown(text: string): string {
  return text
    .split(/(`[^`\n]*`)/)
    .map((part, i) => (i % 2 === 1 ? part : part.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")))
    .join("");
}

/** The fingerprint of a comment body, or `null` if Steward didn't write it. */
export function fingerprintOf(body: string): string | null {
  return FINGERPRINT_MARKER.exec(body)?.[1] ?? null;
}

const lineText = (code: string, line: number) => (code.split("\n")[line - 1] ?? "").replace(/\r$/, "");

function lineRange(code: string, line: number): { start: number; end: number } {
  let start = 0;
  for (let n = 1; n < line; n++) start = code.indexOf("\n", start) + 1;
  const nl = code.indexOf("\n", start);
  return { start, end: nl === -1 ? code.length : nl };
}

/** True when every edit stays inside the line and adds no new lines: a GitHub suggestion can make it. */
function staysOnLine(f: Finding, range: { start: number; end: number }): boolean {
  const edits = f.fix.edits ?? [];
  return edits.length > 0 && edits.every((e) => e.start >= range.start && e.end <= range.end && !e.text.includes("\n"));
}

const MAX_INLINE_REPLACEMENT = 120;

function findingMarkdown(f: Finding): string {
  const parts = [`${markdown(f.message)}${f.severity === "error" ? " **(required)**" : ""}`];
  let detail = `Why: ${markdown(f.evidence)}. Fix: ${markdown(f.fix.description)}`;
  const r = f.fix.replacement;
  if (!f.fix.edits && r && !r.includes("\n") && r.length <= MAX_INLINE_REPLACEMENT && !r.includes("`")) detail += ` Replace with: \`${r}\``;
  parts.push(`<sub>${detail}</sub>`);
  return parts.join("\n");
}

/**
 * Pure: one comment per line that has findings, token suggestions or notes
 * about `steward-ignore` comments. All the exact fixes on a line go into one
 * `suggestion` block, so two suggestions never clash. A fix that also
 * changes another line (like adding an import) gets advice only.
 */
export function lineComments(result: ReviewResult, files: readonly SourceFile[], options: { pathPrefix?: string } = {}): LineComment[] {
  const code = new Map(files.map((f) => [f.path, f.code]));
  const groups = new Map<string, { file: string; line: number; findings: Finding[]; notes: Note[] }>();
  const groupAt = (file: string, line: number) => {
    const key = `${file}\0${String(line).padStart(8, "0")}`;
    return groups.get(key) ?? groups.set(key, { file, line, findings: [], notes: [] }).get(key)!;
  };
  for (const f of [...result.findings, ...result.tokenSuggestions]) groupAt(f.file ?? "", f.line).findings.push(f);
  for (const n of result.notes) groupAt(n.file ?? "", n.line).notes.push(n);

  const out: LineComment[] = [];
  for (const [, { file, line, findings, notes }] of [...groups].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const source = code.get(file) ?? "";
    const range = lineRange(source, line);
    const original = lineText(source, line);
    const { code: fixedCode, fixed } = applyFixes(source, findings.filter((f) => staysOnLine(f, range)));
    const suggestion = fixed.length > 0 ? lineText(fixedCode, line) : null;

    const items = [...findings.map(findingMarkdown), ...notes.map((n) => markdown(n.message))];
    const parts = [items.length === 1 ? items[0]! : items.map((i) => `- ${i.replace("\n", "\n  ")}`).join("\n")];
    if (suggestion !== null && suggestion !== original) {
      const which = fixed.length === findings.length ? (findings.length === 1 ? "" : " for all of these") : ` for ${fixed.length} of these`;
      const fence = suggestion.includes("```") ? "````" : "```";
      parts.push(`One-click fix${which}:`, [`${fence}suggestion`, suggestion, fence].join("\n"));
    }
    const fingerprint = createHash("sha256")
      .update([file, original.trim(), ...findings.map((f) => `${f.rule}:${f.found}:${f.pattern ? "pattern" : "flag"}`).sort(), ...notes.map((n) => n.message)].join("\n"))
      .digest("hex")
      .slice(0, 16);
    parts.push(`<!-- steward-review:fp=${fingerprint} -->`);
    out.push({
      path: `${options.pathPrefix ?? ""}${file}`,
      line,
      body: `${parts.join("\n\n")}\n`,
      fingerprint,
      oneClick: suggestion !== null && suggestion !== original ? fixed.length : 0,
    });
  }
  return out;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Pure: "Steward Review found 3 off-system values and 1 accessibility issue · 2 can be fixed in one click". */
export function summaryHeadline(result: ReviewResult, oneClick: number): string {
  if (result.files.length === 0) return "Steward Review: no TSX or JSX files changed, so there was nothing to check";
  const a11y = result.findings.filter((f) => f.category === "accessibility").length;
  const system = result.findings.length - a11y;
  const colors = new Set(result.tokenSuggestions.map((f) => f.pattern?.value)).size;
  const tokens = colors > 0 ? ` · ${plural(colors, "color")} could become ${colors === 1 ? "a token" : "tokens"}` : "";
  if (system + a11y === 0) return `Steward Review found nothing to change on the changed lines${tokens}`;
  const found = [system > 0 ? plural(system, "off-system value") : "", a11y > 0 ? plural(a11y, "accessibility issue") : ""].filter(Boolean).join(" and ");
  return `Steward Review found ${found}${oneClick > 0 ? ` · ${oneClick} can be fixed in one click` : ""}${tokens}`;
}

export interface SummaryOptions {
  /** Findings covered by a suggestion block. */
  oneClick: number;
  /** Line comments that couldn't be posted on their line, so the summary lists them instead. */
  unposted?: readonly LineComment[];
  /** Why the line comments couldn't be posted at all, if they couldn't. */
  postingProblem?: string;
}

/** Pure: the body of the one summary comment (also used for the run's summary page). */
export function summaryComment(result: ReviewResult, options: SummaryOptions): string {
  const out = [SUMMARY_MARKER, `### ${summaryHeadline(result, options.oneClick)}`, ""];
  if (result.findings.length > 0) {
    out.push("| What | Found |", "| --- | ---: |");
    for (const rule of RULES) {
      const n = result.findings.filter((f) => f.rule === rule.id).length;
      if (n > 0) out.push(`| ${RULE_LABELS[rule.id]} | ${n} |`);
    }
    out.push("");
    out.push(
      options.oneClick > 0
        ? "Each one has a comment on its line. Where you see a suggested change, **Commit suggestion** applies it."
        : "Each one has a comment on its line, with the reason and a suggested fix.",
      "",
    );
  }
  if (result.tokenSuggestions.length > 0) {
    const byColor = new Map(result.tokenSuggestions.map((f) => [f.pattern!.value, f.pattern!]));
    const colors = [...byColor.values()].map((p) => `\`${p.value}\` (used in ${plural(p.uses, "place")} across ${plural(p.files, "file")})`);
    out.push(`**Could join your system:** ${colors.join(", ")}. Used this often, ${byColor.size === 1 ? "it looks" : "they look"} intentional, so ${byColor.size === 1 ? "it's" : "they're"} suggested as ${byColor.size === 1 ? "a token" : "tokens"} instead of flagged.`, "");
  }
  if (result.exceptions.length > 0) {
    out.push(`**Marked intentional:** ${plural(result.exceptions.length, "flag")}, each with a reason in a \`steward-ignore\` comment. \`steward scan\` records them in system.json.`, "");
  }
  if (result.notes.length > 0) out.push(`${plural(result.notes.length, "note")} about \`steward-ignore\` comments, on ${result.notes.length === 1 ? "its line" : "their lines"}.`, "");
  if (result.scope.kind === "changes") {
    out.push(`Checked ${plural(result.changedLines ?? 0, "changed line")} in ${plural(result.files.length, "file")}, compared with \`${result.scope.base}\`. Older code isn't checked.`, "");
  }
  if (options.postingProblem) out.push(`> ${markdown(options.postingProblem)}`, "");
  if (options.unposted && options.unposted.length > 0) {
    out.push(`<details><summary>${plural(options.unposted.length, "comment")} couldn't be posted on ${options.unposted.length === 1 ? "its line" : "their lines"}</summary>`, "");
    for (const c of options.unposted) out.push(`**${c.path}:${c.line}**`, "", c.body.replace(FINGERPRINT_MARKER, "").trim(), "");
    out.push("</details>", "");
  }
  if (result.unreadable.length > 0) out.push(`Couldn't read as JSX, so not checked: ${result.unreadable.map((u) => `\`${u.path}\``).join(", ")}.`, "");
  if (result.skipped.length > 0) out.push(`Turned off: ${result.skipped.join(", ")}.`, "");
  out.push(
    result.mode === "warn"
      ? "Mode: warn, so this never fails the check."
      : result.failed
        ? "Mode: error, so this check fails until these lines change, or a rule is turned off in `.steward/config.json`."
        : "Mode: error. Nothing was found, so the check passes.",
    "",
    `<sub>${STATIC_CHECKS_NOTE}</sub>`,
  );
  return `${out.join("\n")}\n`;
}
