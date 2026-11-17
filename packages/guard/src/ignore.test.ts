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
      { line: 1, covers: 2, rules: ["use-system-component"], reason: "marketing hero needs a custom button" },
    ]);
  });

  it("reads a {/* */} JSX comment on its own line, with several rules", () => {
    expect(parseIgnores('<div>\n  {/* steward-ignore no-hardcoded-color, a11y-text-contrast: partner brand color */}\n  <p className="text-[#ff6b00]" />')).toEqual([
      { line: 2, covers: 3, rules: ["no-hardcoded-color", "a11y-text-contrast"], reason: "partner brand color" },
    ]);
  });

  it("reads a comment after code as covering its own line", () => {
    expect(parseIgnores('const c = "#ff6b00"; // steward-ignore no-hardcoded-color: chart palette')[0]).toMatchObject({ line: 1, covers: 1 });
  });

  it("keeps a missing reason as empty, and ignores comments that only mention steward", () => {
    expect(parseIgnores("// steward-ignore use-system-component\n// see the steward docs")).toEqual([{ line: 1, covers: 2, rules: ["use-system-component"], reason: "" }]);
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
