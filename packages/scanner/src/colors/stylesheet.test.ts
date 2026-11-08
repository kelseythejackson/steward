import { describe, expect, it } from "vitest";
import { extractStylesheetColors } from "./stylesheet.js";

const found = (code: string, file = "src/styles.css") =>
  extractStylesheetColors(code, file).map((c) => `${c.line} ${c.value} ${c.snippet}`);

describe("extractStylesheetColors", () => {
  it("finds colors in declarations with the right line", () => {
    const code = "body {\n  background: #FAFAFA;\n  color: rgb(156 163 175);\n}\n";
    expect(found(code)).toEqual(["2 #fafafa background: #FAFAFA", "3 #9ca3af color: rgb(156 163 175)"]);
  });

  it("finds several colors in one declaration and the last one without a semicolon", () => {
    expect(found(".a { border: 1px solid #e5e7eb; box-shadow: 0 0 0 1px #fff, 0 1px 2px rgba(0,0,0,.1) }")).toEqual([
      "1 #e5e7eb border: 1px solid #e5e7eb",
      "1 #ffffff box-shadow: 0 0 0 1px #fff, 0 1px 2px rgba(0,0,0,.1)",
      "1 #0000001a box-shadow: 0 0 0 1px #fff, 0 1px 2px rgba(0,0,0,.1)",
    ]);
  });

  it("ignores selectors that look like colors, and pseudo-classes", () => {
    expect(found("#fade, #add:hover { color: #111827; }")).toEqual(["1 #111827 color: #111827"]);
  });

  it("ignores comments but keeps line numbers right", () => {
    const code = "/* old: #ff0000\n   #00ff00 */\n.a { color: #111827; }";
    expect(found(code)).toEqual(["3 #111827 color: #111827"]);
  });

  it("handles SCSS variables, nesting and line comments", () => {
    const code = "$brand: #3b82f6; // was #2563eb\n.a {\n  &:hover { color: $brand; background: url(http://x.dev/#a); }\n}";
    expect(found(code, "src/a.scss")).toEqual(["1 #3b82f6 $brand: #3b82f6"]);
  });

  it("finds Tailwind arbitrary values in @apply and skips other at-rules", () => {
    const code = '@tailwind base;\n@import url("x.css");\n.btn { @apply px-4 hover:bg-[#2563eb]; }';
    expect(found(code)).toEqual(["3 #2563eb hover:bg-[#2563eb]"]);
  });
});
