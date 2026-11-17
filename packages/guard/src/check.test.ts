import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { emptySystemModel, parseSystemModel, type SystemModel } from "@steward/model";
import { describe, expect, it } from "vitest";
import { checkCode, describeCheck, STATIC_CHECKS_NOTE } from "./check.js";
import { checkContext } from "./context.js";
import type { RuleId } from "./findings.js";
import { SnippetParseError } from "./parse.js";

const FIXTURE = fileURLToPath(new URL("../../../fixtures/messy-app", import.meta.url));
const fixture = (): SystemModel => parseSystemModel(readFileSync(`${FIXTURE}/.steward/system.json`, "utf8"));
const model = fixture();
const only = (code: string, check: RuleId, m: SystemModel = model) => checkCode(code, m).findings.filter((f) => f.rule === check);
const withRuleOff = (id: string): SystemModel => ({ ...model, rules: model.rules.map((r) => (r.id === id ? { ...r, enabled: false } : r)) });

describe("checkContext", () => {
  it("reads tokens, the spacing scale and the shared button from the model", () => {
    const ctx = checkContext(model);
    expect(ctx.colors.find((c) => c.name === "blue-500")).toEqual({ name: "blue-500", hex: "#3b82f6", path: "color.blue.500" });
    expect(ctx.spacing.map((s) => `${s.key}=${s.px}`)).toEqual(["1=4", "2=8", "2.5=10", "3=12", "4=16", "6=24", "8=32"]);
    expect(ctx.button).toEqual({ name: "Button", filePath: "src/components/Button.tsx", importLine: 'import { Button } from "src/components/Button";', hasPrimary: true, files: ["src/components/Button.tsx", "src/components/CTAButton.tsx", "src/components/PrimaryBtn.tsx"] });
    expect(Object.fromEntries([...ctx.replaced].map(([name, r]) => [name, `${r.keeper.name} (${r.systemRule})`]))).toEqual({
      CTAButton: "Button (use-component-button)",
      Card: "Panel (use-component-panel)",
      PrimaryBtn: "Button (use-component-button)",
    });
  });
});

describe("no-hardcoded-color", () => {
  it("swaps a near-identical hex for the token, with ΔE as evidence", () => {
    const [f] = only(`<div className="p-4 bg-[#3a81f5]" />`, "no-hardcoded-color");
    expect(f).toMatchObject({ line: 1, column: 21, found: "bg-[#3a81f5]", evidence: "ΔE 0.3 from blue-500 (#3b82f6)", fix: { replacement: "bg-blue-500" } });
    expect(f!.message).toBe("`bg-[#3a81f5]` hardcodes #3a81f5, which isn't one of your colors. It looks the same as `blue-500`.");
  });

  it("never calls a pale tint the same as a gray: no swap, and it says which hue it is", () => {
    // #eff6ff (Tailwind's blue-50) is only ΔE 1.2 from gray-100, but it's visibly blue on a large area.
    const [f] = only(`<div className="bg-[#eff6ff] p-4" />`, "no-hardcoded-color");
    expect(f!.message).toBe("`bg-[#eff6ff]` hardcodes #eff6ff, which isn't one of your colors. It's close to `gray-100`, but a blue, not a gray.");
    expect(f!.evidence).toBe("ΔE 1.2 from gray-100 (#f3f4f6); blue, not gray");
    expect(f!.fix.replacement).toBeUndefined();
    expect(f!.fix.description).toBe("If this blue is intentional, add it to the system. Otherwise use `bg-gray-100`.");
  });

  it("names the token when a hex is exactly a token", () => {
    const [f] = only(`<p className="text-[#6b7280]">Hi</p>`, "no-hardcoded-color");
    expect(f!.message).toBe("`text-[#6b7280]` hardcodes #6b7280, the same color as your `gray-500` token.");
    expect(f!.fix.replacement).toBe("text-gray-500");
  });

  it("suggests the nearest token for a distant color, without swapping it in", () => {
    const [f] = only(`<p className="text-[#ff00aa]">Hi</p>`, "no-hardcoded-color");
    expect(f!.fix.replacement).toBeUndefined();
    expect(f!.fix.description).toContain("If this color is intentional, add it to the system instead.");
  });

  it("flags Tailwind palette colors that aren't tokens, but not token colors", () => {
    expect(only(`<p className="text-purple-500 bg-white text-gray-500 border-transparent">Hi</p>`, "no-hardcoded-color").map((f) => f.found)).toEqual(["text-purple-500"]);
    expect(only(`<p className="text-purple-500">Hi</p>`, "no-hardcoded-color")[0]!.message).toContain("from the Tailwind palette");
  });

  it("treats Tailwind opacity classes for see-through tokens as in the system", () => {
    // The fixture system has black-40 and black-50, which Tailwind writes as bg-black/40 and bg-black/50.
    expect(only(`<div className="bg-black/40 hover:bg-black/50" />`, "no-hardcoded-color")).toEqual([]);
    expect(only(`<div className="bg-black/20" />`, "no-hardcoded-color").map((f) => f.found)).toEqual(["bg-black/20"]);
  });

  it("keeps variants and opacity when it swaps", () => {
    expect(only(`<a className="hover:bg-[#3a81f5]/50" />`, "no-hardcoded-color")[0]!.fix.replacement).toBe("hover:bg-blue-500/50");
    expect(only(`<a className="md:text-zinc-500/40" />`, "no-hardcoded-color")[0]!.fix.replacement).toBe("md:text-gray-500/40");
  });

  it("finds colors in inline styles and in class helpers like cn()", () => {
    const code = `<div className={cn("p-4", active && "bg-[#3a81f5]")} style={{ color: "#6b7380" }} />`;
    const found = only(code, "no-hardcoded-color");
    expect(found.map((f) => f.found)).toEqual(["bg-[#3a81f5]", 'color: "#6b7380"']);
    expect(found[1]!.fix.description).toBe("Use `text-gray-500` as a class instead.");
  });

  it("does nothing when the system has no colors yet", () => {
    expect(only(`<p className="text-[#ff00aa]" />`, "no-hardcoded-color", emptySystemModel())).toEqual([]);
  });
});

describe("no-arbitrary-spacing", () => {
  it("snaps an arbitrary value to the nearest step", () => {
    const [f] = only(`<div className="p-[13px]" />`, "no-arbitrary-spacing");
    expect(f).toMatchObject({ systemRule: "spacing-tokens-only", found: "p-[13px]", fix: { replacement: "p-3" } });
    expect(f!.evidence).toBe("13px; nearest step 12px; your scale is 4, 8, 10, 12, 16, 24, 32px");
  });

  it("flags Tailwind steps the scale doesn't have, naming the steps either side", () => {
    const [f] = only(`<div className="gap-5" />`, "no-arbitrary-spacing");
    expect(f!.message).toBe("`gap-5` (20px) isn't on your spacing scale.");
    expect(f!.fix).toMatchObject({ description: "Use `gap-4` (16px) or `gap-6` (24px).", replacement: "gap-6" });
  });

  it("keeps variants, negatives and !important", () => {
    expect(only(`<div className="md:-mt-[7px]!" />`, "no-arbitrary-spacing")[0]!.fix.replacement).toBe("md:-mt-2!");
    expect(only(`<div className="px-[10px]" />`, "no-arbitrary-spacing")).toEqual([]);
  });

  it("explains values bigger than the largest step instead of shrinking them", () => {
    const [f] = only(`<div className="mt-[72px]" />`, "no-arbitrary-spacing");
    expect(f!.fix.replacement).toBeUndefined();
    expect(f!.message).toBe("`mt-[72px]` (72px) is bigger than your largest spacing step, `mt-8` (32px).");
  });

  it("leaves sizes, hairlines and on-scale steps alone", () => {
    expect(only(`<div className="w-[42px] h-[3px] p-px m-0 p-4 gap-2.5" />`, "no-arbitrary-spacing")).toEqual([]);
  });

  it("skips the check when the spacing rule is turned off", () => {
    const r = checkCode(`<div className="p-[13px]" />`, withRuleOff("spacing-tokens-only"));
    expect(r.findings).toEqual([]);
    expect(r.skipped).toEqual(["spacing off the scale"]);
  });
});

describe("use-system-component", () => {
  it("suggests the shared Button with its import, keeping everything else", () => {
    const [f] = only(`<button className="mt-2" onClick={save}>Save</button>`, "use-system-component");
    expect(f!.systemRule).toBe("no-raw-button");
    expect(f!.found).toBe('<button className="mt-2" onClick={save}>');
    expect(f!.fix.replacement).toBe('<Button className="mt-2" onClick={save}>Save</Button>');
    expect(f!.fix.description).toBe('Use `Button` from your system. Add `variant="primary"` only if this is the page\'s main action. Import it with `import { Button } from "src/components/Button";`');
  });

  it("leaves buttons alone when the system has no shared Button", () => {
    expect(only(`<button>Save</button>`, "use-system-component", emptySystemModel())).toEqual([]);
  });

  it("skips the check when the rule is turned off", () => {
    expect(only(`<button>Save</button>`, "use-system-component", withRuleOff("no-raw-button"))).toEqual([]);
  });
});

describe("a11y-img-alt", () => {
  it("flags images with no alt", () => {
    const [f] = only(`<img src="/team.png" />`, "a11y-img-alt");
    expect(f).toMatchObject({ systemRule: "a11y-img-alt", category: "accessibility", line: 1, column: 1, found: '<img src="/team.png" />' });
  });

  it('accepts alt="" for decoration, any alt expression, and spread props', () => {
    expect(only(`<><img src="a" alt="" /><img src="b" alt={t("logo")} /><img {...props} /></>`, "a11y-img-alt")).toEqual([]);
  });
});

describe("a11y-accessible-name", () => {
  it("flags buttons and the shared Button whose only content is an icon", () => {
    const found = only(`<><button onClick={close}><XIcon /></button><Button variant="ghost"><svg /></Button></>`, "a11y-accessible-name");
    expect(found.map((f) => f.found)).toEqual(["<button onClick={close}>", '<Button variant="ghost">']);
    expect(found[0]!.fix.description).toBe('Add an aria-label that says what it does, like `aria-label="Close dialog"`.');
  });

  it("accepts text, hidden text, an expression, an aria-label, a title or an image with alt", () => {
    const code = `<>
      <button><XIcon /> Close</button>
      <button><XIcon /><span className="sr-only">Close</span></button>
      <button><XIcon />{label}</button>
      <button aria-label="Close"><XIcon /></button>
      <button title="Close"><XIcon /></button>
      <button><img src="x.svg" alt="Close" /></button>
      <button {...props}><XIcon /></button>
    </>`;
    expect(only(code, "a11y-accessible-name")).toEqual([]);
  });

  it('still flags an empty aria-label=""', () => {
    expect(only(`<button aria-label=""><XIcon /></button>`, "a11y-accessible-name")).toHaveLength(1);
  });
});

describe("checkCode", () => {
  it("reads loose markup with several top-level elements, keeping line and column", () => {
    const r = checkCode(`<img src="a" />\n<div className="p-[13px]" />`, model);
    expect(r.findings.map((f) => [f.rule, f.line, f.column])).toEqual([
      ["a11y-img-alt", 1, 1],
      ["no-arbitrary-spacing", 2, 17],
    ]);
  });

  it("reads a whole component file with imports and types", () => {
    const code = `import { X } from "x";\ntype P = { onClose: () => void };\nexport function Close({ onClose }: P) {\n  return <button onClick={onClose}><X /></button>;\n}\n`;
    expect(checkCode(code, model).findings.map((f) => [f.rule, f.line])).toEqual([
      ["use-system-component", 4],
      ["a11y-accessible-name", 4],
    ]);
  });

  it("says calmly when the code isn't JSX", () => {
    expect(() => checkCode("<div className=", model)).toThrow(SnippetParseError);
    expect(() => checkCode("<div className=", model)).toThrow("I couldn't read that as JSX, so nothing was checked.");
  });

  it("checks class maps outside className, like the fixture Button's variants", () => {
    const code = readFileSync(`${FIXTURE}/src/components/Button.tsx`, "utf8");
    const colors = checkCode(code, model).findings.filter((f) => f.rule === "no-hardcoded-color");
    expect(colors.map((f) => `${f.line}:${f.found}→${f.fix.replacement}`)).toContain("11:bg-[#3b82f6]→bg-blue-500");
    // Type literals and imports aren't classes.
    expect(colors.every((f) => f.line > 3)).toBe(true);
  });

  it("flags the drift in the fixture's duplicate button", () => {
    const code = readFileSync(`${FIXTURE}/src/components/PrimaryBtn.tsx`, "utf8");
    expect(checkCode(code, model).findings.map((f) => `${f.rule}:${f.found}`)).toEqual([
      "use-system-component:<button\n    onClick={onClick}\n    disabled={disabled}\n    className={`rounded-md bg-[#3a81f5] px-[18px] py-[9px] text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 ${\n      fullWidth ? \"w-full\" : \"\"\n    }`}\n  >",
      "a11y-text-contrast:white on blue-500",
      "no-hardcoded-color:bg-[#3a81f5]",
      "no-arbitrary-spacing:px-[18px]",
      "no-arbitrary-spacing:py-[9px]",
    ]);
  });

  it("ignores strings in attributes that aren't classes", () => {
    expect(checkCode(`<a href="p-[13px]" title="bg-[#ff00aa]" data-x="gap-5">Docs</a>`, model).findings).toEqual([]);
  });

  it("gives the same answer every time", () => {
    const code = `<div className="gap-5 bg-[#3a81f5]"><button><XIcon /></button><img src="a" /></div>`;
    expect(checkCode(code, model)).toEqual(checkCode(code, fixture()));
  });
});

describe("describeCheck", () => {
  it("numbers each finding with why and how to fix it", () => {
    const text = describeCheck(checkCode(`<div className="p-[13px]" />`, model));
    expect(text).toBe(
      [
        "Found 1 thing to change:",
        "",
        "1. Line 1: `p-[13px]` is an arbitrary value (13px), not a step on your spacing scale.",
        "   Why: 13px; nearest step 12px; your scale is 4, 8, 10, 12, 16, 24, 32px.",
        "   Fix: Use `p-3` (12px), the nearest step.",
        "   Replace with: `p-3`",
        "",
        STATIC_CHECKS_NOTE,
        "",
      ].join("\n"),
    );
  });

  it("is honest when nothing is found, and says what was skipped", () => {
    const text = describeCheck(checkCode(`<Button variant="primary">Save</Button>`, withRuleOff("no-raw-button")));
    expect(text).toBe(
      [
        "No problems found. Checked colors outside the system, spacing off the scale, components merged into `Button`, components merged into `Panel`, image alt text, names for icon-only buttons and links, form field labels, click handlers on divs and spans, visible focus styles and color contrast.",
        "",
        "Not checked, because their rules are turned off: raw buttons.",
        "",
        STATIC_CHECKS_NOTE,
        "",
      ].join("\n"),
    );
  });
});
