import { describe, expect, it } from "vitest";
import { classPattern, classPatterns, patternOverlap } from "./patterns.js";

describe("classPattern", () => {
  it.each([
    ["rounded-lg", "rounded"],
    ["rounded-xl", "rounded"],
    ["rounded", "rounded"],
    ["rounded-full", "rounded"],
    ["p-6", "p"],
    ["p-[13px]", "p"],
    ["px-2.5", "px"],
    ["bg-white", "bg-color"],
    ["bg-[#3b82f6]", "bg-color"],
    ["bg-black/40", "bg-color"],
    ["border-[#e5e7eb]", "border-color"],
    ["border-gray-200", "border-color"],
    ["border", "border"],
    ["border-b", "border-b"],
    ["text-sm", "text-size"],
    ["text-[13px]", "text-size"],
    ["text-[#374151]", "text-color"],
    ["font-semibold", "font-weight"],
    ["font-medium", "font-weight"],
    ["shadow-sm", "shadow"],
    ["shadow-2xl", "shadow"],
    ["z-40", "z"],
    ["max-w-md", "max-w"],
    ["w-full", "w"],
    ["inset-0", "inset"],
    ["hover:bg-[#2563eb]", "hover:bg-color"],
    ["disabled:opacity-50", "disabled:opacity"],
    ["items-center", "items-center"],
    ["inline-flex", "inline-flex"],
    ["-mt-2", "mt"],
  ])("%s → %s", (cls, pattern) => {
    expect(classPattern(cls)).toBe(pattern);
  });
});

describe("patternOverlap", () => {
  it("is shared patterns over all patterns", () => {
    const card = classPatterns("rounded-lg border border-[#e5e7eb] bg-white p-6 shadow-sm");
    const panel = classPatterns("rounded-xl border border-[#e4e4e7] bg-white p-[13px] shadow-sm");
    expect(patternOverlap(card, panel)).toBe(1);
    expect(patternOverlap(classPatterns("flex p-4"), classPatterns("flex m-4"))).toBeCloseTo(1 / 3);
  });

  it("is 0 when either side has no classes, so two bare <div>s don't count as matching", () => {
    expect(patternOverlap([], [])).toBe(0);
    expect(patternOverlap(["p"], [])).toBe(0);
  });
});
