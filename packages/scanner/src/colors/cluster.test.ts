import { describe, expect, it } from "vitest";
import { clusterColors, deltaE } from "./cluster.js";
import type { ExtractedColor } from "./types.js";

/** A color used `uses` times, once per file named f0, f1, ... unless `files` is given. */
export function color(value: string, uses: number, files?: string[]): ExtractedColor {
  const names = files ?? Array.from({ length: uses }, (_, i) => `f${i}.tsx`);
  return {
    value,
    uses,
    locations: Array.from({ length: uses }, (_, i) => ({
      file: names[i % names.length]!,
      line: i + 1,
      raw: value,
      source: "tailwind-class" as const,
      snippet: `bg-[${value}]`,
    })),
    definitions: [],
  };
}

const groupsOf = (colors: ExtractedColor[], maxDeltaE?: number) =>
  clusterColors(colors, maxDeltaE === undefined ? {} : { maxDeltaE }).map((c) => c.members.map((m) => m.value));

describe("deltaE", () => {
  it("is 0 for the same color and symmetric", () => {
    expect(deltaE("#3b82f6", "#3b82f6")).toBe(0);
    expect(deltaE("#3a81f5", "#3b82f6")).toBeCloseTo(deltaE("#3b82f6", "#3a81f5"), 10);
  });

  it("is on the ΔEOK × 100 scale", () => {
    expect(deltaE("#3a81f5", "#3b82f6")).toBeGreaterThan(0.2);
    expect(deltaE("#3a81f5", "#3b82f6")).toBeLessThan(0.5);
    expect(deltaE("#000000", "#ffffff")).toBeCloseTo(100, 0);
  });

  it("never merges colors with different alpha", () => {
    expect(deltaE("#3b82f6", "#3b82f680")).toBe(Infinity);
  });
});

describe("clusterColors", () => {
  it("groups colors under the threshold and keeps the most-used one", () => {
    const [blue] = clusterColors([color("#3a81f5", 3), color("#3b82f6", 7), color("#3b83f7", 2)]);
    expect(blue).toMatchObject({ value: "#3b82f6", uses: 12 });
    expect(blue!.members.map((m) => m.value)).toEqual(["#3b82f6", "#3a81f5", "#3b83f7"]);
    expect(blue!.maxDeltaE).toBeGreaterThan(0);
    expect(blue!.maxDeltaE).toBeLessThan(1);
  });

  it("keeps clearly different shades apart", () => {
    expect(groupsOf([color("#3b82f6", 7), color("#2563eb", 1)])).toEqual([["#3b82f6"], ["#2563eb"]]);
  });

  it("does not chain: every pair in a group is within the threshold", () => {
    // Neighbours are ~1.5–1.8 apart, ends are ~3+ apart.
    const chain = [color("#ffffff", 1), color("#fafafa", 1), color("#f4f4f5", 1), color("#f3f4f6", 1)];
    for (const group of clusterColors(chain, { maxDeltaE: 2 })) {
      for (const a of group.members) for (const b of group.members) expect(deltaE(a.value, b.value)).toBeLessThanOrEqual(2);
    }
  });

  it("respects the threshold option", () => {
    const pair = [color("#fafafa", 2), color("#ffffff", 1)]; // ΔE ≈ 1.49
    expect(groupsOf(pair)).toEqual([["#fafafa"], ["#ffffff"]]);
    expect(groupsOf(pair, 1.5)).toEqual([["#fafafa", "#ffffff"]]);
  });

  it("breaks ties on uses by the lower hex", () => {
    expect(clusterColors([color("#3b83f7", 2), color("#3a81f5", 2)])[0]!.value).toBe("#3a81f5");
  });

  it("counts distinct files across members", () => {
    const [c] = clusterColors([color("#3b82f6", 2, ["a.tsx", "b.tsx"]), color("#3a81f5", 2, ["b.tsx", "c.tsx"])]);
    expect(c!.files).toEqual(["a.tsx", "b.tsx", "c.tsx"]);
  });

  it("gives the same result whatever the input order", () => {
    const input = [color("#6b7380", 3), color("#6b7280", 8), color("#e4e4e7", 3), color("#e5e7eb", 4), color("#111827", 8)];
    expect(clusterColors([...input].reverse())).toEqual(clusterColors(input));
  });

  it("handles no colors", () => {
    expect(clusterColors([])).toEqual([]);
  });
});
