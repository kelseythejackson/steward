import { compareStrings, type SystemModel } from "@steward/model";
import type { Snippet } from "@steward/guard";

/**
 * Pure: components a person merged away, mapped to the one they kept
 * (`Card` → `Panel`). Comes from accepted component suggestions only.
 */
export function replacedComponents(model: SystemModel): Map<string, string> {
  const accepted = new Set(
    model.decisions.filter((d) => d.kind === "component" && d.status === "accepted").map((d) => d.suggestionId),
  );
  const out = new Map<string, string>();
  const suggestions = model.suggestions
    .filter((s) => s.kind === "component" && accepted.has(s.id))
    .sort((a, b) => compareStrings(a.id, b.id));
  for (const s of suggestions) {
    if (s.kind !== "component") continue;
    for (const member of s.members) if (member !== s.proposed.name) out.set(member, s.proposed.name);
  }
  return out;
}

export interface ReplacedUse {
  line: number;
  column: number;
  found: string;
  keeper: string;
}

/** Pure: JSX uses of a replaced component, such as `<Card>` when the system says `Panel`. */
export function findReplacedUses(snippet: Snippet, replaced: ReadonlyMap<string, string>): ReplacedUse[] {
  const out: ReplacedUse[] = [];
  for (const el of snippet.elements) {
    const keeper = replaced.get(el.name);
    if (keeper) out.push({ line: el.line, column: el.column, found: el.openingTag, keeper });
  }
  return out;
}
