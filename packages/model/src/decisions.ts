import type { DecisionStatus, MergeDecision, Suggestion, SystemModel } from "./types.js";

/** Suggestions nobody has decided on yet, in the model's order. */
export function pendingSuggestions(model: SystemModel): Suggestion[] {
  const decided = new Set(model.decisions.map((d) => d.suggestionId));
  return model.suggestions.filter((s) => !decided.has(s.id));
}

/**
 * Pure: records the same decision on each suggestion and returns the new
 * model. Suggestions that already have a decision are left as decided.
 * Records no person, only what was decided and when.
 */
export function decideSuggestions(model: SystemModel, suggestions: readonly Suggestion[], status: DecisionStatus, decidedAt: string): SystemModel {
  const decided = new Set(model.decisions.map((d) => d.suggestionId));
  const added: MergeDecision[] = [];
  for (const s of suggestions) {
    if (decided.has(s.id)) continue;
    decided.add(s.id);
    added.push({ suggestionId: s.id, kind: s.kind, members: [...s.members], status, decidedAt });
  }
  return { ...model, decisions: [...model.decisions, ...added] };
}
