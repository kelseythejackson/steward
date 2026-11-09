import { describe, expect, it } from "vitest";
import { extractCssContrast } from "./css.js";

describe("extractCssContrast", () => {
  it("pairs color and background set in the same rule, at the color line", () => {
    const css = `body {
  background: #fafafa;
  color: #9ca3af;
}
a { color: #3a81f5; }
.badge { background-color: #3b82f6; color: #fff; }`;
    expect(extractCssContrast(css, "s.css").pairs).toEqual([
      expect.objectContaining({ foreground: "#9ca3af", background: "#fafafa", use: "text", state: "base", line: 3, component: "body", backgroundAssumed: false }),
      expect.objectContaining({ foreground: "#ffffff", background: "#3b82f6", line: 6, component: ".badge" }),
    ]);
  });

  it("finds a rule that follows @tailwind or @import statements", () => {
    const css = `@tailwind base;\n@tailwind utilities;\n\nbody { background: #fafafa; color: #9ca3af; }`;
    expect(extractCssContrast(css, "s.css").pairs).toEqual([expect.objectContaining({ component: "body", line: 4 })]);
  });

  it("treats :hover and :focus rules as states", () => {
    const css = `.x:hover { background: #111827; color: #ffffff; }`;
    expect(extractCssContrast(css, "s.css").pairs[0]).toMatchObject({ state: "hover", component: ".x:hover" });
  });

  it("flags a :focus rule that removes the outline with nothing else", () => {
    const css = `/* comment */
.legacy-input:focus {
  outline: none;
}`;
    expect(extractCssContrast(css, "s.css").focus).toEqual([
      {
        file: "s.css",
        line: 3,
        component: ".legacy-input:focus",
        element: ".legacy-input:focus",
        reason: "This rule removes the focus outline (`outline: none`) and sets no other visible focus style. Add a `box-shadow` or a visible `outline` instead.",
      },
    ]);
  });

  it.each([
    `.a:focus { outline: none; box-shadow: 0 0 0 2px #3b82f6; }`,
    `.a:focus-visible { outline: 0; outline-offset: 2px; outline: 2px solid #3b82f6; }`,
    `.a { outline: none; }`,
  ])("does not flag %s", (css) => {
    expect(extractCssContrast(css, "s.css").focus).toEqual([]);
  });

  it("ignores colors in selectors and comments", () => {
    expect(extractCssContrast(`/* color: #000; background: #fff */ #fade { margin: 0 }`, "s.css").pairs).toEqual([]);
  });
});
