import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseSystemModel } from "@steward/model";
import { describe, expect, it } from "vitest";
import { themeCss } from "./theme.ts";

const SOURCE = "fixtures/messy-app/.steward/system.json";
const model = parseSystemModel(readFileSync(fileURLToPath(new URL(`../../../${SOURCE}`, import.meta.url)), "utf8"));
const css = themeCss(model, SOURCE);

describe("themeCss", () => {
  it("clears Tailwind's default colors and spacing, so only the system's values exist", () => {
    expect(css).toContain("  --color-*: initial;\n  --spacing: initial;\n  --spacing-*: initial;\n");
  });

  it("has every color token, see-through ones as #rrggbbaa", () => {
    expect(css).toContain("--color-gray-900: #111827;");
    expect(css).toContain("--color-white: #ffffff;");
    expect(css).toContain("--color-black-40: #00000066;");
    expect(css.match(/--color-[\w-]+: #/g)).toHaveLength(18);
  });

  it("has the spacing scale in order, with 2.5 written the way Tailwind looks it up", () => {
    expect(css.match(/--spacing-[\w\\.]+: \d+px/g)).toEqual([
      "--spacing-1: 4px",
      "--spacing-2: 8px",
      "--spacing-2\\.5: 10px",
      "--spacing-3: 12px",
      "--spacing-4: 16px",
      "--spacing-6: 24px",
      "--spacing-8: 32px",
    ]);
  });

  it("matches the committed app/steward-theme.css (run `pnpm -F web theme` after the fixture's tokens change)", () => {
    expect(readFileSync(fileURLToPath(new URL("../app/steward-theme.css", import.meta.url)), "utf8")).toBe(css);
  });
});
