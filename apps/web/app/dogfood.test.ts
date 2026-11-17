/**
 * Steward uses its own product: the app's TSX is checked with Steward
 * Review's rules against the fixture's system, the same tokens the app's
 * theme is built from. Anything flagged (an off-system color, off-scale
 * spacing, a raw button, a missing label...) fails this test.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { checkFile } from "@steward/guard";
import { parseSystemModel } from "@steward/model";
import { describe, expect, it } from "vitest";

const APP = fileURLToPath(new URL(".", import.meta.url));
const model = parseSystemModel(readFileSync(fileURLToPath(new URL("../../../fixtures/messy-app/.steward/system.json", import.meta.url)), "utf8"));
const tsx = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? tsx(join(dir, e.name)) : e.name.endsWith(".tsx") ? [join(dir, e.name)] : []));

describe("the web app follows its own design system", () => {
  const files = tsx(APP);

  it("has TSX files to check", () => {
    expect(files.length).toBeGreaterThanOrEqual(7);
  });

  it.each(files.map((f) => [relative(APP, f), f]))("%s has nothing for Steward Review to flag", (_, file) => {
    const { findings } = checkFile({ path: relative(APP, file), code: readFileSync(file, "utf8") }, model);
    expect(findings.map((f) => `${f.line}:${f.column} ${f.rule}: ${f.message}`)).toEqual([]);
  });
});
