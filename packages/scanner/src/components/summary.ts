import type { ComponentEntry } from "@steward/model";
import type { DuplicateReport } from "./duplicates.js";
import type { ComponentInfo, ComponentInventory } from "./types.js";

/** The inventory as system model entries. */
export function componentEntries(components: readonly ComponentInfo[]): ComponentEntry[] {
  return components.map((c) => ({ name: c.name, filePath: c.file, line: c.line, variants: [...c.variants], props: [...c.props], rootElements: [...c.rootElements] }));
}
