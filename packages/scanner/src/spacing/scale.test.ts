import { describe, expect, it } from "vitest";
import { DEFAULT_SPACING_SCALE, deriveSpacingScale, normalizeScale, snapToScale, spacingTokenPath } from "./scale.js";

describe("snapToScale", () => {
  it("defaults to 8 steps", () => {
    expect(DEFAULT_SPACING_SCALE).toEqual([4, 8, 12, 16, 24, 32, 48, 64]);
  });

  it("leaves values on the scale alone", () => {
    expect(snapToScale(16)).toEqual({ kind: "on-scale", step: 16 });
  });

  it.each([
    [7, 8, 1],
    [13, 12, 1],
    [18, 16, 2],
    [22, 24, 2],
    [2, 4, 2],
  ])("snaps %ipx to the nearest step, %ipx", (px, step, distance) => {
    expect(snapToScale(px)).toEqual({ kind: "snap", step, distance, halfway: false });
  });

  it.each([
    [10, 12],
    [20, 24],
    [28, 32],
    [40, 48],
    [56, 64],
  ])("rounds %ipx, halfway between two steps, up to %ipx", (px, step) => {
    expect(snapToScale(px)).toEqual({ kind: "snap", step, distance: step - px, halfway: true });
  });

  it("doesn't snap values larger than the largest step", () => {
    expect(snapToScale(96)).toEqual({ kind: "beyond-scale" });
  });

  it("works with a custom scale", () => {
    expect(snapToScale(9, [6, 10, 14])).toEqual({ kind: "snap", step: 10, distance: 1, halfway: false });
  });
});

describe("normalizeScale", () => {
  it("sorts and dedupes", () => {
    expect(normalizeScale([16, 4, 8, 8])).toEqual([4, 8, 16]);
  });

  it.each([[[]], [[0, 4]], [[-4, 8]], [[Number.NaN]]])("rejects %j with a plain message", (scale) => {
    expect(() => normalizeScale(scale)).toThrow(/spacing scale needs at least one positive number/);
  });
});

describe("spacingTokenPath", () => {
  it("uses Tailwind's numbering, so p-4 maps to spacing.4", () => {
    expect(DEFAULT_SPACING_SCALE.map(spacingTokenPath)).toEqual([
      "spacing.1", "spacing.2", "spacing.3", "spacing.4", "spacing.6", "spacing.8", "spacing.12", "spacing.16",
    ]);
  });

  it("keeps fractional steps readable without adding a path level", () => {
    expect(spacingTokenPath(10)).toBe("spacing.2_5");
  });
});

describe("deriveSpacingScale", () => {
  const v = (px: number, uses: number) => ({ px, uses });

  it("uses standard Tailwind values used at least twice, smallest first", () => {
    expect(deriveSpacingScale([v(24, 9), v(7, 30), v(8, 2), v(20, 1), v(16, 5)])).toEqual({ scale: [8, 16, 24], basis: "repo" });
  });

  it("never makes drift official, however often it's used", () => {
    expect(deriveSpacingScale([v(7, 100), v(13, 50), v(8, 2), v(16, 2)]).scale).toEqual([8, 16]);
  });

  it("falls back to the default scale when fewer than two values qualify", () => {
    expect(deriveSpacingScale([v(16, 10), v(7, 9)])).toEqual({ scale: [...DEFAULT_SPACING_SCALE], basis: "default" });
    expect(deriveSpacingScale([]).basis).toBe("default");
  });
});
