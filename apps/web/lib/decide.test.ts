/** Saving decisions on a fresh scan of the fixture, in a temp folder: everything is waiting, as after a first `steward scan`. */
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runScan } from "@steward/cli";
import { colorTokenGroups, parseSystemModel, pendingSuggestions, serializeSystemModel, systemModelPath, type SystemModel } from "@steward/model";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyDecision } from "./decide.ts";
import { reviewData } from "./review-data.ts";
import { versionOf } from "./version.ts";

const FIXTURE = fileURLToPath(new URL("../../../fixtures/messy-app", import.meta.url));
const NOW = "2026-11-17T10:00:00.000Z";

let repo: string;
const text = () => readFile(systemModelPath(repo), "utf8");
const model = async (): Promise<SystemModel> => parseSystemModel(await text());
const version = async () => versionOf(await text());

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "steward-decide-"));
  // Like `pnpm -F web demo`: a copy without FIXTURE_NOTES.md, so it isn't treated as the read-only fixture.
  await cp(FIXTURE, repo, { recursive: true, filter: (src) => !src.includes("node_modules") && !src.includes("/.steward") && !src.endsWith("FIXTURE_NOTES.md") });
  await runScan(repo, { now: NOW });
}, 60_000);
afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe("applyDecision", () => {
  it("accepts everything waiting, and says so", async () => {
    expect(pendingSuggestions(await model())).toHaveLength(24);
    const r = await applyDecision(repo, await version(), { kind: "accept-all" }, NOW);
    expect(r).toEqual({ ok: true, message: "Accepted all 24 suggestions.", version: await version() });
    expect(pendingSuggestions(await model())).toEqual([]);
  });

  it("re-scans after saving, so rules follow the decision right away", async () => {
    const before = (await model()).rules.length;
    const merge = (await model()).suggestions.find((s) => s.kind === "component" && s.members.includes("Card"))!;
    await applyDecision(repo, await version(), { kind: "accept", ids: [merge.id] }, NOW);
    const after = await model();
    expect(after.rules.length).toBeGreaterThan(before);
    expect(after.rules.some((r) => r.id === "use-component-panel")).toBe(true);
  });

  it("never overwrites changes made since the page loaded", async () => {
    const stale = await version();
    const m = await model();
    await applyDecision(repo, stale, { kind: "accept", ids: [m.suggestions[0]!.id] }, NOW);
    const r = await applyDecision(repo, stale, { kind: "accept-all" }, NOW);
    expect(r).toEqual({ ok: false, message: "The system changed since this page loaded, so nothing was saved. Reload to see the latest, then try again." });
    expect(pendingSuggestions(await model())).toHaveLength(23);
  });

  it("saves edited color groups, and the re-scan keeps them", async () => {
    const r = await applyDecision(repo, await version(), { kind: "color-groups", groups: [{ members: ["#e4e4e7"], path: "color.zinc.200" }] }, NOW);
    expect(r).toMatchObject({ ok: true, message: "Saved 1 color group." });
    const groups = colorTokenGroups(await model());
    expect(groups.find((g) => g.path === "color.zinc.200")!.members).toEqual(["#e4e4e7"]);
    expect(groups.find((g) => g.path === "color.gray.200")!.members).toEqual(["#e5e7eb"]);
  });

  it("leaves a spacing value off, so it's never suggested again", async () => {
    const snap = (await model()).suggestions.find((s) => s.kind === "spacing" && s.members.includes("9px"))!;
    const r = await applyDecision(repo, await version(), { kind: "leave-off", id: snap.id, values: ["9px"] }, NOW);
    expect(r).toMatchObject({ ok: true, message: "9px won't snap. Review will still flag it as off the scale." });
    expect((await model()).suggestions.some((s) => s.kind === "spacing" && s.members.includes("9px"))).toBe(false);
  });

  it("keeps the component a person chose", async () => {
    const merge = (await model()).suggestions.find((s) => s.kind === "component" && s.members.includes("Card"))!;
    await applyDecision(repo, await version(), { kind: "keep", id: merge.id, keep: "Card" }, NOW);
    const again = (await model()).suggestions.find((s) => s.id === merge.id)!;
    expect(again.kind === "component" && again.proposed.name).toBe("Card");
    expect((await model()).decisions.find((d) => d.suggestionId === merge.id)).toMatchObject({ status: "accepted", keep: "Card" });
  });

  it("keeps a color merge apart: after the re-scan the colors are separate tokens, and it isn't suggested again", async () => {
    const merge = (await model()).suggestions.find((s) => s.kind === "color" && s.members.includes("#e4e4e7"))!;
    const r = await applyDecision(repo, await version(), { kind: "reject", ids: [merge.id] }, NOW);
    expect(r).toMatchObject({ ok: true, message: "Kept as it is. Steward won't suggest it again." });
    const after = await model();
    const owner = (hex: string) => colorTokenGroups(after).find((g) => g.members.includes(hex))!.path;
    expect(owner("#e4e4e7")).not.toBe(owner("#e5e7eb"));
    // Every other token keeps its name: code using bg-gray-50 still means #f9fafb.
    expect(owner("#f9fafb")).toBe("color.gray.50");
    expect(owner("#e5e7eb")).toBe("color.gray.200");
    expect(owner("#e4e4e7")).toBe("color.gray.e4e4e7");
    expect(after.suggestions.some((s) => s.kind === "color" && s.members.includes("#e4e4e7"))).toBe(false);
    expect(after.decisions).toContainEqual(expect.objectContaining({ suggestionId: merge.id, status: "rejected" }));
  });

  it("refuses a name that would break the scan, and leaves system.json as it was", async () => {
    const before = await text();
    const gray = colorTokenGroups(await model()).find((g) => g.path === "color.gray.500")!;
    const r = await applyDecision(repo, await version(), { kind: "color-groups", groups: [{ members: gray.members, path: "color.gray" }] }, NOW);
    expect(r).toMatchObject({ ok: false, message: expect.stringMatching(/can't sit beside/) });
    expect(await text()).toBe(before);
    await expect(runScan(repo, { now: NOW })).resolves.toBeDefined();
  });

  it("puts system.json back if the re-scan fails after saving", async () => {
    // A decision the checks allow but the scan can't place: a hand-made clash, standing in for any scan failure.
    const m = await model();
    m.decisions.push({ suggestionId: "color-x", kind: "color", members: ["#e5e7eb"], status: "accepted", decidedAt: NOW, edited: true, path: "color.gray.500.x" });
    await writeFile(systemModelPath(repo), serializeSystemModel(m));
    const saved = await text();
    const r = await applyDecision(repo, versionOf(saved), { kind: "accept-all" }, NOW);
    expect(r).toMatchObject({ ok: false, message: expect.stringMatching(/^Steward couldn't re-scan with that decision \(.*\), so nothing was saved and the system is as it was\.$/) });
    expect(await text()).toBe(saved);
  });

  it("never changes Steward's own fixture: tests depend on it", async () => {
    const fixtureText = await readFile(systemModelPath(FIXTURE), "utf8");
    const r = await applyDecision(FIXTURE, versionOf(fixtureText), { kind: "undo", id: parseSystemModel(fixtureText).decisions[0]!.suggestionId }, NOW);
    expect(r).toEqual({ ok: false, message: "This is Steward's own test fixture, and its tests depend on it, so decisions aren't saved here. Run `pnpm -F web demo` for a copy you can change." });
    expect(await readFile(systemModelPath(FIXTURE), "utf8")).toBe(fixtureText);
  });

  it("never loses a decision when two saves arrive at once: the second is told to reload", async () => {
    const v = await version();
    const [a, b] = (await model()).suggestions.filter((x) => x.kind === "component");
    const [ra, rb] = await Promise.all([
      applyDecision(repo, v, { kind: "accept", ids: [a!.id] }, NOW),
      applyDecision(repo, v, { kind: "accept", ids: [b!.id] }, NOW),
    ]);
    expect(ra).toMatchObject({ ok: true });
    expect(rb).toEqual({ ok: false, message: "The system changed since this page loaded, so nothing was saved. Reload to see the latest, then try again." });
    const decided = (await model()).decisions.map((d) => d.suggestionId);
    expect(decided).toContain(a!.id);
    expect(decided).not.toContain(b!.id);
  });

  it("keeps a declined contrast fix on the card after the re-scan: still failing, not waiting, and undoable", async () => {
    const fix = (await model()).suggestions.find((s) => s.kind === "contrast")!;
    expect(await applyDecision(repo, await version(), { kind: "reject", ids: [fix.id] }, NOW)).toMatchObject({
      ok: true,
      message: "Fix declined. The pair still fails WCAG AA, so it stays on the Contrast card; you can undo this there.",
    });
    const after = reviewData(await model());
    expect(after.contrast.find((c) => c.id === fix.id)).toMatchObject({ status: "rejected" });
    expect(pendingSuggestions(await model()).map((s) => s.id)).not.toContain(fix.id);
    const r = await applyDecision(repo, await version(), { kind: "undo", id: fix.id }, NOW);
    expect(r).toMatchObject({ ok: true });
    expect(pendingSuggestions(await model()).map((s) => s.id)).toContain(fix.id);
  });

  it("undoes a decision", async () => {
    const id = (await model()).suggestions[0]!.id;
    await applyDecision(repo, await version(), { kind: "reject", ids: [id] }, NOW);
    const r = await applyDecision(repo, await version(), { kind: "undo", id }, NOW);
    expect(r).toMatchObject({ ok: true, message: "Undone. It's waiting for a decision again." });
    expect(pendingSuggestions(await model()).map((s) => s.id)).toContain(id);
  });

  it("explains a decision that doesn't fit, and writes nothing", async () => {
    const before = await text();
    const r = await applyDecision(repo, await version(), { kind: "color-groups", groups: [{ members: ["#e4e4e7"], path: "Zinc 200" }] }, NOW);
    expect(r).toEqual({ ok: false, message: '"Zinc 200" isn\'t a token name Steward can use. Use lowercase words and numbers after "color.", like color.gray.150.' });
    expect(await text()).toBe(before);
  });
});
