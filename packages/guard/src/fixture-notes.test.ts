/**
 * The whole engine on the untouched fixture, checked against the tables in
 * fixtures/messy-app/FIXTURE_NOTES.md. The expectations are read from the
 * notes, so the fixture, the notes and the engine can't drift apart quietly.
 *
 * What the engine leaves out on purpose, and says so here:
 * - CSS files (styles.css): Review reads TSX only for now.
 * - `gap-[10px]`: an arbitrary value that is exactly a scale step; whether to flag it is an open question.
 * - `h-[42px]`: a size, not spacing.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSystemModel } from "@steward/model";
import { describe, expect, it } from "vitest";
import { checkContext } from "./context.js";
import { checkFile } from "./engine.js";
import type { Finding, RuleId } from "./findings.js";

const FIXTURE = fileURLToPath(new URL("../../../fixtures/messy-app", import.meta.url));
const NOTES = readFileSync(join(FIXTURE, "FIXTURE_NOTES.md"), "utf8");
const model = parseSystemModel(readFileSync(join(FIXTURE, ".steward/system.json"), "utf8"));
const ctx = checkContext(model);

const walk = (dir: string): string[] =>
  readdirSync(dir)
    .flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? walk(p) : [p];
    })
    .sort();
const sources = walk(join(FIXTURE, "src")).map((p) => relative(FIXTURE, p));
const tsx = sources.filter((p) => /\.tsx?$/.test(p));
const findings: Finding[] = tsx.flatMap((path) => checkFile({ path, code: readFileSync(join(FIXTURE, path), "utf8") }, model).findings);
const of = (rule: RuleId) => findings.filter((f) => f.rule === rule);
const at = (f: Finding) => `${f.file}:${f.line}`;

/** `Card.tsx` → `src/components/Card.tsx`. Every file name in the fixture is unique. */
const pathOf = (name: string) => {
  const hits = sources.filter((p) => basename(p) === name || p === name);
  expect(hits, name).toHaveLength(1);
  return hits[0]!;
};

/** The rows of the first markdown table after a heading, as trimmed cells with backticks removed. */
function table(heading: string, after = 0): string[][] {
  const start = NOTES.indexOf(heading, after);
  expect(start, heading).toBeGreaterThan(-1);
  const lines = NOTES.slice(start).split("\n");
  const first = lines.findIndex((l) => l.startsWith("|"));
  const rows: string[][] = [];
  for (const l of lines.slice(first + 2)) {
    if (!l.startsWith("|")) break;
    rows.push(l.slice(1, -1).split("|").map((c) => c.trim().replaceAll("`", "")));
  }
  return rows;
}

const hexOf = (name: string) => (name.startsWith("#") ? name : ctx.colors.find((c) => c.name === name)!.hex);
const nameOf = (hex: string) => ctx.colors.find((c) => c.hex === hex && c.alpha === undefined)?.name;

describe("FIXTURE_NOTES §1: colors", () => {
  it("flags every hardcoded hex color in the TSX files", () => {
    const literals = tsx.flatMap((p) => readFileSync(join(FIXTURE, p), "utf8").match(/#[0-9a-f]{6}(?:[0-9a-f]{2})?\b/gi) ?? []);
    const flagged = of("no-hardcoded-color").filter((f) => f.found.includes("#"));
    expect(flagged).toHaveLength(literals.length);
  });

  it("never flags a named class that is a token, including see-through ones like bg-black/40", () => {
    const named = table("### Named palette colors").map((r) => r[2]!.match(/(?:\S+:)?(?:bg|text|border)-[a-z]+(?:-\d+)?(?:\/\d+)?/)![0]);
    expect(named).toEqual(["text-red-600", "border-red-300", "hover:bg-red-50", "bg-black/40", "bg-black/50"]);
    expect(of("no-hardcoded-color").filter((f) => !f.found.includes("#"))).toEqual([]);
  });
});

describe("FIXTURE_NOTES §2: spacing", () => {
  const rows = table("## 2. Spacing off the scale");
  const flagged = (cls: string) => of("no-arbitrary-spacing").filter((f) => f.found === cls).length;

  it("flags each arbitrary value as many times as it's used", () => {
    for (const [cls, uses] of rows) {
      if (cls === "gap-[10px]" || cls === "h-[42px]") continue;
      expect(flagged(cls!), cls).toBe(Number(uses));
    }
  });

  it("leaves h-[42px] (a size) and gap-[10px] (exactly the 10px step) alone", () => {
    expect(flagged("h-[42px]")).toBe(0);
    expect(flagged("gap-[10px]")).toBe(0);
  });

  it("also flags the standard steps the notes say are used once and so aren't on the scale (20px, 28px)", () => {
    const listed = new Set(rows.map((r) => r[0]));
    const extra = of("no-arbitrary-spacing").filter((f) => !listed.has(f.found));
    expect(extra.map((f) => f.found).sort()).toEqual(["px-5", "px-7"]);
  });
});

describe("FIXTURE_NOTES §3 and §4: components", () => {
  it("flags every raw <button> listed, and none inside the button components", () => {
    const expected = table("## 4. Raw `<button>` elements").map(([file, line]) => `${file}:${line}`);
    const raw = of("use-system-component").filter((f) => f.found.startsWith("<button"));
    expect(raw.map(at).sort()).toEqual(expected.sort());
  });

  it("flags uses of the components the notes expect to be merged: PrimaryBtn and CTAButton into Button, Card into Panel", () => {
    const merged = of("use-system-component").filter((f) => !f.found.startsWith("<button"));
    const pairs = new Set(merged.map((f) => `${f.found.match(/^<(\w+)/)![1]}→${f.fix.replacement!.match(/^<(\w+)/)![1]}`));
    expect([...pairs].sort()).toEqual(["CTAButton→Button", "Card→Panel", "PrimaryBtn→Button"]);
  });
});

describe("FIXTURE_NOTES §5: accessibility", () => {
  const RULE_FOR: Readonly<Record<string, RuleId>> = {
    "<img> without alt": "a11y-img-alt",
    "Icon-only button with no accessible name": "a11y-accessible-name",
    "<input> without a label": "a11y-label-inputs",
    "Click handler on non-interactive element": "a11y-interactive-element",
    "Focus outline removed, no replacement": "a11y-focus-visible",
  };
  const rows = table("## 5. Accessibility problems").filter((r) => r[2] !== "");

  it("finds each planted problem at its file and line", () => {
    const missed: string[] = [];
    for (const [name, file, line] of rows) {
      const rule = RULE_FOR[name!];
      expect(rule, `no rule mapped for "${name}"`).toBeDefined();
      if (file!.endsWith(".css")) continue; // CSS isn't checked by Review yet
      if (!of(rule!).some((f) => at(f) === `${file}:${line}`)) missed.push(`${name} at ${file}:${line}`);
    }
    expect(missed).toEqual([]);
  });

  it("finds nothing else for those rules: each planted problem once, and the 'must not be flagged' cases stay clean", () => {
    const planted = rows.filter((r) => !r[1]!.endsWith(".css")).map(([name, file, line]) => `${RULE_FOR[name!]} ${file}:${line}`);
    const found = findings.filter((f) => Object.values(RULE_FOR).includes(f.rule)).map((f) => `${f.rule} ${at(f)}`);
    expect(found.sort()).toEqual(planted.sort());
  });

  it("only leaves out the CSS rows", () => {
    expect(rows.filter((r) => r[1]!.endsWith(".css")).map((r) => `${r[1]}:${r[2]}`)).toEqual(["src/styles.css:40"]);
  });
});

/** `Card.tsx:13` in a "Where" cell, which also holds notes in parentheses (with commas of their own). */
const LOCATION = /([\w.-]+\.(?:tsx|css)):(\d+)/g;

describe("FIXTURE_NOTES §5b: contrast pairs", () => {
  const rows = table("Pairs that fail WCAG AA");
  const expected = rows.flatMap(([fg, bg, fix, use, , where]) =>
    [...where!.matchAll(LOCATION)]
      .filter(([, file]) => !file!.endsWith(".css"))
      .map(([, file, line]) => ({ at: `${pathOf(file!)}:${line}`, fg: fg!, bg: bg!, fix: fix!, use: use! })),
  );
  const pairOf = (f: Finding) => {
    const [fg, bg] = f.found.includes(" on ") ? f.found.split(" on ") : [f.found.replace(/^.*?-/, ""), ""];
    return { fg: hexOf(fg!), bg: bg ? hexOf(bg) : "" };
  };
  const contrast = of("a11y-text-contrast");

  it("flags every failing pair in the TSX files at its file and line, and no others", () => {
    const want = [...new Set(expected.map((e) => `${e.at} ${e.fg} on ${e.bg}`))].sort();
    const got = [...new Set(contrast.map((f) => `${at(f)} ${pairOf(f).fg} on ${pairOf(f).bg}`))].sort();
    expect(got).toEqual(want);
  });

  it("suggests the fix in the notes for each pair, where the fix is a token", () => {
    for (const e of expected) {
      const name = nameOf(e.fix);
      if (!name || e.fix === e.fg) continue; // the red pair's fix is a computed shade, not checked by hex
      const f = contrast.find((x) => at(x) === e.at && pairOf(x).fg === e.fg && pairOf(x).bg === e.bg)!;
      expect(f.message, `${e.at} ${e.fg} on ${e.bg}`).toContain(`\`${name}\``);
    }
  });

  it("only leaves out the CSS rows", () => {
    const css = rows.flatMap((r) => [...r[5]!.matchAll(LOCATION)].map((m) => `${m[1]}:${m[2]}`)).filter((w) => w.includes(".css"));
    expect(css).toEqual(["styles.css:9", "styles.css:45"]);
  });
});

describe("FIXTURE_NOTES §6: quick reference", () => {
  it("finds 5 raw buttons outside the button components", () => {
    expect(NOTES).toContain("raw <button> outside button components: 5");
    expect(of("use-system-component").filter((f) => f.found.startsWith("<button"))).toHaveLength(5);
  });

  it("finds the 6 distinct accessibility rule hits, all but the CSS one (5 rules, 6 of 7 locations with the shared Modal line)", () => {
    expect(NOTES).toContain("a11y static findings:        6 distinct rule hits (7 locations)");
    const rules = new Set(findings.filter((f) => f.category === "accessibility" && f.rule !== "a11y-text-contrast").map((f) => f.rule));
    expect([...rules].sort()).toEqual(["a11y-accessible-name", "a11y-focus-visible", "a11y-img-alt", "a11y-interactive-element", "a11y-label-inputs"]);
  });
});
