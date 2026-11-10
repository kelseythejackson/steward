import { describe, expect, it } from "vitest";
import { extractCssSpacing } from "./css.js";

describe("extractCssSpacing", () => {
  it("reads each value in padding shorthand at the declaration line", () => {
    const css = `.row {\n  border-bottom: 1px solid #e4e4e7;\n  padding: 9px 13px;\n}`;
    expect(extractCssSpacing(css, "s.css")).toEqual([
      { file: "s.css", line: 3, px: 9, raw: "padding: 9px 13px", property: "padding", category: "spacing", source: "css" },
      { file: "s.css", line: 3, px: 13, raw: "padding: 9px 13px", property: "padding", category: "spacing", source: "css" },
    ]);
  });

  it("counts a value repeated in one declaration once", () => {
    expect(extractCssSpacing(`.a { margin: 13px 0 13px; }`, "s.css").map((f) => f.px)).toEqual([13]);
  });

  it("reads margins, gaps and rem, and treats widths as sizes", () => {
    const css = `.a { margin-top: -0.5rem; row-gap: 10px; width: 302px; max-height: 40px; }`;
    expect(extractCssSpacing(css, "s.css").map((f) => [f.property, f.px, f.category])).toEqual([
      ["margin-top", 8, "spacing"],
      ["row-gap", 10, "spacing"],
      ["width", 302, "size"],
      ["max-height", 40, "size"],
    ]);
  });

  it("reads @apply classes", () => {
    expect(extractCssSpacing(`.a { @apply p-[13px] mt-4; }`, "s.css").map((f) => [f.raw, f.px])).toEqual([
      ["p-[13px]", 13],
      ["mt-4", 16],
    ]);
  });

  it("ignores borders, radius, zero, auto, percentages, calc and comments", () => {
    const css = `/* padding: 9px */ .a { border: 1px solid; border-radius: 4px; margin: 0 auto; padding: 5%; gap: calc(1rem + 2px); }`;
    expect(extractCssSpacing(css, "s.css")).toEqual([]);
  });
});
