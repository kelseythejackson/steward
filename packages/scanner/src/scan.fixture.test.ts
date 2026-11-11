import { fileURLToPath } from "node:url";
import { emptySystemModel, isToken, parseSystemModel, serializeSystemModel, type MergeDecision, type SystemModel } from "@steward/model";
import { beforeAll, describe, expect, it } from "vitest";
import { readSourceFiles } from "./colors/walk.js";
import { buildSystemModel, listFiles, scanFiles, scanRepo, summarizeScan, type ScanResult } from "./index.js";

const FIXTURE = fileURLToPath(new URL("../../../fixtures/messy-app", import.meta.url));

describe("scanRepo on fixtures/messy-app", () => {
  let result: ScanResult;
  let model: SystemModel;
  beforeAll(async () => {
    result = await scanRepo(FIXTURE);
    model = buildSystemModel(result);
  });

  it("reads each source file once, including CSS and the Tailwind config", () => {
    expect(result.files).toContain("src/styles.css");
    expect(result.files).toContain("tailwind.config.ts");
    expect(result.files).toContain("src/lib/cn.ts");
    expect(new Set(result.files).size).toBe(result.files.length);
  });

  it("summarizes the counts FIXTURE_NOTES.md expects", () => {
    const s = summarizeScan(result);
    expect(s.colorFamilies.slice(0, 2)).toEqual([
      { family: "gray", found: 14, suggested: 9 },
      { family: "blue", found: 4, suggested: 2 },
    ]);
    expect(s.colors).toEqual({ found: 24, suggested: 17, merges: 6, keptApart: 0 });
    expect(s.components).toMatchObject({ duplicateGroups: 2, duplicateComponents: 5 });
    expect(s.accessibility).toMatchObject({ failingPairs: 9, fixesSuggested: 9, focusProblems: 2 });
    expect(s.spacing.scaleSteps).toBe(result.spacingSuggestions.scale.length);
    expect(s.skippedFiles).toEqual([]);
  });

  it("builds a model that survives a round trip through system.json", () => {
    const text = serializeSystemModel(model);
    expect(serializeSystemModel(parseSystemModel(text, "system.json"))).toBe(text);
  });

  it("puts color and spacing tokens under their paths, with contrast marks", () => {
    const gray = model.tokens.color as Record<string, unknown>;
    const gray400 = (gray.gray as Record<string, unknown>)["400"];
    expect(gray400 && isToken(gray400 as never)).toBe(true);
    expect((gray400 as { $extensions: Record<string, { contrastIssues?: string[] }> }).$extensions["dev.steward"]!.contrastIssues!.length).toBeGreaterThan(0);
    for (const t of result.spacingSuggestions.tokens) {
      const [group, step] = t.path.split(".");
      expect((model.tokens[group!] as Record<string, unknown>)[step!]).toEqual(t.token);
    }
  });

  it("includes every kind of suggestion and every component", () => {
    const kinds = new Set(model.suggestions.map((s) => s.kind));
    expect([...kinds].sort()).toEqual(["color", "component", "contrast", "spacing"]);
    expect(model.suggestions).toHaveLength(6 + result.spacingSuggestions.suggestions.length + 2 + 9);
    expect(model.components).toHaveLength(13);
  });

  it("gives the same bytes for the same input, whatever order files arrive in", async () => {
    const files = await readSourceFiles(FIXTURE, await listFiles(FIXTURE, () => true));
    const again = scanFiles([...files].reverse());
    expect(serializeSystemModel(buildSystemModel(again))).toBe(serializeSystemModel(model));
  });

  it("keeps decisions and rules from the previous model and honors rejections", async () => {
    const blue = model.suggestions.find((s) => s.kind === "color" && s.members.includes("#3a81f5"))!;
    const decision: MergeDecision = { suggestionId: blue.id, kind: "color", members: blue.members, status: "rejected", decidedAt: "2026-11-01T00:00:00.000Z" };
    const previous: SystemModel = { ...emptySystemModel(), decisions: [decision], rules: [{ id: "no-raw-button", severity: "warn", enabled: true }] };

    const rescanned = buildSystemModel(await scanRepo(FIXTURE, { decisions: previous.decisions }), previous);
    expect(rescanned.decisions).toEqual([decision]);
    expect(rescanned.rules).toEqual(previous.rules);
    expect(rescanned.suggestions.map((s) => s.id)).not.toContain(blue.id);
  });

  it("reports files it couldn't read instead of stopping", () => {
    const r = scanFiles([
      { path: "src/Broken.tsx", content: "export function Broken( {" },
      { path: "src/Ok.tsx", content: 'export function Ok() { return <p className="text-[#111827]">hi</p>; }' },
    ]);
    expect(summarizeScan(r).skippedFiles).toEqual(["src/Broken.tsx"]);
    expect(r.colors.colors.map((c) => c.value)).toEqual(["#111827"]);
  });
});
