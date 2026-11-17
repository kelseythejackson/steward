import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSystemModel } from "@steward/model";
import { describe, expect, it } from "vitest";
import { describeCheck } from "./check.js";
import { checkContext } from "./context.js";
import { checkFile } from "./engine.js";
import { parseIgnores } from "./ignore.js";

const FIXTURE = fileURLToPath(new URL("../../../fixtures/messy-app", import.meta.url));
const model = parseSystemModel(readFileSync(join(FIXTURE, ".steward/system.json"), "utf8"));
const ctx = checkContext(model);
const check = (code: string) => checkFile({ path: "src/pages/Hero.tsx", code }, ctx);

describe("parseIgnores", () => {
  it("reads a // comment on its own line as covering the next line", () => {
    expect(parseIgnores("// steward-ignore use-system-component: marketing hero needs a custom button\n<button />")).toEqual([
      { line: 1, covers: 2, through: 2, rules: ["use-system-component"], reason: "marketing hero needs a custom button" },
    ]);
  });

  it("reads a {/* */} JSX comment on its own line, with several rules", () => {
    expect(parseIgnores('<div>\n  {/* steward-ignore no-hardcoded-color, a11y-text-contrast: partner brand color */}\n  <p className="text-[#ff6b00]" />\n</div>')).toEqual([
      { line: 2, covers: 3, through: 3, rules: ["no-hardcoded-color", "a11y-text-contrast"], reason: "partner brand color" },
    ]);
  });

  it("reads a comment after code as covering its own line", () => {
    expect(parseIgnores('const c = "#ff6b00"; // steward-ignore no-hardcoded-color: chart palette')[0]).toMatchObject({ line: 1, covers: 1 });
  });

  it("keeps a missing reason as empty, and ignores comments that only mention steward", () => {
    expect(parseIgnores("// steward-ignore use-system-component\n// see the steward docs")).toEqual([{ line: 1, covers: 2, through: 2, rules: ["use-system-component"], reason: "" }]);
  });

  it("only reads real comments: not JSX text, which shows on the page, and not strings", () => {
    expect(parseIgnores('<p>\n  // steward-ignore a11y-img-alt: decorative\n  <img src="a" />\n</p>')).toEqual([
      { line: 2, covers: 3, through: 3, rules: ["a11y-img-alt"], reason: "decorative", inText: true },
    ]);
    expect(parseIgnores('const s = "// steward-ignore a11y-img-alt: decorative";')).toEqual([]);
  });

  it("covers every line of the opening tag that starts on the next line", () => {
    expect(parseIgnores('<>\n  {/* steward-ignore no-arbitrary-spacing: legacy layout */}\n  <div\n    className="p-[13px]"\n  >\n    <span />\n  </div>\n</>')).toEqual([
      { line: 2, covers: 3, through: 5, rules: ["no-arbitrary-spacing"], reason: "legacy layout" },
    ]);
  });

  it("covers every line of a plain statement, but not a whole function", () => {
    const [statement, fn] = parseIgnores(
      ['// steward-ignore no-hardcoded-color: chart palette', "const palette = [", '  "#ff6b00",', "];", "// steward-ignore no-hardcoded-color: chart", "function Chart() {", '  return "#ff6b00";', "}"].join("\n"),
    );
    expect(statement).toMatchObject({ covers: 2, through: 4 });
    expect(fn).toMatchObject({ covers: 6, through: 6 });
  });

  it("reads a {/* */} comment followed by code on the same line as covering that line", () => {
    expect(parseIgnores('<>\n  {/* steward-ignore a11y-img-alt: decorative */} <img src="a" />\n  <img src="b" />\n</>')[0]).toMatchObject({ line: 2, covers: 2, through: 2 });
  });

  it("keeps colons in the reason", () => {
    expect(parseIgnores("// steward-ignore a11y-img-alt: decorative: hidden by its parent")[0]!.reason).toBe("decorative: hidden by its parent");
  });
});

const BUTTON = '      <button className="hero-cta">Start your trial</button>';
const hero = (...lines: string[]) => ["export function Hero() {", "  return (", "    <section>", ...lines, "    </section>", "  );", "}", ""].join("\n");

describe("steward-ignore in the engine", () => {
  it("moves the covered finding out of the flags, with its reason", () => {
    const before = check(hero(BUTTON));
    expect(before.findings.map((f) => f.rule)).toEqual(["use-system-component"]);
    const r = check(hero("      {/* steward-ignore use-system-component: marketing hero needs a custom button */}", BUTTON));
    expect(r.findings).toEqual([]);
    expect(r.ignored).toHaveLength(1);
    expect(r.ignored[0]).toMatchObject({ reason: "marketing hero needs a custom button", commentLine: 4 });
    expect(r.ignored[0]!.finding).toMatchObject({ rule: "use-system-component", line: 5, found: before.findings[0]!.found, message: before.findings[0]!.message });
    expect(r.notes).toEqual([]);
  });

  it("only ignores the rules it names", () => {
    const r = check(hero("      {/* steward-ignore use-system-component: hero */}", '      <button className="bg-[#2563eb]">Go</button>'));
    expect(r.findings.map((f) => f.rule)).toEqual(["no-hardcoded-color"]);
    expect(r.ignored.map((i) => i.finding.rule)).toEqual(["use-system-component"]);
  });

  it("works after code on the same line", () => {
    const r = check(hero('      <img src="/divider.svg" /> {/* steward-ignore a11y-img-alt: decorative, aria-hidden on the parent */}'));
    expect(r.findings).toEqual([]);
    expect(r.ignored.map((i) => i.reason)).toEqual(["decorative, aria-hidden on the parent"]);
  });

  it("doesn't apply an ignore with no reason, and asks for one", () => {
    const r = check(hero("      {/* steward-ignore use-system-component */}", BUTTON));
    expect(r.findings.map((f) => f.rule)).toEqual(["use-system-component"]);
    expect(r.ignored).toEqual([]);
    expect(r.notes).toEqual([
      {
        file: "src/pages/Hero.tsx",
        line: 4,
        covers: 5,
        message: "This steward-ignore has no reason, so it isn't applied. Add one after a colon so the next person knows why: `// steward-ignore use-system-component: <why>`.",
      },
    ]);
  });

  it("names an unknown rule instead of quietly ignoring nothing", () => {
    const r = check(hero("      {/* steward-ignore use-system-button: hero */}", BUTTON));
    expect(r.findings).toHaveLength(1);
    expect(r.notes[0]!.message).toMatch(/^This steward-ignore names `use-system-button`, which isn't a Review rule\. The rules are `no-hardcoded-color`, /);
  });

  it("says when there's nothing on the line to ignore", () => {
    const r = check(hero("      {/* steward-ignore use-system-component: hero */}", '      <p className="text-gray-900">Hi</p>'));
    expect(r.notes.map((n) => n.message)).toEqual(["Nothing on line 5 is flagged by `use-system-component`, so this steward-ignore can be removed."]);
  });

  it("covers a multi-line element under the comment, and only says it can be removed when nothing in it is flagged", () => {
    const tag = ["      <div", '        className="p-[13px]"', "      >", "        Hi", "      </div>"];
    const r = check(hero("      {/* steward-ignore no-arbitrary-spacing: legacy layout */}", ...tag));
    expect(r.findings).toEqual([]);
    expect(r.ignored.map((i) => [i.finding.rule, i.finding.line])).toEqual([["no-arbitrary-spacing", 6]]);
    expect(r.notes).toEqual([]);
    const clean = check(hero("      {/* steward-ignore no-arbitrary-spacing: legacy layout */}", ...tag.map((l) => l.replace("p-[13px]", "p-4"))));
    expect(clean.notes.map((n) => n.message)).toEqual(["Nothing on lines 5–7 is flagged by `no-arbitrary-spacing`, so this steward-ignore can be removed."]);
  });

  it("doesn't apply a steward-ignore written as JSX text, and says how to make it a comment", () => {
    const r = check(hero("      // steward-ignore use-system-component: marketing hero needs a custom button", BUTTON));
    expect(r.findings.map((f) => f.rule)).toEqual(["use-system-component"]);
    expect(r.ignored).toEqual([]);
    expect(r.notes.map((n) => n.message)).toEqual([
      "This steward-ignore is written as text inside JSX, so it shows on the page and isn't applied. Wrap it in `{/* … */}` to make it a comment.",
    ]);
  });

  it("says nothing about a comment for a rule that's turned off", () => {
    const r = checkFile({ path: "src/pages/Hero.tsx", code: hero("      {/* steward-ignore use-system-component: hero */}", BUTTON) }, ctx, { off: ["use-system-component"] });
    expect(r.notes).toEqual([]);
  });

  it("asks for a rule when the comment names none", () => {
    expect(check(hero("      {/* steward-ignore: hero */}", BUTTON)).notes[0]!.message).toMatch(/^This steward-ignore doesn't name a rule/);
  });

  it("check_snippet's text mentions what was marked intentional", () => {
    const text = describeCheck(check(hero("      {/* steward-ignore use-system-component: marketing hero needs a custom button */}", BUTTON)));
    expect(text).toContain("Marked intentional with steward-ignore: line 5 (use-system-component: marketing hero needs a custom button).");
  });
});
