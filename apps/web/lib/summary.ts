/** Pure: the counts the pages show. Totals only: nothing per person, PR or author. */
import { isToken, pendingSuggestions, type SystemModel, type TokenGroup } from "@steward/model";

function countTokens(group: TokenGroup, type: string): number {
  return Object.entries(group)
    .filter(([k]) => !k.startsWith("$"))
    .reduce((n, [, v]) => n + (v && typeof v === "object" ? (isToken(v) ? (v.$type === type ? 1 : 0) : countTokens(v as TokenGroup, type)) : 0), 0);
}

export function setupSummary(model: SystemModel) {
  return {
    colors: countTokens(model.tokens, "color"),
    spacing: countTokens(model.tokens, "dimension"),
    components: model.components.length,
    waiting: pendingSuggestions(model).length,
    decided: model.decisions.length,
  };
}

export function reviewSummary(model: SystemModel) {
  return {
    rulesOn: model.rules.filter((r) => r.enabled).length,
    rulesOff: model.rules.filter((r) => !r.enabled).length,
    exceptions: model.exceptions.length,
  };
}
