/**
 * Steward uses its own product: the app's TSX is checked with Steward
 * Review's rules against the fixture's system, the same tokens the app's
 * theme is built from. Anything flagged (an off-system color, off-scale
 * spacing, a raw button, a missing label...) fails this test.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { checkContext, checkFile } from "@steward/guard";
import { parseSystemModel } from "@steward/model";
import { describe, expect, it } from "vitest";

const APP = fileURLToPath(new URL(".", import.meta.url));
const model = parseSystemModel(readFileSync(fileURLToPath(new URL("../../../fixtures/messy-app/.steward/system.json", import.meta.url)), "utf8"));
/** This app's own Button (app/button.tsx) is where its one raw <button> belongs, as Button.tsx is in the fixture. */
const base = checkContext(model);
const ctx = { ...base, button: base.button && { ...base.button, files: [...base.button.files, "button.tsx"] } };
const tsx = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? tsx(join(dir, e.name)) : e.name.endsWith(".tsx") ? [join(dir, e.name)] : []));

describe("the web app follows its own design system", () => {
  const files = tsx(APP);

  it("has TSX files to check", () => {
    expect(files.length).toBeGreaterThanOrEqual(14);
  });

  it.each(files.map((f) => [relative(APP, f), f]))("%s has nothing for Steward Review to flag", (_, file) => {
    const { findings } = checkFile({ path: relative(APP, file), code: readFileSync(file, "utf8") }, ctx);
    expect(findings.map((f) => `${f.line}:${f.column} ${f.rule}: ${f.message}`)).toEqual([]);
  });
});

/**
 * Every color the app uses (its focus ring, outline-blue-600, included) comes
 * from the generated theme, which clears Tailwind's own colors. If a
 * regenerated theme dropped one, the class would silently do nothing (a focus
 * ring that vanishes, say), so a color class with no theme color fails here.
 */
describe("every color class the app uses is in its theme", () => {
  const theme = readFileSync(join(APP, "steward-theme.css"), "utf8");
  const defined = new Set([...theme.matchAll(/--color-([a-z0-9-]+):/g)].map((m) => m[1]!));
  /** Tailwind's own color names (cleared by the theme, so none of them work unless the theme defines it) plus the theme's. */
  const PALETTE = new Set(
    "slate gray zinc neutral stone red orange amber yellow lime green emerald teal cyan sky blue indigo violet purple fuchsia pink rose black white".split(" ").concat([...defined].map((c) => c.split("-")[0]!)),
  );
  const KEYWORDS = new Set(["transparent", "current", "inherit"]);
  const UTILITY = /(?<![\w-])(?:[\w-]+:)*(?:text|bg|border(?:-[trblxy])?|outline|stroke|fill|ring|ring-offset|divide|placeholder|decoration|accent|caret)-([a-z]+(?:-\d+)?)(?:\/\d+)?(?![\w-])/g;
  const sources = tsx(APP);

  const used = new Map<string, string[]>();
  for (const file of sources) {
    for (const m of readFileSync(file, "utf8").matchAll(UTILITY)) {
      const color = m[1]!;
      if (KEYWORDS.has(color) || !PALETTE.has(color.split("-")[0]!)) continue;
      used.set(color, [...(used.get(color) ?? []), `${relative(APP, file)}: ${m[0]}`]);
    }
  }

  it("finds the app's color classes (the focus ring among them)", () => {
    expect(used.has("blue-600")).toBe(true);
  });

  it("defines each one in app/steward-theme.css", () => {
    const missing = [...used].filter(([color]) => !defined.has(color)).map(([color, where]) => `${color} isn't in app/steward-theme.css, but is used in ${[...new Set(where)].join(", ")}`);
    expect(missing).toEqual([]);
  });
});
