import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { extractColors, suggestColorTokens } from "../colors/index.js";
import { checkContrast, extractContrast, type ContrastReport } from "./index.js";

const FIXTURE = fileURLToPath(new URL("../../../../fixtures/messy-app", import.meta.url));

interface ExpectedPair {
  fg: string;
  bg: string;
  fix: string;
  use: string;
  places: string[];
}

/** Reads the failing-pairs table in section 5b of FIXTURE_NOTES.md. */
async function expectedFailuresFromNotes(): Promise<ExpectedPair[]> {
  const notes = await readFile(`${FIXTURE}/FIXTURE_NOTES.md`, "utf8");
  const rows = [...notes.matchAll(/^\| `(#[0-9a-f]{6})`\s*\| `(#[0-9a-f]{6})`\s*\| `(#[0-9a-f]{6})` \| (\S+)\s*\|[^|]*\| ([^|]+)\|$/gm)];
  return rows.map((m) => ({
    fg: m[1]!,
    bg: m[2]!,
    fix: m[3]!,
    use: m[4]!,
    places: [...m[5]!.matchAll(/([A-Za-z]+\.(?:tsx|css)):(\d+)/g)].map((p) => `${p[1]}:${p[2]}`),
  }));
}

const base = (file: string) => file.split("/").pop()!;

describe("checkContrast on fixtures/messy-app", () => {
  let report: ContrastReport;
  let expected: ExpectedPair[];
  beforeAll(async () => {
    const [colors, contrast] = await Promise.all([extractColors(FIXTURE), extractContrast(FIXTURE)]);
    report = checkContrast(contrast, suggestColorTokens(colors.colors));
    expected = await expectedFailuresFromNotes();
  });

  it("flags exactly the failing pairs listed in FIXTURE_NOTES.md", () => {
    expect(expected).toHaveLength(9); // guards against the notes table format changing silently
    const actual = report.suggestions.map((s) => `${s.pair.foreground} on ${s.pair.background}`).sort();
    expect(actual).toEqual(expected.map((e) => `${e.fg} on ${e.bg}`).sort());
  });

  it("finds each failing pair in every place the notes list", () => {
    for (const e of expected) {
      const pair = report.pairs.find((p) => p.foreground === e.fg && p.background === e.bg);
      const places = new Set(pair?.locations.map((l) => `${base(l.file)}:${l.line}`));
      for (const place of e.places) expect(places, `${e.fg} on ${e.bg} at ${place}`).toContain(place);
    }
  });

  it("uses the requirement listed in the notes", () => {
    for (const e of expected) {
      const s = report.suggestions.find((x) => x.pair.foreground === e.fg && x.pair.background === e.bg);
      expect(s?.pair.use, `${e.fg} on ${e.bg}`).toBe(e.use);
    }
  });

  it("suggests the fix listed in the notes, and every fix passes", () => {
    for (const e of expected) {
      const s = report.suggestions.find((x) => x.pair.foreground === e.fg && x.pair.background === e.bg)!;
      expect(s.proposed.ratio).toBeGreaterThanOrEqual(e.use === "text" ? 4.5 : 3);
      if (s.proposed.existing) expect(s.proposed.token.$value.hex, `${e.fg} on ${e.bg}`).toBe(e.fix);
    }
  });

  it("explains the body-text failure the way a colleague would", () => {
    const s = report.suggestions.find((x) => x.pair.foreground === "#9ca3af" && x.pair.background === "#ffffff");
    expect(s?.reason.summary).toMatch(
      /^gray-400 on white is 2\.5:1; normal text needs 4\.5:1\. Used together in \d+ places across \d+ files\. Suggest gray-500 \(#6b7280, 4\.8:1\), already in your system\./,
    );
  });

  it("does not flag pairs the notes say pass", () => {
    const flagged = new Set(report.suggestions.map((s) => `${s.pair.foreground} on ${s.pair.background}`));
    for (const ok of ["#6b7280 on #ffffff", "#374151 on #ffffff", "#111827 on #ffffff", "#ffffff on #2563eb", "#dc2626 on #ffffff"]) {
      expect(flagged).not.toContain(ok);
    }
  });

  it("marks gray-400 and blue-500 as not ready to be official", () => {
    const issues = (path: string) => report.tokens.find((t) => t.path === path)?.token.$extensions?.["dev.steward"]?.contrastIssues ?? [];
    expect(issues("color.gray.400").length).toBeGreaterThan(0);
    expect(issues("color.blue.500").length).toBeGreaterThan(0);
    expect(issues("color.gray.900")).toEqual([]);
  });

  it("flags exactly the two focus problems in the notes", () => {
    expect(report.focus.map((f) => `${base(f.file)}:${f.line}`)).toEqual(["TextField.tsx:18", "styles.css:40"]);
  });
});
