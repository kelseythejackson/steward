import { describe, expect, it } from "vitest";
import { extractStylesheetColors } from "./colors/stylesheet.js";
import { extractCssContrast } from "./contrast/css.js";
import { parseCss, resolveNested } from "./css.js";
import { extractCssSpacing } from "./spacing/css.js";
import { rootFontSize } from "./tailwind.js";

const decls = (code: string, scss = false) => parseCss(code, scss).map((r) => [r.selector, r.declarations.map((d) => `${d.prop}: ${d.value}`)]);

describe("parseCss", () => {
  it("keeps ; and braces inside strings and url(data:…) in one declaration", () => {
    const code = `.a { background: url("data:image/svg+xml;utf8,<svg>{}</svg>"); content: "a;b}"; color: #111827; }`;
    expect(decls(code)).toEqual([[".a", ['background: url("data:image/svg+xml;utf8,<svg>{}</svg>")', 'content: "a;b}"', "color: #111827"]]]);
  });

  it("resolves SCSS nesting, & and comma selectors, keeping declarations on both sides of a nested rule", () => {
    const code = `.card, .panel {\n  color: #111;\n  .title { color: #222; }\n  &:hover, &.active { color: #333; }\n  background: #fff;\n}`;
    expect(decls(code, true)).toEqual([
      [".card, .panel", ["color: #111", "background: #fff"]],
      [".card .title, .panel .title", ["color: #222"]],
      [".card:hover, .card.active, .panel:hover, .panel.active", ["color: #333"]],
    ]);
  });

  it("records enclosing at-rules and reads declarations straight inside them", () => {
    const rules = parseCss(`@theme inline { --color-brand: #2563eb; }\n@media (min-width: 640px) { .a { color: red; } }`);
    expect(rules.map((r) => [r.selector, r.atRules, r.declarations.map((d) => d.prop)])).toEqual([
      ["", ["@theme inline"], ["--color-brand"]],
      [".a", ["@media (min-width: 640px)"], ["color"]],
    ]);
  });

  it("reads @apply and SCSS variables, and skips other at-rule statements", () => {
    expect(decls(`$brand: #3b82f6;\n@import "x;y.css";\n.btn { @apply px-4 bg-white; @include focus-ring; }`, true)).toEqual([
      ["", ["$brand: #3b82f6"]],
      [".btn", ["@apply: px-4 bg-white"]],
    ]);
  });

  it("resolves & in compound positions", () => {
    expect(resolveNested(".btn", ".group:hover &")).toBe(".group:hover .btn");
    expect(resolveNested("", "a, b")).toBe("a, b");
  });
});

describe("stylesheet readers on tricky CSS", () => {
  const css = `.hero {\n  background: url("data:image/svg+xml;utf8,<svg fill='#ff0000'/>");\n  color: #111827;\n  padding: 13px;\n  &:focus { outline: none; }\n}`;

  it("doesn't count colors inside url(…) or lose the declarations after it", () => {
    expect(extractStylesheetColors(css, "a.scss").map((c) => `${c.line} ${c.value}`)).toEqual(["3 #111827"]);
    expect(extractCssSpacing(css, "a.scss").map((s) => `${s.line} ${s.px}`)).toEqual(["4 13"]);
  });

  it("checks nested focus rules under their full selector", () => {
    expect(extractCssContrast(css, "a.scss").focus.map((f) => `${f.line} ${f.element}`)).toEqual(["5 .hero:focus"]);
  });
});

describe("rootFontSize", () => {
  it("reads px, % and rem on html or :root, ignoring @media", () => {
    expect(rootFontSize("html { font-size: 62.5%; }")).toBe(10);
    expect(rootFontSize(":root { font-size: 18px }")).toBe(18);
    expect(rootFontSize("html, body { font-size: 1.125rem; }")).toBe(18);
    expect(rootFontSize("@media (min-width: 1200px) { html { font-size: 20px; } }")).toBeNull();
    expect(rootFontSize("body { font-size: 14px; }")).toBeNull();
  });
});
