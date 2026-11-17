import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { suggestionId } from "./canonical.js";
import {
  acceptSuggestions,
  colorTokenGroups,
  DecisionError,
  editColorGroups,
  keepComponent,
  leaveSpacingOff,
  pendingSuggestions,
  rejectSuggestions,
  undoDecision,
} from "./decisions.js";
import { parseSystemModel, serializeSystemModel } from "./index.js";
import type { SystemModel } from "./types.js";

const NOW = "2026-11-17T10:00:00.000Z";
/** The fixture's system with no decisions: everything waiting, as right after a first scan. */
const fresh = (): SystemModel => ({ ...parseSystemModel(readFileSync(fileURLToPath(new URL("../../../fixtures/messy-app/.steward/system.json", import.meta.url)), "utf8")), decisions: [] });
const roundTrip = (m: SystemModel) => parseSystemModel(serializeSystemModel(m));

describe("accept, reject and undo", () => {
  it("accepts and rejects by id, and undo puts a suggestion back to waiting", () => {
    const m = fresh();
    const [a, b] = m.suggestions;
    const decided = rejectSuggestions(acceptSuggestions(m, [a!.id], NOW), [b!.id], NOW);
    expect(decided.decisions.map((d) => [d.suggestionId, d.status])).toEqual([
      [a!.id, "accepted"],
      [b!.id, "rejected"],
    ]);
    expect(pendingSuggestions(undoDecision(decided, a!.id)).map((s) => s.id)).toContain(a!.id);
  });

  it("explains a suggestion that's gone, or an undo with nothing to undo", () => {
    expect(() => acceptSuggestions(fresh(), ["color-gone"], NOW)).toThrow(DecisionError);
    expect(() => undoDecision(fresh(), "color-gone")).toThrow(/no decision on that to undo/);
  });
});

describe("colorTokenGroups", () => {
  it("lists each color token with the colors merged into it", () => {
    const g = colorTokenGroups(fresh()).find((t) => t.path === "color.gray.200")!;
    expect(g.members).toEqual(["#e5e7eb", "#e4e4e7"]);
    expect(colorTokenGroups(fresh()).find((t) => t.path === "color.black-40")!.members).toEqual(["#00000066"]);
  });
});

describe("editColorGroups", () => {
  it("records each arranged group as an accepted, edited decision with its name, and survives a write and read", () => {
    const m = editColorGroups(fresh(), [{ members: ["#e5e7eb"], path: "color.gray.200" }, { members: ["#E4E4E7", "#f3f4f6"], path: "color.gray.150" }], NOW);
    const out = roundTrip(m).decisions;
    expect(out).toContainEqual({ suggestionId: suggestionId("color", ["#e4e4e7", "#f3f4f6"]), kind: "color", members: ["#e4e4e7", "#f3f4f6"], status: "accepted", decidedAt: NOW, edited: true, path: "color.gray.150" });
    expect(out).toContainEqual(expect.objectContaining({ members: ["#e5e7eb"], edited: true, path: "color.gray.200" }));
  });

  it("replaces earlier decisions on the same colors", () => {
    const withMerge = acceptSuggestions(fresh(), [fresh().suggestions.find((s) => s.kind === "color" && s.members.includes("#e4e4e7"))!.id], NOW);
    const m = editColorGroups(withMerge, [{ members: ["#e4e4e7"], path: "color.zinc.200" }], NOW);
    expect(m.decisions.filter((d) => d.kind === "color")).toHaveLength(1);
  });

  it.each([
    ["a name that isn't a token name", [{ members: ["#e4e4e7"], path: "Gray 150" }], /isn't a token name Steward can use/],
    ["two groups with one name", [{ members: ["#e4e4e7"], path: "color.gray.150" }, { members: ["#e5e7eb"], path: "color.gray.150" }], /Two groups are both called color\.gray\.150/],
    ["a color in two groups", [{ members: ["#e4e4e7"], path: "color.a" }, { members: ["#e4e4e7"], path: "color.b" }], /#e4e4e7 is in both color\.a and color\.b/],
    ["a name another token already has", [{ members: ["#e4e4e7"], path: "color.gray.900" }], /color\.gray\.900 is already the name of another token/],
    ["an empty group", [{ members: [], path: "color.gray.150" }], /has no colors left/],
  ])("explains %s", (_, groups, message) => {
    expect(() => editColorGroups(fresh(), groups, NOW)).toThrow(message);
  });

  it("refuses an edited decision that isn't a color in system.json", () => {
    const m = fresh();
    m.decisions = [{ suggestionId: "x", kind: "spacing", members: ["9px", "10px"], status: "accepted", decidedAt: NOW, edited: true }];
    expect(() => parseSystemModel(JSON.stringify(m))).toThrow(/decisions\[0\]\.edited/);
  });
});

describe("leaveSpacingOff", () => {
  it("records a rejected snap of those values to the step", () => {
    const s = fresh().suggestions.find((x) => x.kind === "spacing" && x.members.includes("9px"))!;
    const m = leaveSpacingOff(fresh(), s.id, ["9px"], NOW);
    expect(m.decisions).toEqual([{ suggestionId: suggestionId("spacing", ["10px", "9px"]), kind: "spacing", members: ["10px", "9px"], status: "rejected", decidedAt: NOW }]);
  });

  it("only takes values that snap to that step", () => {
    const s = fresh().suggestions.find((x) => x.kind === "spacing" && x.members.includes("9px"))!;
    expect(() => leaveSpacingOff(fresh(), s.id, ["10px"], NOW)).toThrow(/Pick values that would snap to 10px: 9px/);
  });
});

describe("keepComponent", () => {
  const merge = () => fresh().suggestions.find((s) => s.kind === "component" && s.members.includes("Card"))!;

  it("accepts the merge keeping the chosen component, and records keep only when it differs", () => {
    expect(roundTrip(keepComponent(fresh(), merge().id, "Card", NOW)).decisions[0]).toMatchObject({ status: "accepted", keep: "Card" });
    expect(keepComponent(fresh(), merge().id, "Panel", NOW).decisions[0]!.keep).toBeUndefined();
  });

  it("refuses a component that isn't in the group", () => {
    expect(() => keepComponent(fresh(), merge().id, "Button", NOW)).toThrow(/Button isn't in this group/);
  });
});

describe("editColorGroups: names that nest", () => {
  const group = (path: string) => colorTokenGroups(fresh()).find((g) => g.path === path)!;

  it.each([
    ["a name above another token", "color.gray", /color\.gray can't sit beside color\.gray\.\d+: one name can't contain the other/],
    ["a name below another token", "color.gray.900.dark", /color\.gray\.900\.dark can't sit beside color\.gray\.900/],
  ])("refuses %s, since the scan couldn't place both", (_, path, message) => {
    expect(() => editColorGroups(fresh(), [{ members: group("color.gray.500").members, path }], NOW)).toThrow(message);
  });

  it("refuses a name that nests under one a person chose earlier for other colors", () => {
    const chosen = editColorGroups(fresh(), [{ members: ["#e4e4e7"], path: "color.zinc" }], NOW);
    expect(() => editColorGroups(chosen, [{ members: ["#f3f4f6"], path: "color.zinc.100" }], NOW)).toThrow(/can't sit beside color\.zinc/);
  });

  it("refuses two groups in one save whose names nest", () => {
    expect(() => editColorGroups(fresh(), [{ members: ["#e4e4e7"], path: "color.zinc" }, { members: ["#f3f4f6"], path: "color.zinc.100" }], NOW)).toThrow(/color\.zinc and color\.zinc\.100 can't both be names/);
  });

  it("still allows a group to keep or rename its own name", () => {
    expect(() => editColorGroups(fresh(), [{ members: group("color.gray.500").members, path: "color.gray.500" }], NOW)).not.toThrow();
    expect(() => editColorGroups(fresh(), [{ members: group("color.gray.500").members, path: "color.slate.500" }], NOW)).not.toThrow();
  });
});
