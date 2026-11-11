import { describe, expect, it } from "vitest";
import { findNamedClassColors } from "./named.js";
import { extractScriptColors } from "./script.js";
import { extractStylesheetColors } from "./stylesheet.js";

const found = (text: string, theme = {}) => findNamedClassColors(text, theme).map((m) => `${m.className} ${m.value}`);

describe("findNamedClassColors", () => {
  it("finds palette colors on every color utility, with variants and !important", () => {
    expect(found("text-gray-400 hover:bg-white md:focus:border-x-red-500 !ring-blue-500 divide-slate-200 fill-black")).toEqual([
      "text-gray-400 #9ca3af",
      "hover:bg-white #ffffff",
      "md:focus:border-x-red-500 #ef4444",
      "!ring-blue-500 #3b82f6",
      "divide-slate-200 #e2e8f0",
      "fill-black #000000",
    ]);
  });

  it("keeps opacity as an 8-digit hex", () => {
    expect(found("bg-black/40 text-white/[0.5]")).toEqual(["bg-black/40 #00000066", "text-white/[0.5] #ffffff80"]);
  });

  it("resolves theme colors from the Tailwind config", () => {
    expect(found("bg-brand text-ink-500", { brand: "#2563eb", "ink-500": "#6b7280" })).toEqual(["bg-brand #2563eb", "text-ink-500 #6b7280"]);
  });

  it("ignores utilities that aren't colors, arbitrary values and transparent", () => {
    expect(found("text-sm text-center border-2 shadow-lg ring-2 bg-transparent bg-[#fff] text-[13px] outline-none bg-black/0")).toEqual([]);
  });
});

describe("named colors in files", () => {
  it("counts named classes in TSX as tailwind-name uses, alongside arbitrary values", () => {
    const code = `export const A = () => <p className="text-gray-400 bg-[#fafafa] hover:bg-white">x</p>;`;
    expect(extractScriptColors(code, "src/A.tsx").map((c) => `${c.source} ${c.value} ${c.snippet}`)).toEqual([
      "tailwind-class #fafafa bg-[#fafafa]",
      "tailwind-name #9ca3af text-gray-400",
      "tailwind-name #ffffff hover:bg-white",
    ]);
  });

  it("counts named classes in @apply", () => {
    const css = `.btn {\n  @apply bg-blue-600 text-white;\n}`;
    expect(extractStylesheetColors(css, "src/a.css").map((c) => `${c.line} ${c.source} ${c.value}`)).toEqual([
      "2 tailwind-name #2563eb",
      "2 tailwind-name #ffffff",
    ]);
  });
});
