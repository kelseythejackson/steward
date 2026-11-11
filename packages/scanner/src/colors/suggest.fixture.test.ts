import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { extractColors, suggestColorTokens, type ColorSuggestions } from "./index.js";

const FIXTURE = fileURLToPath(new URL("../../../../fixtures/messy-app", import.meta.url));

/** Reads "- `#from` → `#to`" lines (and the blue "`#a` and `#b` → `#to`" line) from FIXTURE_NOTES.md. */
async function expectedMergesFromNotes(): Promise<string[][]> {
  const notes = await readFile(`${FIXTURE}/FIXTURE_NOTES.md`, "utf8");
  const merges = new Map<string, Set<string>>();
  for (const m of notes.matchAll(/^(?:- |Expected merge: )(.+?) → `(#[0-9a-f]{6})`/gm)) {
    const into = m[2]!;
    const set = merges.get(into) ?? new Set([into]);
    for (const from of m[1]!.matchAll(/`(#[0-9a-f]{6})`/g)) set.add(from[1]!);
    merges.set(into, set);
  }
  return [...merges.values()].map((s) => [...s].sort()).sort((a, b) => a[0]!.localeCompare(b[0]!));
}

describe("suggestColorTokens on fixtures/messy-app", () => {
  let result: ColorSuggestions;
  beforeAll(async () => {
    result = suggestColorTokens((await extractColors(FIXTURE)).colors);
  });

  it("suggests exactly the merges listed in FIXTURE_NOTES.md", async () => {
    const expected = await expectedMergesFromNotes();
    expect(expected).toHaveLength(6); // 5 gray pairs + 1 blue group; guards against the notes format changing
    const actual = result.suggestions.map((s) => s.members).sort((a, b) => a[0]!.localeCompare(b[0]!));
    expect(actual).toEqual(expected);
  });

  it("keeps the most-used color of each group", () => {
    const keep = Object.fromEntries(result.suggestions.map((s) => [s.members.join(" "), s.proposed.token.$value.hex]));
    expect(keep["#3a81f5 #3b82f6 #3b83f7"]).toBe("#3b82f6");
    expect(keep["#6b7280 #6b7380"]).toBe("#6b7280");
    expect(keep["#e4e4e7 #e5e7eb"]).toBe("#e5e7eb");
    expect(keep["#334155 #374151"]).toBe("#374151");
  });

  it("explains the blue merge in plain English", () => {
    const blue = result.suggestions.find((s) => s.proposed.path === "color.blue.500");
    expect(blue?.reason.summary).toMatch(/^These 3 blues differ by less than you can see \(ΔE 0\.\d\)\. Used 12 times in \d+ files\.$/);
  });

  it("keeps #2563eb as its own darker blue", () => {
    expect(result.tokens.find((t) => t.token.$value.hex === "#2563eb")?.path).toBe("color.blue.600");
  });

  it("proposes unique token names, one per color group", () => {
    const paths = result.tokens.map((t) => t.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toHaveLength(24 - 7); // 24 colors; 5 grays and 2 blues are absorbed by merges
  });
});
