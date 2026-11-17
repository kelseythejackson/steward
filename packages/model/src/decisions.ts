import { compareStrings, isToken, suggestionId } from "./canonical.js";
import { COLOR_PATH } from "./parse.js";
import type { DecisionStatus, MergeDecision, Suggestion, SystemModel, TokenGroup } from "./types.js";

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

/** A decision a person asked for that doesn't fit the system as it is, phrased so they can fix it. */
export class DecisionError extends Error {
  override name = "DecisionError";
}

function byIds(model: SystemModel, ids: readonly string[]): Suggestion[] {
  const out: Suggestion[] = [];
  for (const id of ids) {
    const s = model.suggestions.find((x) => x.id === id);
    if (!s) throw new DecisionError("That suggestion isn't in the system any more. Reload to see the latest.");
    out.push(s);
  }
  return out;
}

/** Pure: accepts these suggestions. Already-decided ones are left as they are. */
export function acceptSuggestions(model: SystemModel, ids: readonly string[], decidedAt: string): SystemModel {
  return decideSuggestions(model, byIds(model, ids), "accepted", decidedAt);
}

/** Pure: rejects these suggestions ("Keep both", "Decline"). Already-decided ones are left as they are. */
export function rejectSuggestions(model: SystemModel, ids: readonly string[], decidedAt: string): SystemModel {
  return decideSuggestions(model, byIds(model, ids), "rejected", decidedAt);
}

/** Pure: undoes a decision by removing it, so the suggestion is waiting again. Every decision can be undone. */
export function undoDecision(model: SystemModel, suggestionId: string): SystemModel {
  if (!model.decisions.some((d) => d.suggestionId === suggestionId)) throw new DecisionError("There's no decision on that to undo.");
  return { ...model, decisions: model.decisions.filter((d) => d.suggestionId !== suggestionId) };
}

/** Every color token's path and the colors it stands for (its own value and those merged into it). */
export function colorTokenGroups(model: SystemModel): { path: string; members: string[] }[] {
  const out: { path: string; members: string[] }[] = [];
  const walk = (group: TokenGroup, at: string[]) => {
    for (const [k, v] of Object.entries(group)) {
      if (k.startsWith("$") || !v || typeof v !== "object") continue;
      if (isToken(v)) {
        if (v.$type !== "color") continue;
        const { hex, alpha } = v.$value;
        const own = alpha === undefined || alpha >= 1 ? hex : `${hex}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`;
        const merged = v.$extensions?.["dev.steward"]?.mergedFrom ?? [];
        out.push({ path: [...at, k].join("."), members: [own, ...merged].map((m) => m.toLowerCase()) });
      } else {
        walk(v as TokenGroup, [...at, k]);
      }
    }
  };
  walk(model.tokens, []);
  return out.sort((a, b) => compareStrings(a.path, b.path));
}

export interface ColorGroupEdit {
  /** The colors in the group, as hex. One color is fine: it stays its own token. */
  members: readonly string[];
  /** The token's name, e.g. `color.gray.150`. */
  path: string;
}

/**
 * Pure: records color groups a person arranged (moved swatches, renamed
 * tokens) as accepted, edited decisions. Scans keep each group exactly
 * so, under its name. Earlier color decisions on any of these colors are
 * replaced, since the person has now decided them again.
 */
export function editColorGroups(model: SystemModel, groups: readonly ColorGroupEdit[], decidedAt: string): SystemModel {
  if (groups.length === 0) throw new DecisionError("There's nothing to save: no group changed.");
  const seen = new Map<string, string>();
  const paths = new Set<string>();
  const normalized = groups.map((g) => ({ members: [...new Set(g.members.map((m) => m.toLowerCase()))].sort(compareStrings), path: g.path.trim() }));
  for (const g of normalized) {
    if (g.members.length === 0) throw new DecisionError(`${g.path} has no colors left. Move a color into it, or leave it out.`);
    if (!COLOR_PATH.test(g.path)) {
      throw new DecisionError(`"${g.path}" isn't a token name Steward can use. Use lowercase words and numbers after "color.", like color.gray.150.`);
    }
    if (paths.has(g.path)) throw new DecisionError(`Two groups are both called ${g.path}. Give each its own name.`);
    paths.add(g.path);
    for (const m of g.members) {
      const other = seen.get(m);
      if (other) throw new DecisionError(`${m} is in both ${other} and ${g.path}. A color can be in one group only.`);
      seen.set(m, g.path);
    }
  }
  // A name already used by a token these groups don't touch would clash.
  for (const t of colorTokenGroups(model)) {
    if (paths.has(t.path) && !t.members.some((m) => seen.has(m))) throw new DecisionError(`${t.path} is already the name of another token. Pick a different name.`);
  }

  const touched = (d: MergeDecision) => d.kind === "color" && d.members.some((m) => seen.has(m.toLowerCase()));
  const added: MergeDecision[] = normalized.map((g) => ({
    suggestionId: suggestionId("color", g.members),
    kind: "color",
    members: g.members,
    status: "accepted",
    decidedAt,
    edited: true,
    path: g.path,
  }));
  return { ...model, decisions: [...model.decisions.filter((d) => !touched(d)), ...added] };
}

/**
 * Pure: leaves spacing values off a snap ("keep 13px as it is"). Recorded
 * as a rejected snap of those values to the step, so scans never suggest
 * snapping them again; Review still flags them as off the scale.
 */
export function leaveSpacingOff(model: SystemModel, id: string, values: readonly string[], decidedAt: string): SystemModel {
  const [s] = byIds(model, [id]);
  if (s!.kind !== "spacing") throw new DecisionError("Only spacing values can be left off a snap.");
  const step = `${s!.proposed.token.$value.value}px`;
  const off = [...new Set(values)].sort(compareStrings);
  if (off.length === 0 || off.some((v) => v === step || !s!.members.includes(v))) {
    throw new DecisionError(`Pick values that would snap to ${step}: ${s!.members.filter((m) => m !== step).join(", ")}.`);
  }
  const members = [...off, step].sort(compareStrings);
  const decision: MergeDecision = { suggestionId: suggestionId("spacing", members), kind: "spacing", members, status: "rejected", decidedAt };
  return { ...model, decisions: [...model.decisions.filter((d) => d.suggestionId !== decision.suggestionId), decision] };
}

/** Pure: accepts a component merge, keeping the one the person chose instead of the suggested one. */
export function keepComponent(model: SystemModel, id: string, keep: string, decidedAt: string): SystemModel {
  const [s] = byIds(model, [id]);
  if (s!.kind !== "component") throw new DecisionError("Only component merges have a component to keep.");
  if (!s!.members.includes(keep)) throw new DecisionError(`${keep} isn't in this group. Pick one of ${s!.members.join(", ")}.`);
  const decision: MergeDecision = { suggestionId: s!.id, kind: "component", members: [...s!.members], status: "accepted", decidedAt };
  if (keep !== s!.proposed.name) decision.keep = keep;
  return { ...model, decisions: [...model.decisions.filter((d) => d.suggestionId !== s!.id), decision] };
}
