import { STEWARD_EXTENSION, suggestionId, type MergeDecision } from "@steward/model";
import { describe, expect, it } from "vitest";
import { color } from "./cluster.test.js";
import { colorToken, looksSame, suggestColorTokens } from "./suggest.js";

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
    expect(result.preview.map((t) => t.path)).toEqual(["color.blue.500", "color.blue.600"]);
    expect(result.suggestions).toHaveLength(1);
  });

  it("applies a merge only once a person accepts it: until then each color is its own token, and undo splits them again", () => {
    const waiting = suggestColorTokens(blues());
    const id = waiting.suggestions[0]!.id;
    // Waiting: three tokens, each a color found in the code; the merged token is only the suggestion's preview.
    expect(waiting.tokens.map((t) => t.token.$value.hex).sort()).toEqual(["#3a81f5", "#3b82f6", "#3b83f7"]);
    expect(waiting.preview.map((t) => t.path)).toEqual(["color.blue.500"]);
    // Near-duplicates waiting to merge go by their hex, never by a Tailwind step that's a different color.
    expect(waiting.tokens.map((t) => t.path).sort()).toEqual(["color.blue.3a81f5", "color.blue.3b83f7", "color.blue.500"]);
    // Accepted: one token, with the others merged into it.
    const accepted = suggestColorTokens(blues(), { decisions: [{ ...rejected(waiting.suggestions[0]!.members, id), status: "accepted" }] });
    expect(accepted.tokens).toHaveLength(1);
    expect(accepted.tokens[0]!.token.$extensions?.["dev.steward"]?.mergedFrom?.sort()).toEqual(["#3a81f5", "#3b83f7"]);
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

describe("looksSame", () => {
  it("needs both a tiny ΔE and the same color family", () => {
    expect(looksSame("#3a81f5", "#3b82f6")).toBe(true); // ΔE 0.3, both blue
    expect(looksSame("#e4e4e7", "#e5e7eb")).toBe(true); // ΔE 0.8, both gray
    expect(looksSame("#eff6ff", "#f3f4f6")).toBe(false); // ΔE 1.2, but a pale blue next to a gray
    expect(looksSame("#fef2f2", "#f9fafb")).toBe(false); // ΔE 2.0, a pale red next to a gray
    expect(looksSame("#3b82f6", "#2563eb")).toBe(false); // same family, but a visible step apart
  });
});
