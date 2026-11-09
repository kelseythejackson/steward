import { describe, expect, it } from "vitest";
import { chooseFix, nearestPassingShade } from "./fix.js";
import { contrastRatio, formatRatio, isLargeText, REQUIRED_RATIO } from "./wcag.js";

describe("wcag helpers", () => {
  it("computes WCAG contrast", () => {
    expect(contrastRatio("#9ca3af", "#ffffff")).toBeCloseTo(2.54, 2);
    expect(contrastRatio("#ffffff", "#9ca3af")).toBeCloseTo(2.54, 2);
  });

  it("has the AA minimums", () => {
    expect(REQUIRED_RATIO).toEqual({ text: 4.5, "large-text": 3, ui: 3 });
  });

  it("rounds down when formatting, so a failing ratio never prints as passing", () => {
    expect(formatRatio(4.49)).toBe("4.4:1");
    expect(formatRatio(2.539)).toBe("2.5:1");
    expect(formatRatio(4.5)).toBe("4.5:1");
  });

  it("knows large text", () => {
    expect(isLargeText(24, 400)).toBe(true);
    expect(isLargeText(20, 700)).toBe(true);
    expect(isLargeText(20, 600)).toBe(false);
    expect(isLargeText(18, 700)).toBe(false);
  });
});

describe("nearestPassingShade", () => {
  it("only changes lightness, keeping the hue", () => {
    const shade = nearestPassingShade("#9ca3af", "#ffffff", 4.5)!;
    expect(shade.ratio).toBeGreaterThanOrEqual(4.5);
    expect(shade.ratio).toBeLessThan(4.7); // the nearest passing shade, not just any dark gray
    expect(contrastRatio(shade.hex, "#ffffff")).toBeGreaterThanOrEqual(4.5); // checked after rounding to hex
  });

  it("goes lighter when that is closer", () => {
    const shade = nearestPassingShade("#3b82f6", "#111827", 7)!;
    expect(shade.ratio).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(shade.hex, "#ffffff")).toBeLessThan(contrastRatio("#3b82f6", "#ffffff"));
  });

  it("returns null when no shade of that hue can pass", () => {
    expect(nearestPassingShade("#777777", "#777777", 21)).toBeNull();
  });
});

describe("chooseFix", () => {
  const tokens = [
    { path: "color.gray.400", hex: "#9ca3af" },
    { path: "color.gray.500", hex: "#6b7280" },
    { path: "color.gray.700", hex: "#374151" },
    { path: "color.gray.50", hex: "#f9fafb" },
    { path: "color.gray.100", hex: "#f3f4f6" },
    { path: "color.blue.500", hex: "#3b82f6" },
    { path: "color.blue.600", hex: "#2563eb" },
    { path: "color.white", hex: "#ffffff" },
  ];

  it("prefers the nearest token in the same family that passes", () => {
    expect(chooseFix("#9ca3af", "#ffffff", 4.5, tokens)).toMatchObject({ replaces: "foreground", hex: "#6b7280", path: "color.gray.500", existing: true });
  });

  it("changes the background when the foreground can't be fixed", () => {
    expect(chooseFix("#ffffff", "#3b82f6", 4.5, tokens)).toMatchObject({ replaces: "background", hex: "#2563eb", path: "color.blue.600" });
  });

  it("picks whichever side needs the smaller change", () => {
    expect(chooseFix("#6b7280", "#f3f4f6", 4.5, tokens)).toMatchObject({ replaces: "background", hex: "#f9fafb" });
  });

  it("computes a shade when no token passes, and names it", () => {
    const fix = chooseFix("#dc2626", "#fef2f2", 4.5, tokens)!;
    expect(fix.existing).toBe(false);
    expect(fix.ratio).toBeGreaterThanOrEqual(4.5);
    expect(fix.path).toMatch(/^color\.(red|gray)\.\d+$/);
    expect(tokens.map((t) => t.path)).not.toContain(fix.path);
  });

  it("only swaps tokens for a color that is itself in the system", () => {
    // #dc2626 isn't a token, so the gray-50 background must not be offered as a swap for red-50.
    const fix = chooseFix("#dc2626", "#fef2f2", 4.5, tokens)!;
    expect(fix.existing).toBe(false);
  });
});
