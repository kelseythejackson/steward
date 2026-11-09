import { describe, expect, it } from "vitest";
import { colorFamily, proposeColorPaths } from "./naming.js";

describe("colorFamily", () => {
  it.each([
    ["#9ca3af", "gray"],
    ["#374151", "gray"],
    ["#334155", "gray"], // slate is still a gray
    ["#111827", "gray"],
    ["#3b82f6", "blue"],
    ["#2563eb", "blue"],
    ["#ef4444", "red"],
    ["#22c55e", "green"],
    ["#a855f7", "purple"],
    ["#ffffff", "white"],
    ["#000000", "black"],
  ])("%s is %s", (hex, family) => {
    expect(colorFamily(hex)).toBe(family);
  });
});

describe("proposeColorPaths", () => {
  it("names Tailwind's own grays after their Tailwind step", () => {
    const grays = ["#f9fafb", "#f3f4f6", "#e5e7eb", "#d1d5db", "#9ca3af", "#6b7280", "#374151", "#1f2937", "#111827"];
    expect([...proposeColorPaths(grays).values()]).toEqual([
      "color.gray.50",
      "color.gray.100",
      "color.gray.200",
      "color.gray.300",
      "color.gray.400",
      "color.gray.500",
      "color.gray.700",
      "color.gray.800",
      "color.gray.900",
    ]);
  });

  it("gives the first color the best step and moves a clash to the nearest free one", () => {
    const paths = proposeColorPaths(["#3b82f6", "#2563eb"]);
    expect(paths.get("#3b82f6")).toBe("color.blue.500");
    expect(paths.get("#2563eb")).toBe("color.blue.600");
  });

  it("names white and black without a step", () => {
    const paths = proposeColorPaths(["#ffffff", "#000000"]);
    expect([...paths.values()]).toEqual(["color.white", "color.black"]);
  });

  it("always returns unique paths", () => {
    const many = Array.from({ length: 14 }, (_, i) => `#${(0x60 + i).toString(16).repeat(3)}`);
    const paths = [...proposeColorPaths(many).values()];
    expect(new Set(paths).size).toBe(many.length);
  });
});
