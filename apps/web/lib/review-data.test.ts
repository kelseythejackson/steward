import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseSystemModel } from "@steward/model";
import { describe, expect, it } from "vitest";
import { nameForMovedColor, reviewData } from "./review-data.ts";

const decided = parseSystemModel(readFileSync(fileURLToPath(new URL("../../../fixtures/messy-app/.steward/system.json", import.meta.url)), "utf8"));
const fresh = { ...decided, decisions: [] };

describe("reviewData", () => {
  it("has a card's worth of each kind, all waiting on a fresh scan", () => {
    const d = reviewData(fresh);
    expect([d.colors.merges.length, d.spacing.snaps.length, d.components.length, d.contrast.length]).toEqual([6, 7, 2, 9]);
    expect(d.waiting).toBe(24);
    expect(reviewData(decided).waiting).toBe(0);
  });

  it("shows colors found in code against the suggested tokens", () => {
    const d = reviewData(fresh);
    expect(d.colors.tokens).toHaveLength(17);
    expect(d.colors.found.length).toBeGreaterThan(d.colors.tokens.length);
    expect(d.colors.tokens.find((t) => t.name === "gray-200")).toEqual({ path: "color.gray.200", name: "gray-200", hex: "#e5e7eb", members: ["#e5e7eb", "#e4e4e7"] });
  });

  it("shows the spacing scale in order, and what snaps where", () => {
    const d = reviewData(fresh);
    expect(d.spacing.scale.map((s) => s.px)).toEqual([4, 8, 10, 12, 16, 24, 32]);
    expect(d.spacing.snaps.find((s) => s.step === 10)).toMatchObject({ values: ["9px"], places: expect.any(Array) });
  });

  it("shows each contrast fix with the numbers", () => {
    const c = reviewData(fresh).contrast[0]!;
    expect(c.ratio).toBeLessThan(c.required);
    expect(c.fix.ratio).toBeGreaterThanOrEqual(c.required === 4.5 ? 4.5 : 3);
  });
});

describe("nameForMovedColor", () => {
  it("suggests a unique name in the same family", () => {
    expect(nameForMovedColor("color.gray.200", "#E4E4E7", [])).toBe("color.gray.e4e4e7");
    expect(nameForMovedColor("color.gray.200", "#e4e4e7", ["color.gray.e4e4e7"])).toBe("color.gray.e4e4e7-2");
    expect(nameForMovedColor("color.white", "#fefefe", [])).toBe("color.fefefe");
  });
});
