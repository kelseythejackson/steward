import { STEWARD_EXTENSION, suggestionId, type MergeDecision } from "@steward/model";
import { describe, expect, it } from "vitest";
import { color } from "../colors/cluster.test.js";
import { suggestColorTokens } from "../colors/suggest.js";
import { checkContrast, contrastSuggestionId } from "./check.js";
import type { ContrastExtraction, PairOccurrence } from "./types.js";

const occ = (foreground: string, background: string, file: string, line: number, extra: Partial<PairOccurrence> = {}): PairOccurrence => ({
  foreground,
  background,
  use: "text",
  state: "base",
  file,
  line,
  backgroundAssumed: false,
  ...extra,
});

const extraction = (pairs: PairOccurrence[]): ContrastExtraction => ({ pairs, focus: [], skipped: [] });

// A small system: gray-400 (failing on white), gray-500, white, and a near-duplicate of gray-400.
const colors = () => suggestColorTokens([color("#9ca3af", 12), color("#6b7280", 8), color("#ffffff", 1), color("#9ca3ae", 1)]);

describe("checkContrast", () => {
  it("suggests the nearest passing token with a plain-English reason", () => {
    const report = checkContrast(
      extraction([occ("#9ca3af", "#ffffff", "a.tsx", 1), occ("#9ca3af", "#ffffff", "b.tsx", 2, { backgroundAssumed: true }), occ("#9ca3ae", "#ffffff", "b.tsx", 9)]),
      colors(),
    );
    expect(report.suggestions).toHaveLength(1);
    const s = report.suggestions[0]!;
    expect(s).toMatchObject({
      id: contrastSuggestionId("#9ca3af", "#ffffff"),
      kind: "contrast",
      members: ["#9ca3af", "#ffffff"],
      pair: { foreground: "#9ca3af", background: "#ffffff", use: "text" },
      proposed: { replaces: "foreground", path: "color.gray.500", ratio: 4.83, existing: true },
    });
    expect(s.proposed.token.$value.hex).toBe("#6b7280");
    expect(s.reason.summary).toBe(
      "gray-400 on white is 2.5:1; normal text needs 4.5:1. Used together in 3 places across 2 files. " +
        "Suggest gray-500 (#6b7280, 4.8:1), already in your system. " +
        "White background assumed in 1 of these places (set by a parent component).",
    );
    expect(s.reason.evidence).toEqual({ ratio: 2.53, required: 4.5, places: 3, files: 2, fixRatio: 4.83, backgroundAssumed: 1 });
  });

  it("checks near-duplicates as the token they merge into", () => {
    const report = checkContrast(extraction([occ("#9ca3ae", "#ffffff", "a.tsx", 1)]), colors());
    expect(report.suggestions[0]?.pair.foreground).toBe("#9ca3af");
  });

  it("does not flag pairs that pass, but lists them", () => {
    const report = checkContrast(extraction([occ("#6b7280", "#ffffff", "a.tsx", 1)]), colors());
    expect(report.suggestions).toEqual([]);
    expect(report.pairs).toEqual([expect.objectContaining({ foreground: "#6b7280", background: "#ffffff", passes: true, places: 1 })]);
  });

  it("uses the strictest requirement when a pair is used several ways", () => {
    const report = checkContrast(
      extraction([occ("#9ca3af", "#ffffff", "a.tsx", 1, { use: "large-text" }), occ("#9ca3af", "#ffffff", "a.tsx", 2, { use: "ui" }), occ("#9ca3af", "#ffffff", "a.tsx", 3)]),
      colors(),
    );
    expect(report.pairs[0]).toMatchObject({ use: "text", required: 4.5 });
  });

  it("keeps uses that pass their own requirement out of a failure", () => {
    // White on blue-500 is about 3.7:1: fails as text (4.5:1), passes as a UI border (3:1).
    const sys = suggestColorTokens([color("#3b82f6", 5), color("#ffffff", 1)]);
    const report = checkContrast(
      extraction([occ("#3b82f6", "#ffffff", "nav.tsx", 1), occ("#3b82f6", "#ffffff", "field.tsx", 2, { use: "ui", state: "focus" })]),
      sys,
    );
    const failing = report.pairs.find((p) => !p.passes)!;
    expect(failing.locations.map((l) => l.file)).toEqual(["nav.tsx"]);
    expect(report.pairs.find((p) => p.passes)).toMatchObject({ use: "ui", places: 1 });
    expect(report.suggestions[0]?.reason.evidence.places).toBe(1);
  });

  it("phrases large text and UI requirements", () => {
    const large = checkContrast(extraction([occ("#9ca3af", "#ffffff", "a.tsx", 1, { use: "large-text" })]), colors());
    expect(large.suggestions[0]?.reason.summary).toMatch(/^gray-400 on white is 2\.5:1; large text needs 3:1\./);
    const ui = checkContrast(extraction([occ("#9ca3af", "#ffffff", "a.tsx", 1, { use: "ui" })]), colors());
    expect(ui.suggestions[0]?.reason.summary).toMatch(/; form borders and icons need 3:1\./);
  });

  it("describes a background fix and a computed shade", () => {
    const sys = suggestColorTokens([color("#3b82f6", 5), color("#ffffff", 1)]);
    const report = checkContrast(extraction([occ("#ffffff", "#3b82f6", "a.tsx", 1)]), sys);
    // No darker blue token exists, so the background becomes a computed darker blue.
    expect(report.suggestions[0]?.proposed).toMatchObject({ replaces: "background", existing: false });
    expect(report.suggestions[0]?.reason.summary).toMatch(/Suggest a #[0-9a-f]{6} background \(\d\.\d:1\), a darker blue in the same hue\.$/);
  });

  it("names colors that aren't tokens by their Tailwind name or hex", () => {
    const report = checkContrast(extraction([occ("#dc2626", "#fef2f2", "a.tsx", 1, { state: "hover" })]), colors());
    expect(report.suggestions[0]?.reason.summary).toMatch(/^red-600 on red-50 is 4\.4:1; normal text needs 4\.5:1\. Used together in 1 place across 1 file\./);
  });

  it("keeps a failing token from becoming official: marks it with the open suggestion", () => {
    const report = checkContrast(extraction([occ("#9ca3af", "#ffffff", "a.tsx", 1)]), colors());
    const gray400 = report.tokens.find((t) => t.path === "color.gray.400")!;
    expect(gray400.token.$extensions?.[STEWARD_EXTENSION]?.contrastIssues).toEqual([report.suggestions[0]!.id]);
    const gray500 = report.tokens.find((t) => t.path === "color.gray.500")!;
    expect(gray500.token.$extensions?.[STEWARD_EXTENSION]?.contrastIssues).toBeUndefined();
    // The merge suggestion that proposes gray-400 carries the same mark.
    const merge = report.colorSuggestions.find((s) => s.proposed.path === "color.gray.400")!;
    expect(merge.proposed.token.$extensions?.[STEWARD_EXTENSION]?.contrastIssues).toEqual([report.suggestions[0]!.id]);
  });

  it("does not re-suggest a rejected contrast fix", () => {
    const id = contrastSuggestionId("#9ca3af", "#ffffff");
    const decisions: MergeDecision[] = [
      { suggestionId: id, kind: "contrast", members: ["#9ca3af", "#ffffff"], status: "rejected", decidedAt: "2026-11-01T00:00:00.000Z" },
    ];
    const report = checkContrast(extraction([occ("#9ca3af", "#ffffff", "a.tsx", 1)]), colors(), { decisions });
    expect(report.suggestions).toEqual([]);
    expect(report.pairs[0]?.passes).toBe(false); // still reported honestly
  });

  it("has an id that depends on which color is the foreground", () => {
    expect(contrastSuggestionId("#9ca3af", "#ffffff")).not.toBe(contrastSuggestionId("#ffffff", "#9ca3af"));
    expect(contrastSuggestionId("#9ca3af", "#ffffff")).toBe(suggestionId("contrast", ["foreground #9ca3af", "background #ffffff"]));
  });

  it("is deterministic", () => {
    const input = [occ("#9ca3af", "#ffffff", "b.tsx", 2), occ("#9ca3af", "#ffffff", "a.tsx", 1), occ("#6b7280", "#ffffff", "a.tsx", 5)];
    expect(checkContrast(extraction([...input].reverse()), colors())).toEqual(checkContrast(extraction(input), colors()));
  });
});
