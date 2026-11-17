/** Where each top source of drift can be fixed, and its plain-English name. Server-side (reads Review's rule names). */
import { RULE_LABELS, type RuleId } from "@steward/guard";
import { DRIFT_RULES, type MainSource } from "./health.ts";

export const ruleLabel = (rule: string) => RULE_LABELS[rule as RuleId] ?? rule;

const SETUP_CARD: Readonly<Record<string, { href: string; label: string }>> = {
  "no-hardcoded-color": { href: "/setup#colors", label: "Review colors on Setup" },
  "no-arbitrary-spacing": { href: "/setup#spacing", label: "Review the spacing scale" },
  "use-system-component": { href: "/setup#components", label: "Review components on Setup" },
};

/**
 * The fix for a source of drift. Mostly from AI agents: tell the AI tools
 * better (Brief). Otherwise the matching Setup card, or the rule's
 * explanation and fix on the Review page for accessibility.
 */
export function fixFor(rule: string, mainSource: MainSource): { href: string; label: string } {
  if (DRIFT_RULES.includes(rule)) return mainSource === "ai-agent" ? { href: "/brief", label: "Strengthen what AI tools are told" } : SETUP_CARD[rule]!;
  return { href: `/review#${rule}`, label: "How to fix" };
}
