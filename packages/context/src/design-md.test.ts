import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { emptySystemModel, parseSystemModel, type Rule, type SystemModel } from "@steward/model";
import { describe, expect, it } from "vitest";
import { contrastRatio, DESIGN_MD_MARKER, generateDesignMd } from "./design-md.js";

const FIXTURE_MODEL = fileURLToPath(new URL("../../../fixtures/messy-app/.steward/system.json", import.meta.url));
const fixture = (): SystemModel => parseSystemModel(readFileSync(FIXTURE_MODEL, "utf8"));
const section = (md: string, heading: string) => {
  const start = md.indexOf(`\n${heading}\n`);
  const next = md.indexOf("\n## ", start + heading.length + 2);
  return md.slice(start, next === -1 ? undefined : next);
};

describe("generateDesignMd on fixtures/messy-app", () => {
  const md = generateDesignMd(fixture(), { name: "messy-app" });

  it("matches the snapshot", async () => {
    await expect(md).toMatchFileSnapshot("./__snapshots__/messy-app.design.md");
  });

  it("stays short and scannable", () => {
    expect(md.split("\n").length).toBeLessThan(300);
  });

  it("puts the summary, then the most important rules, then accessibility, tokens, components and other rules", () => {
    const order = ["# messy-app design system", "## Most important rules", "## Accessibility", "## Tokens", "## Components", "## Other rules"].map((h) =>
      md.indexOf(`\n${h}\n`),
    );
    expect(order.every((i) => i > 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("leads with the rule that bans raw buttons", () => {
    expect(section(md, "## Most important rules").split("\n")[3]).toMatch(/^- Use `<Button variant="primary">`.*never a raw `<button>`\.$/);
  });

  it("lists shared components only, leaving out pages, the app shell and components merged away", () => {
    const names = [...section(md, "## Components").matchAll(/^### (.+)$/gm)].map((m) => m[1]);
    expect(names).toEqual(["Button", "Dialog", "Modal", "Navbar", "Panel", "TextField"]);
    expect(md).toContain('`import { Button } from "src/components/Button";`');
    expect(md).toContain("- Use instead of `CTAButton` or `PrimaryBtn`");
  });

  it("marks colors that fail contrast in some pairs", () => {
    expect(md).toContain("| `gray-400` | #9ca3af | 12 | Not for text on gray-50, gray-100 or white. |");
  });

  it("lists approved pairs from the tokens' own contrast", () => {
    expect(md).toContain("| `white` | blue-600, gray-500, gray-700, gray-800, gray-900, red-600 | blue-500 |");
  });

  it("is honest that static checks aren't the whole story", () => {
    expect(section(md, "## Accessibility")).toContain("They catch some accessibility problems, not all");
  });
});

describe("generateDesignMd", () => {
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

  it("starts with the marker so `steward context --file` knows it wrote the file", () => {
    expect(generateDesignMd(emptySystemModel()).startsWith(DESIGN_MD_MARKER)).toBe(true);
  });

  it("handles an empty system without empty sections", () => {
    const md = generateDesignMd(emptySystemModel(), { name: "app" });
    expect(md).toContain("app is a React + Tailwind app with 0 color tokens, no spacing scale yet, 0 shared components and 0 rules.");
    expect(md).not.toContain("## Components");
    expect(md).not.toContain("## Most important rules");
  });

  it("leaves out rules a person turned off", () => {
    const md = generateDesignMd({ ...emptySystemModel(), rules: [rule("on"), rule("off", { enabled: false })] });
    expect(md).toContain("Rule on.");
    expect(md).not.toContain("Rule off.");
  });

  it("puts errors before warnings, and bans before the rest", () => {
    const md = generateDesignMd({
      ...emptySystemModel(),
      rules: [rule("a-warn"), rule("b-error", { severity: "error" }), rule("no-raw-thing"), rule("spacing", { category: "spacing" })],
    });
    const order = ["Rule b-error.", "Rule no-raw-thing.", "Rule a-warn.", "Rule spacing."].map((t) => md.indexOf(t));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("only counts pending suggestions, never presents them as rules", () => {
    const model = fixture();
    const md = generateDesignMd({ ...model, decisions: [], rules: model.rules.filter((r) => !r.basedOn) });
    expect(md).toContain("24 suggestions are still waiting for review, so they aren't part of the system yet.");
    expect(md).not.toContain("Use instead of");
    expect(md).not.toContain("## Other rules");
    const names = [...section(md, "## Components").matchAll(/^### (.+)$/gm)].map((m) => m[1]);
    expect(names).toContain("CTAButton");
  });

  it("gives the same text for the same model", () => {
    const m = fixture();
    const reversed = { ...m, components: [...m.components].reverse(), rules: [...m.rules].reverse(), suggestions: [...m.suggestions].reverse() };
    expect(generateDesignMd(reversed, { name: "x" })).toBe(generateDesignMd(m, { name: "x" }));
  });
});

describe("contrastRatio", () => {
  it("matches WCAG's figures", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#6b7280", "#ffffff")).toBeCloseTo(4.83, 2);
    expect(contrastRatio("#ffffff", "#3b82f6")).toBeCloseTo(3.68, 2);
  });
});
