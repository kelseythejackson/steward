import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { emptySystemModel, parseSystemModel, type Rule, type SystemModel } from "@steward/model";
import { describe, expect, it } from "vitest";
import { STATIC_CHECKS_NOTE } from "./system-view.js";
import { checkSnippet, findComponent, getRules, getTokens } from "./tools.js";

const FIXTURE_MODEL = fileURLToPath(new URL("../../../fixtures/messy-app/.steward/system.json", import.meta.url));
const fixture = (): SystemModel => parseSystemModel(readFileSync(FIXTURE_MODEL, "utf8"));
const names = (need: string, model = fixture()) => findComponent(model, need).data.matches.map((m) => m.name);

describe("getTokens", () => {
  const model = fixture();

  it("returns colors and spacing by default", () => {
    const { data, text } = getTokens(model);
    expect(data.colors).toHaveLength(17);
    expect(data.spacing?.map((s) => `${s.step}=${s.px}`)).toEqual(["1=4", "2=8", "2.5=10", "3=12", "4=16", "6=24", "8=32"]);
    expect(text).toContain("Colors (17)");
    expect(text).toContain("Spacing (7 steps)");
  });

  it("filters to colors, with Tailwind names, uses and contrast notes", () => {
    const { data, text } = getTokens(model, "color");
    expect(data.spacing).toBeUndefined();
    expect(data.colors?.find((c) => c.name === "gray-400")).toEqual({
      name: "gray-400",
      path: "color.gray.400",
      hex: "#9ca3af",
      uses: 12,
      note: "Not for text on gray-50, gray-100 or white.",
    });
    expect(text).toContain("- gray-400: #9ca3af, used 12 times. Not for text on gray-50, gray-100 or white.");
    expect(text).not.toContain("Spacing");
  });

  it("filters to spacing, with the most used step as the example", () => {
    const { data, text } = getTokens(model, "spacing");
    expect(data.colors).toBeUndefined();
    expect(text).toContain("(`p-6`, `gap-6`, `mt-6`)");
    expect(text).toContain("- 2.5: 10px, used 10 times");
  });

  it("says so when there are no tokens yet", () => {
    const { text } = getTokens(emptySystemModel());
    expect(text).toContain("- No color tokens yet.");
    expect(text).toContain("- No spacing scale yet.");
  });
});

describe("findComponent", () => {
  it('ranks Button first for "primary call to action", and says why', () => {
    const { data, text } = findComponent(fixture(), "primary call to action");
    const [best] = data.matches;
    expect(best!.name).toBe("Button");
    expect(best!.importLine).toBe('import { Button } from "src/components/Button";');
    expect(best!.example).toBe('<Button variant="primary">…</Button>');
    expect(best!.replaces).toEqual(["CTAButton", "PrimaryBtn"]);
    expect(best!.reasons).toContain('"call to action" usually means button');
    expect(best!.reasons).toContain('"button" is in its name');
    expect(best!.rules.some((r) => r.includes("never a raw `<button>`"))).toBe(true);
    expect(text).toContain("Import paths are from the repo root");
  });

  it("widens everyday words with synonyms", () => {
    expect(names("popup to confirm deleting")).toEqual(["Dialog", "Modal"]);
    expect(names("a card with a heading")).toEqual(["Panel"]);
    expect(names("email input")).toEqual(["TextField"]);
    expect(names("top navigation")).toEqual(["Navbar"]);
  });

  it("matches a component's props and variants", () => {
    expect(names("ghost")).toEqual(["Button"]);
    expect(findComponent(fixture(), "something with a hint").data.matches[0]!.reasons).toContain('it has a "hint" prop');
  });

  it("never suggests a component merged away or a page", () => {
    const all = ["CTA", "primary btn", "card", "dashboard", "billing", "settings", "app"].flatMap((n) => names(n));
    for (const gone of ["CTAButton", "PrimaryBtn", "Card", "Dashboard", "Billing", "Settings", "App"]) expect(all).not.toContain(gone);
  });

  it("returns at most three matches", () => {
    expect(names("button dialog modal panel navbar field").length).toBe(3);
  });

  it("says calmly when nothing matches, and lists what there is", () => {
    const { data, text } = findComponent(fixture(), "date picker");
    expect(data.matches).toEqual([]);
    expect(data.available).toEqual(["Button", "Dialog", "Modal", "Navbar", "Panel", "TextField"]);
    expect(text).toBe(
      'No shared components match "date picker". The shared components are Button, Dialog, Modal, Navbar, Panel and TextField. If none of them fits, build it with the tokens (see get_tokens) and follow the rules (see get_rules).\n',
    );
  });

  it("gives the same answer for the same model", () => {
    const m = fixture();
    const reversed = { ...m, components: [...m.components].reverse(), rules: [...m.rules].reverse() };
    expect(findComponent(reversed, "primary call to action")).toEqual(findComponent(m, "primary call to action"));
  });
});

describe("getRules", () => {
  const rule = (id: string, extra: Partial<Rule> = {}): Rule => ({
    id,
    text: `Rule ${id}.`,
    category: "component",
    appliesTo: [{ kind: "component", name: "Button" }],
    examples: { right: "<Button />", wrong: "<button />" },
    source: "user",
    severity: "warn",
    enabled: true,
    ...extra,
  });

  it("returns every enabled rule, most important first", () => {
    const { data, text } = getRules(fixture());
    expect(data.rules).toHaveLength(25);
    expect(data.rules.slice(0, 4).map((r) => r.id)).toEqual(["no-raw-button", "use-component-button", "use-component-panel", "spacing-tokens-only"]);
    expect(data.rules.at(-1)!.category).toBe("color");
    expect(text.startsWith("25 rules, most important first:")).toBe(true);
  });

  it("picks a category from a topic word or alias", () => {
    expect(getRules(fixture(), "spacing").data.rules.map((r) => r.id)).toEqual(["spacing-tokens-only"]);
    expect(getRules(fixture(), "padding").data.rules.map((r) => r.id)).toEqual(["spacing-tokens-only"]);
    expect(getRules(fixture(), "a11y").data.rules).toHaveLength(15);
    expect(getRules(fixture(), "colors").data.rules.every((r) => r.category === "color")).toBe(true);
  });

  it("otherwise matches words in the rule text, id and what it applies to", () => {
    const contrast = getRules(fixture(), "contrast").data.rules.map((r) => r.id);
    expect(contrast).toContain("a11y-text-contrast");
    expect(contrast).toContain("contrast-gray-400-on-white");
    expect(contrast).not.toContain("no-raw-button");
    expect(getRules(fixture(), "Card").data.rules.map((r) => r.id)).toEqual(["use-component-panel"]);
    expect(getRules(fixture(), "gray-400").data.rules.map((r) => r.id)).toContain("contrast-gray-400-on-gray-50");
  });

  it("includes the static-checks note whenever accessibility rules are in the answer", () => {
    const a11y = getRules(fixture(), "accessibility");
    expect(a11y.data.note).toBe(STATIC_CHECKS_NOTE);
    expect(a11y.text.trimEnd().endsWith(STATIC_CHECKS_NOTE)).toBe(true);
    expect(getRules(fixture(), "spacing").data.note).toBeUndefined();
  });

  it("leaves out rules a person turned off and puts required ones first", () => {
    const model = { ...emptySystemModel(), rules: [rule("a"), rule("off", { enabled: false }), rule("b-spacing", { category: "spacing", severity: "error" })] };
    const { data, text } = getRules(model);
    expect(data.rules.map((r) => r.id)).toEqual(["b-spacing", "a"]);
    expect(text).toContain("- Rule b-spacing. (required)");
  });

  it("says calmly when nothing matches", () => {
    expect(getRules(fixture(), "animation").text).toBe(
      'No rules match "animation". Try a topic like color, spacing, component or accessibility, or leave it out to get every rule.\n',
    );
    expect(getRules(emptySystemModel()).text).toBe("This system has no rules turned on yet.\n");
  });
});

describe("checkSnippet", () => {
  it("runs Steward Review's checks and describes them", () => {
    const { text, data } = checkSnippet(fixture(), `<div className="gap-5"><img src="/a.png" /></div>`);
    expect(data.findings.map((f) => f.check)).toEqual(["arbitrary-spacing", "img-alt"]);
    expect(text.startsWith("Found 2 things to change:")).toBe(true);
    expect(text.trimEnd().endsWith(STATIC_CHECKS_NOTE)).toBe(true);
  });
});
