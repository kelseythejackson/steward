import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { extractColors, summarizeColors, type ColorExtraction } from "./index.js";

const FIXTURE = fileURLToPath(new URL("../../../../fixtures/messy-app", import.meta.url));

/** Reads `| \`#hex\` | count |` rows from the color tables in FIXTURE_NOTES.md. */
async function expectedUsesFromNotes(): Promise<Map<string, number>> {
  const notes = await readFile(`${FIXTURE}/FIXTURE_NOTES.md`, "utf8");
  const rows = [...notes.matchAll(/^\| `(#[0-9a-f]{6}(?:[0-9a-f]{2})?)`\s*\|\s*(\d+) \|/gm)];
  return new Map(rows.map((m) => [m[1]!, Number(m[2])]));
}

/** Reads `| \`name\` | \`#hex\` | line |` rows from the config definitions table. */
async function expectedDefinitionsFromNotes(): Promise<Map<string, number>> {
  const notes = await readFile(`${FIXTURE}/FIXTURE_NOTES.md`, "utf8");
  const rows = [...notes.matchAll(/^\| `[a-z]+`\s*\| `(#[0-9a-f]{6})` \|\s*(\d+) \|/gm)];
  return new Map(rows.map((m) => [m[1]!, Number(m[2])]));
}

describe("extractColors on fixtures/messy-app", () => {
  let result: ColorExtraction;
  beforeAll(async () => {
    result = await extractColors(FIXTURE);
  });

  it("parses every file", () => {
    expect(result.skipped).toEqual([]);
  });

  it("finds exactly the colors and use counts listed in FIXTURE_NOTES.md", async () => {
    const expected = await expectedUsesFromNotes();
    expect(expected.size).toBe(24); // guard against the notes table format changing silently
    const actual = new Map(result.colors.filter((c) => c.uses > 0).map((c) => [c.value, c.uses]));
    expect(Object.fromEntries([...actual].sort())).toEqual(Object.fromEntries([...expected].sort()));
  });

  it("records Tailwind config colors as definitions at the lines in the notes", async () => {
    const expected = await expectedDefinitionsFromNotes();
    expect(expected.size).toBe(3);
    for (const [value, line] of expected) {
      const color = result.colors.find((c) => c.value === value);
      expect(color?.definitions).toEqual([expect.objectContaining({ file: "tailwind.config.ts", line })]);
    }
  });

  it("makes #9ca3af the most-used color", () => {
    expect(result.colors[0]).toMatchObject({ value: "#9ca3af", uses: 12 });
  });

  it("points every location at a line that really contains that color", async () => {
    const cache = new Map<string, string[]>();
    for (const color of result.colors) {
      for (const loc of [...color.locations, ...color.definitions]) {
        if (!cache.has(loc.file)) cache.set(loc.file, (await readFile(`${FIXTURE}/${loc.file}`, "utf8")).split("\n"));
        expect(cache.get(loc.file)![loc.line - 1], `${loc.file}:${loc.line}`).toContain(loc.raw);
      }
    }
  });

  it("finds colors in every form the notes list", () => {
    const at = (file: string, source: string) =>
      result.colors.flatMap((c) => c.locations.map((l) => ({ ...l, value: c.value }))).filter((l) => l.file === file && l.source === source);

    expect(at("src/components/Navbar.tsx", "tailwind-class").map((l) => l.snippet)).toContain("text-[#3b82f6]");
    expect(at("src/components/Button.tsx", "tailwind-class").map((l) => l.snippet)).toContain("hover:bg-[#2563eb]");
    expect(at("src/components/CTAButton.tsx", "tailwind-class").map((l) => l.value)).toContain("#3b83f7");
    expect(at("src/pages/Billing.tsx", "inline-style")).toEqual([
      expect.objectContaining({ value: "#3b82f6", snippet: 'backgroundColor: "#3b82f6"' }),
    ]);
    expect(at("src/styles.css", "css").map((l) => l.snippet)).toContain("color: #9ca3af");
  });

  it("is deterministic", async () => {
    expect(JSON.stringify(await extractColors(FIXTURE))).toBe(JSON.stringify(result));
  });

  it("prints a readable summary", () => {
    expect(summarizeColors(result)).toBe(
      `Found 24 colors used 93 times across ${result.filesScanned} files. The Tailwind config defines 3 colors.`,
    );
  });
});
