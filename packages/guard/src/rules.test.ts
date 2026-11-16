import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSystemModel, type SystemModel } from "@steward/model";
import { describe, expect, it } from "vitest";
import { applyFixes, checkFile } from "./engine.js";
import type { Finding, RuleId } from "./findings.js";
import { parseFile } from "./parse.js";
import { RULES } from "./rules/index.js";

const FIXTURE = fileURLToPath(new URL("../../../fixtures/messy-app", import.meta.url));
const model: SystemModel = parseSystemModel(readFileSync(`${FIXTURE}/.steward/system.json`, "utf8"));
const withRule = (id: string, change: { enabled?: boolean; severity?: "warn" | "error" }): SystemModel => ({
  ...model,
  rules: model.rules.map((r) => (r.id === id ? { ...r, ...change } : r)),
});

const walk = (dir: string): string[] =>
  readdirSync(dir)
    .flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) ? [p] : [];
    })
    .sort();

/** Every fixture source file as the rules see it: repo-relative path plus code. */
const files = walk(join(FIXTURE, "src")).map((p) => ({ path: relative(FIXTURE, p), code: readFileSync(p, "utf8") }));
const fileAt = (path: string) => files.find((f) => f.path === path)!;
const all = (m: SystemModel = model) => files.flatMap((f) => checkFile(f, m).findings);
const byRule = (rule: RuleId, m: SystemModel = model) => all(m).filter((f) => f.rule === rule);
const at = (f: Finding) => `${f.file}:${f.line}`;

describe("rule modules", () => {
  it("each has a unique id, a plain-English description, a category and a warn default", () => {
    expect(RULES.map((r) => r.id)).toEqual(["no-hardcoded-color", "no-arbitrary-spacing", "use-system-component", "a11y-img-alt", "a11y-icon-button-label"]);
    for (const r of RULES) {
      expect(r.description).toMatch(/^[A-Z].+\.$/);
      expect(r.severity).toBe("warn");
      expect(typeof r.check).toBe("function");
    }
  });

  it("offers automatic fixes only where there's one safe answer", () => {
    expect(RULES.filter((r) => r.fix).map((r) => r.id)).toEqual(["no-hardcoded-color", "no-arbitrary-spacing", "use-system-component"]);
  });
});

describe("no-hardcoded-color on the fixture", () => {
  it("flags the near-duplicate gray and swaps in the token, with the file and line", () => {
    const f = byRule("no-hardcoded-color").find((x) => x.file === "src/components/Dialog.tsx" && x.found.includes("#6b7380"))!;
    expect(f).toMatchObject({ severity: "warn", category: "color", fix: { replacement: expect.stringContaining("gray-500") } });
    expect(f.evidence).toMatch(/^ΔE \d\.\d from gray-500 \(#6b7280\)$/);
    expect(f.fix.edits).toHaveLength(1);
  });

  it("never flags a color that's already a token", () => {
    const tokenClasses = /^(?:[a-z]+:)*(?:bg|text|border)-(?:white|gray-(?:50|100|200|300|400|500|700|800|900)|blue-(?:500|600))$/;
    expect(byRule("no-hardcoded-color").filter((f) => tokenClasses.test(f.found))).toEqual([]);
  });

  it("only fixes colors that look the same as a token; others get advice", () => {
    for (const f of byRule("no-hardcoded-color")) {
      if (f.fix.edits) expect(f.evidence).toMatch(/same color as|^ΔE [0-2]\.\d from/);
      else expect(f.fix.description).toMatch(/add it to the system instead|as a class/);
    }
  });
});

describe("no-arbitrary-spacing on the fixture", () => {
  it("snaps each arbitrary value in FIXTURE_NOTES to the nearest step", () => {
    const snaps = new Map(byRule("no-arbitrary-spacing").map((f) => [f.found, f.fix.replacement]));
    expect(Object.fromEntries(snaps)).toMatchObject({
      "mt-[7px]": "mt-2",
      "mt-[22px]": "mt-6",
      "px-[18px]": "px-4",
      "p-[13px]": "p-3",
      "mb-[7px]": "mb-2",
      // FIXTURE_NOTES: "halfway values round up", and 10px is a step, so 9px → 10px.
      "py-[9px]": "py-2.5",
      "py-[13px]": "py-3",
    });
  });

  it("leaves sizes like h-[42px] and the dynamic width style alone", () => {
    expect(byRule("no-arbitrary-spacing").map((f) => f.found)).not.toContain("h-[42px]");
    expect(byRule("no-arbitrary-spacing").every((f) => f.systemRule === "spacing-tokens-only")).toBe(true);
  });

  it("uses a person's severity and respects the rule being turned off", () => {
    expect(byRule("no-arbitrary-spacing", withRule("spacing-tokens-only", { severity: "error" })).every((f) => f.severity === "error")).toBe(true);
    expect(byRule("no-arbitrary-spacing", withRule("spacing-tokens-only", { enabled: false }))).toEqual([]);
  });
});

describe("use-system-component on the fixture", () => {
  it("flags the raw buttons listed in FIXTURE_NOTES, and not the button components themselves", () => {
    const raw = byRule("use-system-component").filter((f) => f.found.startsWith("<button"));
    expect(raw.map(at)).toEqual([
      "src/components/Modal.tsx:34",
      "src/components/Navbar.tsx:26",
      "src/pages/Billing.tsx:74",
      "src/pages/Dashboard.tsx:74",
      "src/pages/Settings.tsx:43",
    ]);
    expect(raw.every((f) => f.systemRule === "no-raw-button")).toBe(true);
  });

  it("flags uses of components that accepted merges replaced", () => {
    const merged = byRule("use-system-component").filter((f) => !f.found.startsWith("<button"));
    expect(merged.map((f) => `${at(f)} ${f.found.match(/^<\w+/)![0]} → ${f.fix.replacement!.match(/^<\w+/)![0]}`)).toEqual([
      "src/pages/Billing.tsx:26 <CTAButton → <Button",
      "src/pages/Dashboard.tsx:38 <Card → <Panel",
      "src/pages/Dashboard.tsx:65 <CTAButton → <Button",
      "src/pages/Settings.tsx:15 <Card → <Panel",
      "src/pages/Settings.tsx:24 <PrimaryBtn → <Button",
      "src/pages/Settings.tsx:28 <Card → <Panel",
    ]);
    const card = merged.find((f) => f.found.startsWith("<Card"))!;
    expect(card.message).toBe("This is `Card`, which your team merged into `Panel`.");
    expect(card.evidence).toBe("accepted merge of Card, Panel into Panel");
    expect(card.systemRule).toBe("use-component-panel");
  });

  it("doesn't enforce a merge nobody accepted, or one a person turned off", () => {
    const undecided = { ...model, decisions: model.decisions.filter((d) => d.kind !== "component") };
    expect(byRule("use-system-component", undecided).filter((f) => !f.found.startsWith("<button"))).toEqual([]);
    const panelOff = byRule("use-system-component", withRule("use-component-panel", { enabled: false }));
    expect(panelOff.some((f) => f.found.startsWith("<Card"))).toBe(false);
    expect(panelOff.some((f) => f.found.startsWith("<PrimaryBtn"))).toBe(true);
  });

  it("skips a same-named component imported from a package", () => {
    const code = `import { Card } from "@acme/ui";\nexport const X = () => <Card>Hi</Card>;\n`;
    expect(checkFile({ path: "src/X.tsx", code }, model).findings).toEqual([]);
  });

  it("renames the tags and adds an import relative to the file", () => {
    const { code } = fileAt("src/pages/Settings.tsx");
    const fixes = checkFile(fileAt("src/pages/Settings.tsx"), model, { rules: ["use-system-component"] }).findings;
    const out = applyFixes(code, fixes).code;
    expect(out).toContain('import { Panel } from "../components/Panel";');
    expect(out).toContain('import { Button } from "../components/Button";');
    expect(out.match(/import \{ Panel \}/g)).toHaveLength(1);
    expect(out).not.toMatch(/<Card[\s>]|<\/Card>|<PrimaryBtn|<button[\s>]/);
    expect(out).toContain('<PrimaryBtn label="Save changes"'.replace("PrimaryBtn", "Button"));
  });
});

describe("applyFixes", () => {
  it("fixes every file in the fixture without breaking it, and fixed code passes a second check", () => {
    for (const f of files) {
      const first = checkFile(f, model).findings;
      const { code, fixed, notFixed } = applyFixes(f.code, first);
      expect(() => parseFile({ path: f.path, code }), f.path).not.toThrow();
      // Nothing with edits was dropped for clashing.
      expect(notFixed.filter((x) => x.fix.edits), f.path).toEqual([]);
      const again = checkFile({ path: f.path, code }, model).findings;
      expect(again.filter((x) => x.fix.edits), f.path).toEqual([]);
      expect(again.length, f.path).toBe(first.length - fixed.length);
    }
  });

  it("applies a finding's edits all together or not at all when they clash", () => {
    const base = { rule: "no-arbitrary-spacing", severity: "warn", category: "spacing", line: 1, column: 1, found: "", message: "", evidence: "" } as const;
    const a: Finding = { ...base, fix: { description: "", edits: [{ start: 0, end: 3, text: "AAA" }] } };
    const b: Finding = { ...base, fix: { description: "", edits: [{ start: 2, end: 4, text: "B" }, { start: 6, end: 6, text: "!" }] } };
    const r = applyFixes("0123456", [a, b]);
    expect(r.code).toBe("AAA3456");
    expect(r.notFixed).toEqual([b]);
  });

  it("makes identical edits once, and keeps inserts at the same spot in order", () => {
    const base = { rule: "use-system-component", severity: "warn", category: "component", line: 1, column: 1, found: "", message: "", evidence: "" } as const;
    const imp = { start: 0, end: 0, text: "I;" };
    const a: Finding = { ...base, fix: { description: "", edits: [imp, { start: 0, end: 0, text: "J;" }] } };
    const b: Finding = { ...base, fix: { description: "", edits: [{ ...imp }] } };
    expect(applyFixes("x", [a, b])).toMatchObject({ code: "I;J;x", fixed: [a, b] });
  });

  it("leaves findings without a safe fix alone", () => {
    const { findings } = checkFile({ code: `<img src="a" />` }, model);
    expect(applyFixes(`<img src="a" />`, findings)).toEqual({ code: `<img src="a" />`, fixed: [], notFixed: findings });
  });
});

describe("checkFile", () => {
  it("puts the file on every finding and is deterministic", () => {
    const f = fileAt("src/pages/Billing.tsx");
    const r = checkFile(f, model);
    expect(r.findings.every((x) => x.file === "src/pages/Billing.tsx")).toBe(true);
    expect(checkFile(f, parseSystemModel(readFileSync(`${FIXTURE}/.steward/system.json`, "utf8")))).toEqual(r);
  });

  it("can run a subset of rules", () => {
    const r = checkFile(fileAt("src/pages/Billing.tsx"), model, { rules: ["a11y-img-alt"] });
    expect(r.checked).toEqual(["image alt text"]);
    expect(new Set(r.findings.map((x) => x.rule))).toEqual(new Set(r.findings.length ? ["a11y-img-alt"] : []));
  });
});
