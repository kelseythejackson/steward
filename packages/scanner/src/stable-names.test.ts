/** Tokens keep their names across scans, and new colors never get a far, misleading step. */
import { fileURLToPath } from "node:url";
import { colorTokenGroups, rejectSuggestions, type SystemModel } from "@steward/model";
import { beforeAll, describe, expect, it } from "vitest";
import { colorNamesInModel } from "./colors/new-tokens.js";
import { proposeColorPaths } from "./colors/naming.js";
import { suggestColorTokens } from "./colors/suggest.js";
import type { ExtractedColor } from "./colors/types.js";
import { buildSystemModel, scanRepo } from "./scan.js";

const FIXTURE = fileURLToPath(new URL("../../../fixtures/messy-app", import.meta.url));
const NOW = "2026-11-17T10:00:00.000Z";
const tokenOf = (m: SystemModel, hex: string) => colorTokenGroups(m).find((g) => g.members.includes(hex))?.path;

let first: SystemModel;
beforeAll(async () => {
  first = buildSystemModel(await scanRepo(FIXTURE));
});

describe("re-scan after keeping a color merge apart", () => {
  let next: SystemModel;
  beforeAll(async () => {
    const merge = first.suggestions.find((s) => s.kind === "color" && s.members.includes("#e4e4e7"))!;
    const decided = rejectSuggestions(first, [merge.id], NOW);
    next = buildSystemModel(await scanRepo(FIXTURE, { decisions: decided.decisions, colorNames: colorNamesInModel(decided.tokens) }), decided);
  });

  it("keeps every existing token's name and color", () => {
    for (const g of colorTokenGroups(first)) expect(tokenOf(next, g.members[0]!), g.path).toBe(g.path);
    expect(tokenOf(next, "#f9fafb")).toBe("color.gray.50");
    expect(tokenOf(next, "#e5e7eb")).toBe("color.gray.200");
  });

  it("names the color now on its own from its hex, since its nearby steps are taken", () => {
    expect(tokenOf(next, "#e4e4e7")).toBe("color.gray.e4e4e7");
  });
});

describe("previous names", () => {
  /** A gray used `uses` times in one file. */
  const gray = (value: string, uses: number): ExtractedColor => ({
    value,
    uses,
    locations: Array.from({ length: uses }, (_, i) => ({ file: "src/a.tsx", line: i + 1, raw: value, source: "tailwind-class" as const, snippet: `bg-[${value}]` })),
    definitions: [],
  });
  const names = (colors: ExtractedColor[], previousNames?: Map<string, string>) =>
    new Map(suggestColorTokens(colors, previousNames ? { previousNames } : {}).tokens.map((t) => [t.token.$value.hex, t.path]));

  it("stop names swapping when usage shifts: the most-used color would otherwise take the other's step", () => {
    // Two in-between grays (not Tailwind's own, which always keep their palette step), both nearest the 200 step
    // and too far apart to merge (ΔE 2.7). Whichever is used more takes 200.
    const before = names([gray("#e8e9eb", 9), gray("#dfe0e2", 2)]);
    expect(before.get("#e8e9eb")).toBe("color.gray.200");
    // Usage flips. Named from scratch, the two would swap: bg-gray-200 would now mean #d1d5db.
    const after = [gray("#e8e9eb", 2), gray("#dfe0e2", 9)];
    expect(names(after).get("#dfe0e2")).toBe("color.gray.200");
    // With the old names, each color keeps its own.
    expect(names(after, new Map([...before].map(([hex, path]) => [hex, path])))).toEqual(before);
  });

  it("keep a name a token had even when it isn't the name Steward would pick today", () => {
    expect(names([gray("#f9fafb", 3)], new Map([["#f9fafb", "color.surface"]])).get("#f9fafb")).toBe("color.surface");
  });

  it("give way to a name a person chose", () => {
    const decided = [{ suggestionId: "x", kind: "color" as const, members: ["#f9fafb"], status: "accepted" as const, decidedAt: NOW, edited: true as const, path: "color.canvas" }];
    const t = suggestColorTokens([gray("#f9fafb", 3)], { decisions: decided, previousNames: new Map([["#f9fafb", "color.gray.50"]]) }).tokens;
    expect(t.map((x) => x.path)).toEqual(["color.canvas"]);
  });
});

describe("proposeColorPaths", () => {
  it("uses only a color's palette step or its two nearest steps, else its hex", () => {
    // #e4e4e7 is zinc-200: nearest steps 200 and 300 (or 100). With those taken, it gets its hex, not a far step.
    const taken = ["color.gray.100", "color.gray.200", "color.gray.300"];
    expect(proposeColorPaths(["#e4e4e7"], taken).get("#e4e4e7")).toBe("color.gray.e4e4e7");
    expect(proposeColorPaths(["#e4e4e7"]).get("#e4e4e7")).toBe("color.gray.200");
  });

  it("never names a near-white after a dark step", () => {
    const taken = ["color.gray.50", "color.gray.100"];
    const name = proposeColorPaths(["#f9fafb"], taken).get("#f9fafb")!;
    expect(name).not.toMatch(/\.(?:[4-9]00|950)$/);
  });
});
