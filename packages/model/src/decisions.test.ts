import { describe, expect, it } from "vitest";
import { emptySystemModel, suggestionId } from "./canonical.js";
import { decideSuggestions, pendingSuggestions } from "./decisions.js";
import type { ComponentMergeSuggestion, SystemModel } from "./types.js";

const merge = (members: string[]): ComponentMergeSuggestion => ({
  id: suggestionId("component", members),
  kind: "component",
  members,
  proposed: { name: members[0]! },
  reason: { summary: "Alike.", evidence: { shared: 3 } },
});

const a = merge(["Button", "PrimaryBtn"]);
const b = merge(["Card", "Panel"]);
const AT = "2026-11-12T10:00:00.000Z";
const model: SystemModel = {
  ...emptySystemModel(),
  suggestions: [a, b],
  decisions: [{ suggestionId: b.id, kind: "component", members: b.members, status: "rejected", decidedAt: "2026-11-01T00:00:00.000Z" }],
};

describe("pendingSuggestions", () => {
  it("lists only suggestions with no decision", () => {
    expect(pendingSuggestions(model)).toEqual([a]);
  });
});

describe("decideSuggestions", () => {
  it("records a decision for each pending suggestion and leaves earlier decisions as they were", () => {
    const out = decideSuggestions(model, [a, b], "accepted", AT);
    expect(out.decisions).toEqual([
      model.decisions[0],
      { suggestionId: a.id, kind: "component", members: ["Button", "PrimaryBtn"], status: "accepted", decidedAt: AT },
    ]);
    expect(pendingSuggestions(out)).toEqual([]);
  });

  it("doesn't change the model it was given", () => {
    decideSuggestions(model, [a], "accepted", AT);
    expect(model.decisions).toHaveLength(1);
  });
});
