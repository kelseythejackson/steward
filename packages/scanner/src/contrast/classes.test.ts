import { describe, expect, it } from "vitest";
import { parseClassList, resolveColorName } from "./classes.js";
import { themeColorsFromConfig } from "./theme.js";

describe("resolveColorName", () => {
  it.each([
    ["white", "#ffffff", 1],
    ["black", "#000000", 1],
    ["red-600", "#dc2626", 1],
    ["[#3B82F6]", "#3b82f6", 1],
    ["[rgb(59_130_246)]", "#3b82f6", 1],
    ["[color:#3b82f6]", "#3b82f6", 1],
    ["black/40", "#000000", 0.4],
    ["[#3b82f6]/[0.25]", "#3b82f6", 0.25],
  ])("resolves %s", (name, hex, alpha) => {
    expect(resolveColorName(name)).toEqual({ hex, alpha });
  });

  it("uses theme colors from the Tailwind config", () => {
    expect(resolveColorName("brand", { brand: "#2563eb" })).toEqual({ hex: "#2563eb", alpha: 1 });
  });

  it.each(["sm", "left", "transparent", "current", "inherit", "nope-500", "[13px]"])("returns null for %s", (name) => {
    expect(resolveColorName(name)).toBeNull();
  });
});

describe("parseClassList", () => {
  it("reads text, background and border colors per state", () => {
    const style = parseClassList("bg-[#3b82f6] text-white border border-[#d1d5db] hover:bg-[#2563eb] focus:border-[#3b82f6]");
    expect(style.states.base).toMatchObject({
      bg: { hex: "#3b82f6", alpha: 1 },
      text: { hex: "#ffffff", alpha: 1 },
      border: { hex: "#d1d5db", alpha: 1 },
    });
    expect(style.states.hover).toEqual({ bg: { hex: "#2563eb", alpha: 1 } });
    expect(style.states.focus).toEqual({ border: { hex: "#3b82f6", alpha: 1 } });
  });

  it("tells font sizes apart from text colors", () => {
    const style = parseClassList("text-sm text-[#9ca3af] text-left");
    expect(style.fontSizePx).toBe(14);
    expect(style.states.base?.text?.hex).toBe("#9ca3af");
  });

  it("reads font size and weight, including arbitrary sizes", () => {
    expect(parseClassList("text-2xl font-bold")).toMatchObject({ fontSizePx: 24, fontWeight: 700 });
    expect(parseClassList("text-[22px] font-semibold")).toMatchObject({ fontSizePx: 22, fontWeight: 600 });
  });

  it("treats bg-transparent as no background of its own", () => {
    expect(parseClassList("bg-transparent").states.base?.bg).toBe("transparent");
  });

  it("treats responsive prefixes as the base state and focus-visible as focus", () => {
    const style = parseClassList("md:text-[#111827] focus-visible:text-[#1f2937]");
    expect(style.states.base?.text?.hex).toBe("#111827");
    expect(style.states.focus?.text?.hex).toBe("#1f2937");
  });

  it("ignores dark mode and other variants, and says so", () => {
    const style = parseClassList("dark:text-white disabled:bg-[#eeeeee] group-hover:text-[#111111]");
    expect(style.states).toEqual({});
    expect(style.ignored).toEqual(["dark:text-white", "disabled:bg-[#eeeeee]", "group-hover:text-[#111111]"]);
  });

  it("does not split on colons inside arbitrary values", () => {
    expect(parseClassList("hover:[color:#1f2937]").states.hover?.text).toBeUndefined();
    expect(parseClassList("hover:text-[color:#1f2937]").states.hover?.text?.hex).toBe("#1f2937");
  });

  it("detects a removed outline and focus indicators", () => {
    expect(parseClassList("outline-none focus:border-[#3b82f6]")).toMatchObject({ removesOutline: true, hasFocusIndicator: false });
    expect(parseClassList("focus:outline-none focus:ring-2")).toMatchObject({ removesOutline: true, hasFocusIndicator: true });
    expect(parseClassList("outline-none focus-visible:outline-2")).toMatchObject({ removesOutline: true, hasFocusIndicator: true });
    expect(parseClassList("outline-none focus:ring-0 focus:shadow-none")).toMatchObject({ hasFocusIndicator: false });
    expect(parseClassList("px-4")).toMatchObject({ removesOutline: false });
  });
});

describe("themeColorsFromConfig", () => {
  it("flattens theme colors, including nested scales and DEFAULT", () => {
    const code = `export default { theme: { extend: { colors: {
      brand: "#2563eb",
      ink: { DEFAULT: "#1f2937", 500: "#6b7280", "light": "#f9fafb" },
    } } } };`;
    expect(themeColorsFromConfig(code)).toEqual({
      brand: "#2563eb",
      ink: "#1f2937",
      "ink-500": "#6b7280",
      "ink-light": "#f9fafb",
    });
  });

  it("returns nothing for a config without colors", () => {
    expect(themeColorsFromConfig("export default { content: [] };")).toEqual({});
  });
});
