import type { ComponentEntry } from "@steward/model";
import type { DuplicateReport } from "./duplicates.js";
import type { ComponentInfo, ComponentInventory } from "./types.js";

/** The inventory as system model entries. */
export function componentEntries(components: readonly ComponentInfo[]): ComponentEntry[] {
  return components.map((c) => ({ name: c.name, filePath: c.file, line: c.line, variants: [...c.variants], props: [...c.props], rootElements: [...c.rootElements] }));
}

/** One plain line, e.g. "Found 13 components → 2 groups look like duplicates (5 components). 1 pair looks alike but behaves differently." */
export function summarizeComponents(inventory: ComponentInventory, report: DuplicateReport): string {
  const n = inventory.components.length;
  const g = report.suggestions.length;
  const members = report.suggestions.reduce((k, s) => k + s.members.length, 0);
  let out = `Found ${n} ${n === 1 ? "component" : "components"}`;
  out += g === 0 ? ". None look like duplicates." : ` → ${g} ${g === 1 ? "group looks" : "groups look"} like duplicates (${members} components).`;
  const s = report.similar.length;
  if (s > 0) out += ` ${s} ${s === 1 ? "pair looks" : "pairs look"} alike but ${s === 1 ? "behaves" : "behave"} differently, so ${s === 1 ? "it isn't" : "they aren't"} flagged.`;
  return out;
}
