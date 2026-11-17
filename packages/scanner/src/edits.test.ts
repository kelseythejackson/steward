/** Scans honor what a person arranged on the review screen: color groups and names, and which component to keep. */
import { fileURLToPath } from "node:url";
import { acceptSuggestions, colorTokenGroups, editColorGroups, keepComponent, pendingSuggestions, serializeSystemModel, parseSystemModel, type MergeDecision } from "@steward/model";
import { beforeAll, describe, expect, it } from "vitest";
import { colorsInModel } from "./index.js";
import { buildSystemModel, scanFiles, scanRepo, type ScanResult } from "./scan.js";

const FIXTURE = fileURLToPath(new URL("../../../fixtures/messy-app", import.meta.url));
const NOW = "2026-11-17T10:00:00.000Z";
let first: ReturnType<typeof buildSystemModel>;
const scanWith = async (decisions: MergeDecision[]): Promise<ScanResult> => scanRepo(FIXTURE, { decisions });

beforeAll(async () => {
  first = buildSystemModel(await scanWith([]));
});

const group = (model: ReturnType<typeof buildSystemModel>, path: string) => colorTokenGroups(model).find((g) => g.path === path);

describe("color groups a person arranged", () => {
  it("keep a color moved out on its own, under the name the person chose", async () => {
    expect(group(first, "color.gray.200")!.members).toContain("#e4e4e7");
    const decided = editColorGroups(first, [{ members: ["#e4e4e7"], path: "color.zinc.200" }], NOW);
    const next = buildSystemModel(await scanWith(decided.decisions), decided);
    expect(group(next, "color.zinc.200")!.members).toEqual(["#e4e4e7"]);
    expect(group(next, "color.gray.200")!.members).toEqual(["#e5e7eb"]);
    expect(next.suggestions.some((s) => s.kind === "color" && s.members.includes("#e4e4e7"))).toBe(false);
  });

  it("keep colors moved into another group together, as accepted, with a reason that says a person grouped them", async () => {
    const decided = editColorGroups(first, [{ members: ["#e4e4e7", "#f3f4f6"], path: "color.gray.100" }, { members: ["#e5e7eb"], path: "color.gray.200" }], NOW);
    const next = buildSystemModel(await scanWith(decided.decisions), decided);
    expect(group(next, "color.gray.100")!.members.sort()).toEqual(["#e4e4e7", "#f3f4f6"]);
    const s = next.suggestions.find((x) => x.kind === "color" && x.members.includes("#e4e4e7"))!;
    expect(s.reason.summary).toMatch(/^You grouped these 2 colors as one token\./);
    expect(pendingSuggestions(next).some((x) => x.id === s.id)).toBe(false);
    // And the result is valid, canonical system.json.
    expect(() => parseSystemModel(serializeSystemModel(next))).not.toThrow();
  });

  it("rename a token without changing its colors", async () => {
    const decided = editColorGroups(first, [{ members: group(first, "color.blue.600")!.members, path: "color.brand" }], NOW);
    const next = buildSystemModel(await scanWith(decided.decisions), decided);
    expect(group(next, "color.brand")!.members).toEqual(group(first, "color.blue.600")!.members);
    expect(group(next, "color.blue.600")).toBeUndefined();
  });

  it("give the same system on every scan after", async () => {
    const decided = editColorGroups(first, [{ members: ["#e4e4e7"], path: "color.zinc.200" }], NOW);
    const a = buildSystemModel(await scanWith(decided.decisions), decided);
    const b = buildSystemModel(await scanWith(a.decisions), a);
    expect(serializeSystemModel(b)).toBe(serializeSystemModel(a));
  });
});

describe("a new color accepted as a token, then renamed", () => {
  it("scans cleanly under the new name, with the old name gone", () => {
    const base = [{ path: "A.tsx", content: `export const A = () => <p className="bg-[#3b82f6] text-white">x</p>;` }];
    const withNew = [...base, { path: "B.tsx", content: `export const B = () => <div><p className="bg-[#7c3aed]">a</p><p className="bg-[#7c3aed]">b</p><p className="bg-[#7c3aed]">c</p></div>;` }];
    const scan = (files: typeof base, m: ReturnType<typeof buildSystemModel>) => buildSystemModel(scanFiles(files, { decisions: m.decisions, knownColors: colorsInModel(m.tokens) }), m);

    const m1 = buildSystemModel(scanFiles(base));
    const m2 = scan(withNew, m1);
    const suggested = m2.suggestions.find((s) => s.kind === "token" && s.members.includes("#7c3aed"))!;
    const accepted = scan(withNew, acceptSuggestions(m2, [suggested.id], NOW));
    expect(colorTokenGroups(accepted).some((g) => g.members.includes("#7c3aed"))).toBe(true);

    const renamed = editColorGroups(accepted, [{ members: ["#7c3aed"], path: "color.brand" }], NOW);
    expect(renamed.decisions.filter((d) => d.members.includes("#7c3aed")).map((d) => d.kind)).toEqual(["color"]);
    const next = scan(withNew, renamed);
    expect(group(next, "color.brand")!.members).toEqual(["#7c3aed"]);
    expect(colorTokenGroups(next).filter((g) => g.members.includes("#7c3aed"))).toHaveLength(1);
    expect(scan(withNew, next)).toEqual(next);
  });
});

describe("component keeper a person chose", () => {
  it("is the one kept on the next scan", async () => {
    const merge = first.suggestions.find((s) => s.kind === "component" && s.members.includes("Card"))!;
    expect(merge.kind === "component" && merge.proposed.name).toBe("Panel");
    const decided = keepComponent(first, merge.id, "Card", NOW);
    const next = buildSystemModel(await scanWith(decided.decisions), decided);
    const again = next.suggestions.find((s) => s.id === merge.id)!;
    expect(again.kind === "component" && again.proposed.name).toBe("Card");
  });
});
