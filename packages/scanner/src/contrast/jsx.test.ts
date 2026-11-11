import { describe, expect, it } from "vitest";
import { extractJsxContrast, SKIP_TOO_MANY, SKIP_VARIANTS } from "./jsx.js";
import type { PairOccurrence } from "./types.js";

const pairs = (code: string) =>
  extractJsxContrast(code, "x.tsx").pairs.map((p: PairOccurrence) => ({
    fg: p.foreground,
    bg: p.background,
    use: p.use,
    state: p.state,
    line: p.line,
    assumed: p.backgroundAssumed,
  }));

describe("extractJsxContrast: pairs", () => {
  it("pairs an element's text color with its own background", () => {
    expect(pairs(`const A = () => <p className="bg-[#f3f4f6] text-[#6b7280]">Hi</p>;`)).toEqual([
      { fg: "#6b7280", bg: "#f3f4f6", use: "text", state: "base", line: 1, assumed: false },
    ]);
  });

  it("uses the nearest ancestor background, and assumes white when there is none", () => {
    const code = `const A = () => (
      <div className="bg-[#f3f4f6]">
        <section>
          <p className="text-[#6b7280]">Hi</p>
        </section>
      </div>
    );
    const B = () => <p className="text-[#6b7280]">Hi</p>;`;
    expect(pairs(code)).toEqual([
      { fg: "#6b7280", bg: "#f3f4f6", use: "text", state: "base", line: 4, assumed: false },
      { fg: "#6b7280", bg: "#ffffff", use: "text", state: "base", line: 8, assumed: true },
    ]);
  });

  it("inherits the text color from an ancestor for elements that hold text", () => {
    const code = `const A = () => (
      <ul className="text-[#9ca3af]">
        <li><span>one</span></li>
      </ul>
    );`;
    expect(pairs(code)).toEqual([{ fg: "#9ca3af", bg: "#ffffff", use: "text", state: "base", line: 3, assumed: true }]);
  });

  it("only checks elements that hold text, an expression, or a form value", () => {
    const code = `const A = ({ children }) => (
      <div className="bg-white text-[#9ca3af]">
        <Other />
        {open && <Other />}
        <div className="text-[#6b7280]">{children}</div>
        <input className="text-[#111827]" />
      </div>
    );`;
    expect(pairs(code).map((p) => [p.fg, p.line])).toEqual([
      ["#6b7280", 5],
      ["#111827", 6],
    ]);
  });

  it("checks hover and focus states on top of the base state", () => {
    const code = `const A = () => <button className="text-[#6b7280] hover:text-[#1f2937] hover:bg-[#f3f4f6]">Go</button>;`;
    expect(pairs(code).map((p) => [p.state, p.fg, p.bg])).toEqual([
      ["base", "#6b7280", "#ffffff"],
      ["hover", "#1f2937", "#f3f4f6"],
    ]);
  });

  it("marks large text: 24px+, or 20px+ bold, including inherited size", () => {
    const code = `const A = () => (
      <div>
        <h1 className="text-2xl text-[#9ca3af]">Big</h1>
        <p className="text-xl font-bold text-[#9ca3af]">Bold</p>
        <p className="text-xl font-semibold text-[#9ca3af]">Semibold</p>
        <div className="text-3xl"><span className="text-[#9ca3af]">Inherited</span></div>
      </div>
    );`;
    expect(pairs(code).map((p) => p.use)).toEqual(["large-text", "large-text", "text", "large-text"]);
  });

  it("checks an icon-only element as a UI graphic", () => {
    const code = `const A = () => <button className="text-[#9ca3af]"><svg><path d="M0 0" /></svg></button>;`;
    expect(pairs(code)).toEqual([{ fg: "#9ca3af", bg: "#ffffff", use: "ui", state: "base", line: 1, assumed: true }]);
  });

  it("checks form control borders against the background behind them", () => {
    const code = `const A = () => (
      <div className="bg-[#f9fafb]">
        <input className="border border-[#d1d5db] bg-white text-[#111827] focus:border-[#3b82f6]" />
      </div>
    );`;
    const ui = pairs(code).filter((p) => p.use === "ui");
    expect(ui).toEqual([
      { fg: "#d1d5db", bg: "#f9fafb", use: "ui", state: "base", line: 3, assumed: false },
      { fg: "#3b82f6", bg: "#f9fafb", use: "ui", state: "focus", line: 3, assumed: false },
    ]);
  });

  it("does not check button borders (the label identifies the button)", () => {
    const code = `const A = () => <button className="border border-red-300 text-red-600">Delete</button>;`;
    expect(pairs(code).map((p) => p.use)).toEqual(["text"]);
  });

  it("resolves class maps, constants, conditionals and cn() objects in the same file", () => {
    const code = `
      const variants = { primary: "bg-[#3b82f6] text-white", ghost: "text-[#6b7280]" };
      const sizing = big ? "text-base" : "text-sm";
      const base = \`rounded \${sizing} bg-[#111827]\`;
      export function Button({ variant, active, className = "" }) {
        return (
          <>
            <button className={\`px-4 \${variants[variant]} \${className}\`}>a</button>
            <a className={base}><span className="text-white">b</span></a>
            <button className={cn("text-sm", { "text-[#3b82f6]": active, "text-[#9ca3af]": !active })}>c</button>
          </>
        );
      }`;
    const found = pairs(code).map((p) => `${p.fg} on ${p.bg}`);
    expect(found).toEqual([
      "#ffffff on #3b82f6",
      "#6b7280 on #ffffff",
      "#ffffff on #111827",
      "#3b82f6 on #ffffff",
      "#9ca3af on #ffffff",
    ]);
  });

  it("reads color and background from inline style objects", () => {
    const code = `const A = () => <p style={{ color: "#9ca3af", backgroundColor: "#ffffff" }}>Hi</p>;`;
    expect(pairs(code)).toEqual([{ fg: "#9ca3af", bg: "#ffffff", use: "text", state: "base", line: 1, assumed: false }]);
  });

  it("points at the className line when the element spans several lines", () => {
    const code = `const A = () => (
      <button
        type="button"
        className="text-[#9ca3af]"
      >Go</button>
    );`;
    expect(pairs(code)[0]?.line).toBe(4);
  });

  it("skips semi-transparent colors and says why", () => {
    const result = extractJsxContrast(`const A = () => <p className="bg-black/40 text-white">Hi</p>;`, "x.tsx");
    expect(result.pairs).toEqual([]);
    expect(result.skipped).toEqual([{ file: "x.tsx", line: 1, reason: "semi-transparent color; contrast depends on what's behind it" }]);
  });

  it("records the enclosing component", () => {
    const code = `export function Card() { return <p className="text-[#9ca3af]">x</p>; }
      export const Panel = () => <p className="text-[#9ca3af]">y</p>;`;
    expect(extractJsxContrast(code, "x.tsx").pairs.map((p) => p.component)).toEqual(["Card", "Panel"]);
  });
});

describe("extractJsxContrast: focus styles", () => {
  const focus = (code: string) => extractJsxContrast(code, "x.tsx").focus;

  it("flags a focusable element that removes its outline with no replacement", () => {
    const code = `export function TextField() {
      return <input className="outline-none focus:border-[#3b82f6]" />;
    }`;
    expect(focus(code)).toEqual([
      {
        file: "x.tsx",
        line: 2,
        component: "TextField",
        element: "input",
        reason: "This input removes its focus outline (`outline-none`) and has no other visible focus style. A border color change alone isn't enough. Add a `focus-visible:ring-2` or `focus-visible:outline`.",
      },
    ]);
  });

  it.each([
    `<input className="outline-none focus:ring-2 focus:ring-[#3b82f6]" />`,
    `<button className="focus:outline-none focus-visible:outline-2">x</button>`,
    `<input className="px-3" />`,
    `<div className="outline-none">not focusable</div>`,
  ])("does not flag %s", (jsx) => {
    expect(focus(`const A = () => ${jsx};`)).toEqual([]);
  });

  it("treats elements with tabIndex as focusable", () => {
    expect(focus(`const A = () => <div tabIndex={0} className="outline-none">x</div>;`)).toHaveLength(1);
    expect(focus(`const A = () => <div tabIndex={-1} className="outline-none">x</div>;`)).toEqual([]);
  });

  it("flags once per element even when the classes have several variants", () => {
    const code = `const v = { a: "outline-none", b: "outline-none text-sm" };
      const A = ({ k }) => <button className={v[k]}>x</button>;`;
    expect(focus(code)).toHaveLength(1);
  });
});

describe("nothing is dropped silently", () => {
  it("notes color classes under dark: and other unchecked variants", () => {
    const r = extractJsxContrast(`export const A = () => <p className="text-gray-900 bg-white dark:bg-gray-900 dark:text-white">Hi</p>;`, "a.tsx");
    expect(r.pairs.map((p) => `${p.foreground} on ${p.background}`)).toEqual(["#111827 on #ffffff"]);
    expect(r.skipped).toEqual([{ file: "a.tsx", line: 1, reason: SKIP_VARIANTS }]);
  });

  it("doesn't note variants that don't change color", () => {
    const r = extractJsxContrast(`export const A = () => <button className="text-gray-900 bg-white disabled:opacity-50">Go</button>;`, "a.tsx");
    expect(r.skipped).toEqual([]);
  });

  it("says when an element had more class combinations than it checks", () => {
    const flags = Array.from({ length: 7 }, (_, i) => `f${i} && "text-gray-${(i + 1) * 100}"`).join(", ");
    const code = `export const A = (${Array.from({ length: 7 }, (_, i) => `f${i}`).join(", ")}) => <p className={cn("bg-white", ${flags})}>Hi</p>;`;
    expect(extractJsxContrast(code, "a.tsx").skipped.map((s) => s.reason)).toContain(SKIP_TOO_MANY);
  });
});
