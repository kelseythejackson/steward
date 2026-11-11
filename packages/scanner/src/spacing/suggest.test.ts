import { suggestionId, type MergeDecision } from "@steward/model";
import { describe, expect, it } from "vitest";
import { collectSpacing } from "./collect.js";
import { suggestSpacingScale } from "./suggest.js";

const files = [
  {
    path: "src/Card.tsx",
    content: `export const Card = () => (
  <div className="p-[13px] mt-[7px]">
    <p className="mb-[7px] mt-2 h-[42px]" />
  </div>
);`,
  },
  { path: "src/List.tsx", content: `export const L = () => <ul className="gap-[10px] py-[9px] p-3 py-24" />;` },
  { path: "src/styles.css", content: `.row {\n  padding: 9px 13px;\n}` },
];

describe("collectSpacing", () => {
  it("groups values by px with every location, sizes kept apart", () => {
    const r = collectSpacing(files);
    expect(r.values.map((v) => [v.px, v.uses])).toEqual([[7, 2], [8, 1], [9, 2], [10, 1], [12, 1], [13, 2], [96, 1]]);
    expect(r.sizes.map((v) => [v.px, v.uses])).toEqual([[42, 1]]);
    expect(r.values.find((v) => v.px === 13)?.locations).toEqual([
      { file: "src/Card.tsx", line: 2, raw: "p-[13px]", property: "p", source: "tailwind-class" },
      { file: "src/styles.css", line: 2, raw: "padding: 9px 13px", property: "padding", source: "css" },
    ]);
    expect(r.filesScanned).toBe(3);
  });

  it("lists files it can't parse instead of stopping", () => {
    const r = collectSpacing([{ path: "src/Bad.tsx", content: "export const = <div" }]);
    expect(r.skipped).toEqual([{ file: "src/Bad.tsx", reason: expect.any(String) }]);
  });
});

describe("suggestSpacingScale", () => {
  const values = () => collectSpacing(files).values;

  it("proposes the scale as tokens with Tailwind numbering and usage", () => {
    const r = suggestSpacingScale(values());
    expect(r.tokens.map((t) => [t.path, t.token.$value.value])).toEqual([
      ["spacing.1", 4], ["spacing.2", 8], ["spacing.3", 12], ["spacing.4", 16],
      ["spacing.6", 24], ["spacing.8", 32], ["spacing.12", 48], ["spacing.16", 64],
    ]);
    const eight = r.tokens.find((t) => t.path === "spacing.2")!.token;
    expect(eight).toEqual({
      $type: "dimension",
      $value: { value: 8, unit: "px" },
      $extensions: { "dev.steward": { uses: 5, mergedFrom: ["7px", "9px"] } },
    });
  });

  it("makes one suggestion per step, listing the values that snap and where they're used", () => {
    const r = suggestSpacingScale(values());
    expect(r.suggestions.map((s) => s.proposed.path)).toEqual(["spacing.2", "spacing.3"]);
    const eight = r.suggestions[0]!;
    expect(eight).toMatchObject({
      id: suggestionId("spacing", ["7px", "9px", "8px"]),
      kind: "spacing",
      members: ["7px", "8px", "9px"],
    });
    expect(eight.reason.summary).toBe(
      "7px and 9px are 1px from 8px, the nearest step on the scale. Used 4 times in 3 files. 8px is already used once.",
    );
    expect(eight.reason.evidence).toEqual({ step: 8, maxDistance: 1, uses: 4, files: 3, alreadyUsed: 1 });
    expect(eight.locations).toEqual([
      { file: "src/Card.tsx", line: 2, value: "mt-[7px]" },
      { file: "src/Card.tsx", line: 3, value: "mb-[7px]" },
      { file: "src/List.tsx", line: 1, value: "py-[9px]" },
      { file: "src/styles.css", line: 2, value: "padding: 9px 13px" },
    ]);
  });

  it("explains a value halfway between two steps", () => {
    const twelve = suggestSpacingScale(values()).suggestions[1]!;
    expect(twelve.members).toEqual(["10px", "12px", "13px"]);
    expect(twelve.reason.summary).toBe(
      "10px and 13px are 1–2px from 12px, the nearest step on the scale. 10px is halfway between 8px and 12px, so it rounds up to the larger step. " +
        "Used 3 times in 3 files. 12px is already used once.",
    );
  });

  it("phrases a single value and a step nobody uses yet", () => {
    const r = suggestSpacingScale(collectSpacing([{ path: "a.tsx", content: `<i className="mt-[22px]" />` }]).values);
    expect(r.suggestions[0]?.reason.summary).toBe("22px is 2px from 24px, the nearest step on the scale. Used once in 1 file.");
  });

  it("doesn't snap values larger than the scale, and says so", () => {
    const r = suggestSpacingScale(values());
    expect(r.beyondScale.map((v) => v.px)).toEqual([96]);
    expect(r.suggestions.flatMap((s) => s.members)).not.toContain("96px");
  });

  it("does not re-suggest a rejected snap; those values stay as they are", () => {
    const decisions: MergeDecision[] = [
      { suggestionId: suggestionId("spacing", ["7px", "8px", "9px"]), kind: "spacing", members: ["9px", "8px", "7px"], status: "rejected", decidedAt: "2026-11-01T00:00:00.000Z" },
    ];
    const r = suggestSpacingScale(values(), { decisions });
    expect(r.suggestions.map((s) => s.proposed.path)).toEqual(["spacing.3"]);
    expect(r.kept.map((v) => v.px)).toEqual([7, 9]);
    expect(r.tokens.find((t) => t.path === "spacing.2")!.token.$extensions).toEqual({ "dev.steward": { uses: 1 } });
  });

  it("keeps rejected values off a step even when a new value starts snapping to it", () => {
    const decisions: MergeDecision[] = [
      { suggestionId: suggestionId("spacing", ["7px", "8px", "9px"]), kind: "spacing", members: ["7px", "8px", "9px"], status: "rejected", decidedAt: "2026-11-01T00:00:00.000Z" },
    ];
    const later = [...collectSpacing(files).values, { px: 6.5, uses: 1, locations: [{ file: "src/New.tsx", line: 1, raw: "p-[6.5px]", property: "p", source: "tailwind-class" as const }] }];
    const r = suggestSpacingScale(later, { decisions });
    expect(r.suggestions.find((s) => s.proposed.path === "spacing.2")?.members).toEqual(["6.5px", "8px"]);
    expect(r.kept.map((v) => v.px)).toEqual([7, 9]);
  });

  it("takes a custom scale", () => {
    const r = suggestSpacingScale(values(), { scale: [6, 10, 14] });
    expect(r.scale).toEqual([6, 10, 14]);
    expect(r.suggestions.map((s) => s.members)).toEqual([["7px", "6px"].sort(), ["10px", "8px", "9px"], ["12px", "13px", "14px"]]);
  });

  it("is deterministic", () => {
    const a = suggestSpacingScale(collectSpacing([...files].reverse()).values);
    expect(a).toEqual(suggestSpacingScale(values()));
  });
});
