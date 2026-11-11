import { STEWARD_EXTENSION, suggestionId, type MergeDecision } from "@steward/model";
import { describe, expect, it } from "vitest";
import { color } from "./cluster.test.js";
import { colorToken, suggestColorTokens } from "./suggest.js";

const blues = () => [color("#3b82f6", 7, ["a.tsx", "b.tsx", "c.tsx"]), color("#3a81f5", 3, ["c.tsx", "d.tsx"]), color("#3b83f7", 2, ["e.css"])];

const rejected = (members: string[], id = suggestionId("color", members)): MergeDecision => ({
  suggestionId: id,
  kind: "color",
  members,
  status: "rejected",
  decidedAt: "2026-11-01T00:00:00.000Z",
});

describe("colorToken", () => {
  it("builds a DTCG sRGB color token with uses and mergedFrom", () => {
    expect(colorToken("#3b82f6", 12, ["#3b83f7", "#3a81f5"])).toEqual({
      $type: "color",
      $value: { colorSpace: "srgb", components: [0.2314, 0.5098, 0.9647], hex: "#3b82f6" },
      $extensions: { [STEWARD_EXTENSION]: { uses: 12, mergedFrom: ["#3a81f5", "#3b83f7"] } },
    });
  });

  it("keeps alpha and leaves out an empty mergedFrom", () => {
    const token = colorToken("#3b82f680", 1);
    expect(token.$value.alpha).toBeCloseTo(0.502, 3);
    expect(token.$value.hex).toBe("#3b82f6");
    expect(token.$extensions?.[STEWARD_EXTENSION]).toEqual({ uses: 1 });
  });
});

describe("suggestColorTokens", () => {
  it("suggests one merge with a plain-English reason and its evidence", () => {
    const { suggestions } = suggestColorTokens(blues());
    expect(suggestions).toHaveLength(1);
    const s = suggestions[0]!;
    expect(s).toMatchObject({
      id: suggestionId("color", ["#3a81f5", "#3b82f6", "#3b83f7"]),
      kind: "color",
      members: ["#3a81f5", "#3b82f6", "#3b83f7"],
      proposed: { path: "color.blue.500" },
    });
    expect(s.proposed.token.$value.hex).toBe("#3b82f6");
    expect(s.reason.summary).toBe("These 3 blues differ by less than you can see (ΔE 0.6). Used 12 times in 5 files.");
    expect(s.reason.evidence).toEqual({ keep: "#3b82f6", maxDeltaE: expect.any(Number), threshold: 1, uses: 12, files: 5 });
  });

  it("uses more careful wording when the difference is visible", () => {
    const { suggestions } = suggestColorTokens([color("#3b82f6", 3), color("#2563eb", 1)], { maxDeltaE: 10 });
    expect(suggestions[0]!.reason.summary).toMatch(/^These 2 blues are very close \(ΔE 8\.2\)\. Used 4 times in 3 files\.$/);
  });

  it("proposes a token for every group, but merges only for groups of two or more", () => {
    const result = suggestColorTokens([...blues(), color("#2563eb", 1)]);
    expect(result.tokens.map((t) => t.path)).toEqual(["color.blue.500", "color.blue.600"]);
    expect(result.suggestions).toHaveLength(1);
  });

  it("never re-suggests a rejected merge, and gives each color its own token instead", () => {
    const decisions = [rejected(["#3b83f7", "#3a81f5", "#3b82f6"])];
    const result = suggestColorTokens(blues(), { decisions });
    expect(result.suggestions).toEqual([]);
    expect(result.tokens.map((t) => t.token.$value.hex)).toEqual(["#3b82f6", "#3a81f5", "#3b83f7"]);
    expect(new Set(result.tokens.map((t) => t.path)).size).toBe(3);
  });

  it("recognises a rejected merge by its members even if the id changed", () => {
    const result = suggestColorTokens(blues(), { decisions: [rejected(["#3a81f5", "#3b82f6", "#3b83f7"], "color-old")] });
    expect(result.suggestions).toEqual([]);
  });

  it("keeps a rejected pair apart for good, even when a new near-duplicate shows up", () => {
    // A person said #3a81f5 and #3b82f6 stay separate. #3b83f7 is close to both: it may join one, never both.
    const result = suggestColorTokens(blues(), { decisions: [rejected(["#3a81f5", "#3b82f6"])] });
    expect(result.suggestions.map((s) => s.members)).toEqual([["#3b82f6", "#3b83f7"]]);
    for (const s of result.suggestions) expect(s.members.includes("#3a81f5") && s.members.includes("#3b82f6")).toBe(false);
  });

  it("ignores accepted decisions when grouping", () => {
    const accepted = { ...rejected(["#3a81f5", "#3b82f6"]), status: "accepted" as const };
    expect(suggestColorTokens(blues(), { decisions: [accepted] }).suggestions.map((s) => s.members)).toEqual([["#3a81f5", "#3b82f6", "#3b83f7"]]);
  });

  it("is deterministic", () => {
    expect(suggestColorTokens([...blues()].reverse())).toEqual(suggestColorTokens(blues()));
  });
});
