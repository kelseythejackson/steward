import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSystemModel, type MergeDecision } from "@steward/model";
import { describe, expect, it } from "vitest";
import { colorsInModel, NEW_TOKEN_MIN_USES, splitNewColors, suggestNewTokens } from "./colors/new-tokens.js";
import type { ExtractedColor } from "./colors/types.js";

const FIXTURE = fileURLToPath(new URL("../../../fixtures/messy-app", import.meta.url));
const model = parseSystemModel(readFileSync(join(FIXTURE, ".steward/system.json"), "utf8"));

/** A color used `uses` times, as `text-[…]` or `bg-[…]` classes, spread over two files. */
function color(value: string, uses: number, as: "text" | "bg" = "bg", definitions = 0): ExtractedColor {
  const loc = (i: number) => ({ file: `src/${i % 2 === 0 ? "a" : "b"}.tsx`, line: i + 1, raw: value, source: "tailwind-class" as const, snippet: `${as}-[${value}]` });
  return {
    value,
    uses,
    locations: Array.from({ length: uses }, (_, i) => loc(i)),
    definitions: Array.from({ length: definitions }, () => ({ file: "tailwind.config.ts", line: 3, raw: value, source: "tailwind-config" as const, snippet: `brand: "${value}"` })),
  };
}
const decision = (members: string[], status: MergeDecision["status"]): MergeDecision => ({ suggestionId: `token-${members[0]}`, kind: "token", members, status, decidedAt: "2026-11-17T10:00:00.000Z" });

describe("colorsInModel", () => {
  it("lists every token's color, plus the colors merged into them", () => {
    const known = colorsInModel(model.tokens);
    expect(known).toContain("#2563eb");
    expect(known).toEqual([...known].sort());
    expect(colorsInModel({})).toEqual([]);
  });

  it("writes a see-through token the way colors are extracted (#rrggbbaa)", () => {
    expect(colorsInModel(model.tokens)).toContain("#00000066");
  });
});

describe("splitNewColors", () => {
  const colors = [color("#2563eb", 5), color("#7c3aed", 4), color("#ff6b00", 1, "bg", 1)];

  it("on a first scan, holds nothing out", () => {
    expect(splitNewColors(colors, undefined)).toEqual({ kept: colors, held: [] });
  });

  it("on a re-scan, holds out new colors, but not ones defined in the Tailwind config or CSS variables", () => {
    const { kept, held } = splitNewColors(colors, ["#2563eb"]);
    expect(kept.map((c) => c.value)).toEqual(["#2563eb", "#ff6b00"]);
    expect(held.map((c) => c.value)).toEqual(["#7c3aed"]);
  });

  it("keeps a color a person accepted as a token", () => {
    expect(splitNewColors(colors, ["#2563eb"], [decision(["#7c3aed"], "accepted")]).held).toEqual([]);
  });
});

describe("suggestNewTokens", () => {
  it(`suggests a held-out color used in ${NEW_TOKEN_MIN_USES}+ places, with where it's used`, () => {
    const [s, ...rest] = suggestNewTokens([color("#7c3aed", 3), color("#0ea5e9", 2)], []);
    expect(rest).toEqual([]);
    expect(s).toMatchObject({ kind: "token", members: ["#7c3aed"], proposed: { path: "color.purple.600" } });
    expect(s!.proposed.token.$value.hex).toBe("#7c3aed");
    expect(s!.reason).toEqual({ summary: "#7c3aed isn't in your system yet, but it's used 3 times in 2 files, so it may belong there.", evidence: { uses: 3, files: 2, threshold: 3 } });
    expect(s!.locations.map((l) => `${l.file}:${l.line} ${l.value}`)).toEqual(["src/a.tsx:1 bg-[#7c3aed]", "src/a.tsx:3 bg-[#7c3aed]", "src/b.tsx:2 bg-[#7c3aed]"]);
  });

  it("never suggests one a person rejected", () => {
    expect(suggestNewTokens([color("#7c3aed", 5)], [], [decision(["#7c3aed"], "rejected")])).toEqual([]);
  });

  it("picks a path that isn't taken yet", () => {
    expect(suggestNewTokens([color("#7c3aed", 3)], ["color.purple.600"])[0]!.proposed.path).not.toBe("color.purple.600");
  });

  it("checks contrast for a text color, and names the nearest shade that passes", () => {
    const [s] = suggestNewTokens([color("#a78bfa", 3, "text")], []);
    expect(s!.reason.summary).toMatch(/As text on white it's [\d.]+:1, below the 4\.5:1 text needs; for text, #[0-9a-f]{6} \([\d.]+:1\) is the nearest shade that passes\.$/);
    expect(s!.reason.evidence).toMatchObject({ textOnWhite: expect.any(Number), passingShade: expect.stringMatching(/^#[0-9a-f]{6}$/) });
  });

  it("gives the same id for the same color, so a decision sticks across scans", () => {
    expect(suggestNewTokens([color("#7c3aed", 3)], [])[0]!.id).toBe(suggestNewTokens([color("#7c3aed", 9)], [])[0]!.id);
  });
});
