import { describe, expect, it } from "vitest";
import { findArbitraryClassColors, findColors, normalizeColor } from "./normalize.js";

describe("normalizeColor", () => {
  it.each([
    ["#3B82F6", "#3b82f6"],
    ["#fff", "#ffffff"],
    ["rgb(59, 130, 246)", "#3b82f6"],
    ["rgb(59 130 246)", "#3b82f6"],
    ["hsl(217 91% 60%)", "#3c83f6"],
    ["rgba(0, 0, 0, 0.5)", "#00000080"],
    ["#3b82f6ff", "#3b82f6"],
  ])("normalizes %s to %s", (raw, expected) => {
    expect(normalizeColor(raw)).toBe(expected);
  });

  it("rejects things that aren't colors", () => {
    expect(normalizeColor("#12345")).toBeNull();
    expect(normalizeColor("#zzz")).toBeNull();
  });
});

describe("findColors", () => {
  it("finds every color and its offset", () => {
    const text = "1px solid #e5e7eb, rgba(0,0,0,.1)";
    expect(findColors(text)).toEqual([
      { raw: "#e5e7eb", value: "#e5e7eb", index: 10 },
      { raw: "rgba(0,0,0,.1)", value: "#0000001a", index: 19 },
    ]);
  });

  it("ignores hex-like text that runs into other characters", () => {
    expect(findColors("#fade-in #abcdefg")).toEqual([]);
  });
});

describe("findArbitraryClassColors", () => {
  const values = (s: string) => findArbitraryClassColors(s).map((m) => [m.className, m.value]);

  it("handles variants, important, opacity modifiers and arbitrary properties", () => {
    expect(values("hover:bg-[#2563eb] md:!text-[#FFF] bg-[#3b82f6]/50 [color:#111827]")).toEqual([
      ["hover:bg-[#2563eb]", "#2563eb"],
      ["md:!text-[#FFF]", "#ffffff"],
      ["bg-[#3b82f6]/50", "#3b82f6"],
      ["[color:#111827]", "#111827"],
    ]);
  });

  it("reads rgb() with Tailwind's underscores for spaces", () => {
    const [m] = findArbitraryClassColors("text-[rgb(59_130_246)]");
    expect(m?.value).toBe("#3b82f6");
    expect(m?.raw).toBe("rgb(59_130_246)");
  });

  it("ignores non-color arbitrary values, urls and prose", () => {
    expect(values("p-[13px] w-[302px] bg-[url(#a)] see [#123] for details")).toEqual([]);
  });

  it("reports the offset of the color inside the string", () => {
    const text = "rounded bg-[#3b82f6]";
    const [m] = findArbitraryClassColors(text);
    expect(text.slice(m!.index, m!.index + 7)).toBe("#3b82f6");
  });
});
