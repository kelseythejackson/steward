import { fileURLToPath } from "node:url";
import { serializeSystemModel, type MergeDecision, type Rule, type Suggestion } from "@steward/model";
import { beforeAll, describe, expect, it } from "vitest";
import { listFiles, readSourceFiles } from "../colors/walk.js";
import type { SourceFile } from "../colors/types.js";
import { buildSystemModel, scanFiles, type ScanResult } from "../scan.js";
import { generateRules, mergeRules } from "./generate.js";

const FIXTURE = fileURLToPath(new URL("../../../../fixtures/messy-app", import.meta.url));
const DECIDED = "2026-11-12T10:00:00.000Z";

const decide = (s: Suggestion, status: MergeDecision["status"] = "accepted"): MergeDecision => ({
  suggestionId: s.id,
  kind: s.kind,
  members: s.members,
  status,
  decidedAt: DECIDED,
});

const byId = (rules: readonly Rule[], id: string) => rules.find((r) => r.id === id);

describe("starter rules on fixtures/messy-app", () => {
  let files: SourceFile[];
  let first: ScanResult;
  let suggestions: Suggestion[];
  beforeAll(async () => {
    files = await readSourceFiles(FIXTURE, await listFiles(FIXTURE, () => true));
    first = scanFiles(files);
    suggestions = buildSystemModel(first).suggestions;
  });
  const find = (pred: (s: Suggestion) => boolean) => suggestions.find(pred)!;

  it("starts with the accessibility basics only, before anything is accepted", () => {
    expect(first.rules.map((r) => r.id)).toEqual([
      "a11y-click-target",
      "a11y-focus-visible",
      "a11y-icon-button-label",
      "a11y-img-alt",
      "a11y-input-label",
      "a11y-text-contrast",
    ]);
    expect(first.rules.every((r) => r.source === "generated" && r.category === "accessibility" && r.severity === "warn" && r.enabled)).toBe(true);
    expect(byId(first.rules, "a11y-icon-button-label")!.text).toBe("Icon-only buttons need an aria-label that says what they do.");
  });

  it("names the lightest gray in the system that passes for body text on white", () => {
    const rule = byId(first.rules, "a11y-text-contrast")!;
    expect(rule.text).toMatch(/^Text needs at least 4\.5:1 contrast/);
    expect(rule.text).toContain("On white, body text uses `gray-500` or darker.");
    expect(rule.examples.right).toBe('<p className="text-gray-500 bg-white">Due today</p>');
  });

  it("makes no rules from rejected or undecided suggestions", () => {
    const rejected = suggestions.filter((s) => s.kind !== "contrast").map((s) => decide(s, "rejected"));
    const r = scanFiles(files, { decisions: rejected });
    expect(r.rules.map((x) => x.id)).toEqual(first.rules.map((x) => x.id));
  });

  it("turns an accepted color merge into a use-the-token rule", () => {
    const blue = find((s) => s.kind === "color" && s.members.includes("#3a81f5"));
    const rules = scanFiles(files, { decisions: [decide(blue)] }).rules;
    expect(byId(rules, "use-token-blue-500")).toEqual({
      id: "use-token-blue-500",
      text: "Use `blue-500` (#3b82f6) instead of #3a81f5 or #3b83f7.",
      category: "color",
      appliesTo: [{ kind: "token", path: "color.blue.500" }],
      examples: { right: '<div className="bg-blue-500">', wrong: '<div className="bg-[#3a81f5]">' },
      source: "generated",
      basedOn: [blue.id],
      severity: "warn",
      enabled: true,
    });
  });

  it("makes one spacing rule for the whole scale, however many snaps were accepted", () => {
    const spacing = suggestions.filter((s) => s.kind === "spacing");
    const rules = scanFiles(files, { decisions: spacing.map((s) => decide(s)) }).rules;
    const rule = byId(rules, "spacing-tokens-only")!;
    expect(rule.text).toBe("Only use spacing tokens (4, 8, 10, 12, 16, 24, 32px); no arbitrary values like `p-[2px]`.");
    expect(rule.examples).toEqual({ right: '<div className="p-1">', wrong: '<div className="p-[2px]">' });
    expect(rule.appliesTo).toEqual([{ kind: "token-group", path: "spacing" }]);
    expect(rule.basedOn).toEqual(spacing.map((s) => s.id).sort());
  });

  it("turns an accepted component merge into a use-this-component rule, and a no-raw-button rule for a button", () => {
    const button = find((s) => s.kind === "component" && s.members.includes("PrimaryBtn"));
    const rules = scanFiles(files, { decisions: [decide(button)] }).rules;
    expect(byId(rules, "use-component-button")!.text).toBe("Use `<Button>` instead of `<CTAButton>` or `<PrimaryBtn>`.");
    expect(byId(rules, "use-component-button")!.examples).toEqual({ right: "<Button>Save</Button>", wrong: "<CTAButton>Save</CTAButton>" });
    expect(byId(rules, "no-raw-button")!.text).toBe(
      'Use `<Button variant="primary">` for the main action on a page and `<Button>` for other actions; never a raw `<button>`.',
    );
    expect(byId(rules, "no-raw-button")!.appliesTo).toEqual([
      { kind: "component", name: "Button" },
      { kind: "element", name: "button" },
    ]);
    // The accessibility basics then show the team's own button.
    expect(byId(rules, "a11y-icon-button-label")!.examples.right).toBe('<Button aria-label="Close"><XIcon /></Button>');
  });

  it("makes no raw-element rule when the kept component isn't a button", () => {
    const panel = find((s) => s.kind === "component" && s.members.includes("Panel"));
    const rules = scanFiles(files, { decisions: [decide(panel)] }).rules;
    expect(byId(rules, "use-component-panel")!.text).toBe("Use `<Panel>` instead of `<Card>`.");
    expect(byId(rules, "use-component-panel")!.examples).toEqual({ right: "<Panel>…</Panel>", wrong: "<Card>…</Card>" });
    expect(byId(rules, "no-raw-button")).toBeUndefined();
  });

  it("turns an accepted contrast fix into a plain rule with the ratio it needs", () => {
    const gray = find((s) => s.kind === "contrast" && s.pair.foreground === "#9ca3af" && s.pair.background === "#ffffff");
    const rule = byId(scanFiles(files, { decisions: [decide(gray)] }).rules, "contrast-gray-400-on-white")!;
    expect(rule.text).toBe("Text on `white` uses `gray-500` or darker (needs 4.5:1).");
    expect(rule.category).toBe("accessibility");
    expect(rule.examples).toEqual({
      right: '<p className="text-gray-500 bg-white">Due today</p>',
      wrong: '<p className="text-gray-400 bg-white">Due today</p>',
    });
    expect(rule.appliesTo.map((t) => (t.kind === "token" ? t.path : ""))).toEqual(["color.gray.400", "color.gray.500", "color.white"]);
  });

  it("words a background fix from the background's side", () => {
    const blue = find((s) => s.kind === "contrast" && s.pair.foreground === "#ffffff" && s.pair.background === "#3b82f6");
    const rule = byId(scanFiles(files, { decisions: [decide(blue)] }).rules, "contrast-white-on-blue-500")!;
    expect(rule.text).toBe("Behind `white` text, use a `blue-600` background or darker (needs 4.5:1).");
    expect(rule.examples.right).toBe('<p className="text-white bg-blue-600">Due today</p>');
  });

  it("names a new shade by its hex, as the suggestion's reason does", () => {
    const red = find((s) => s.kind === "contrast" && s.pair.foreground === "#dc2626");
    expect(red.kind === "contrast" && red.proposed.existing).toBe(false);
    const rule = byId(scanFiles(files, { decisions: [decide(red)] }).rules, "contrast-red-600-on-red-50")!;
    expect(rule.text).toBe("Text on `red-50` uses `#da2324` or darker (needs 4.5:1).");
    expect(rule.examples.right).toBe('<p className="text-[#da2324] bg-red-50">Due today</p>');
    expect(rule.appliesTo).toEqual([
      { kind: "token", path: "color.red.50" },
      { kind: "token", path: "color.red.600" },
    ]);
  });

  it("gives the same rules in the same order every time", () => {
    const all = suggestions.map((s) => decide(s));
    const a = buildSystemModel(scanFiles(files, { decisions: all }));
    const b = buildSystemModel(scanFiles([...files].reverse(), { decisions: [...all].reverse() }));
    expect(serializeSystemModel(b)).toBe(serializeSystemModel(a));
    expect(a.rules.map((r) => r.id)).toEqual([...a.rules.map((r) => r.id)].sort());
  });
});

describe("mergeRules", () => {
  const rule = (id: string, extra: Partial<Rule> = {}): Rule => ({
    id,
    text: `Rule ${id}.`,
    category: "color",
    appliesTo: [{ kind: "token", path: "color.blue.500" }],
    examples: { right: "right", wrong: "wrong" },
    source: "generated",
    severity: "warn",
    enabled: true,
    ...extra,
  });
  const accepted = (id: string): MergeDecision => ({ suggestionId: id, kind: "color", members: ["#000000", "#010101"], status: "accepted", decidedAt: DECIDED });

  it("keeps people's own and learned rules exactly as they are, even over a generated rule with the same id", () => {
    const own = rule("use-token-blue-500", { source: "user", text: "Our own wording." });
    const learned = rule("learned-1", { source: "learned" });
    expect(mergeRules([rule("use-token-blue-500")], [own, learned], [])).toEqual([learned, own]);
  });

  it("keeps a person's on/off and severity choice when a rule is regenerated", () => {
    const before = rule("a11y-img-alt", { enabled: false, severity: "error", text: "Old text." });
    expect(mergeRules([rule("a11y-img-alt")], [before], [])).toEqual([rule("a11y-img-alt", { enabled: false, severity: "error" })]);
  });

  it("keeps a generated rule while its decision stands, even once the suggestion is gone", () => {
    const before = rule("use-token-blue-500", { basedOn: ["color-a"] });
    expect(mergeRules([], [before], [accepted("color-a")])).toEqual([before]);
  });

  it("drops a generated rule once a decision behind it is undone", () => {
    const before = rule("use-token-blue-500", { basedOn: ["color-a", "color-b"] });
    expect(mergeRules([], [before], [accepted("color-a")])).toEqual([]);
  });

  it("drops a generated rule with no basis that wasn't regenerated", () => {
    expect(mergeRules([], [rule("a11y-retired")], [])).toEqual([]);
  });

  it("keeps the earlier basis of a regenerated rule while those decisions stand", () => {
    const before = rule("spacing-tokens-only", { basedOn: ["spacing-a", "spacing-gone"] });
    const merged = mergeRules([rule("spacing-tokens-only", { basedOn: ["spacing-b"] })], [before], [accepted("spacing-a"), accepted("spacing-b")]);
    expect(merged[0]!.basedOn).toEqual(["spacing-a", "spacing-b"]);
  });

  it("is what generateRules feeds into, with rules sorted by id", () => {
    const rules = generateRules({ decisions: [], suggestions: [], colorTokens: [], spacingTokens: [], components: [] });
    expect(rules.map((r) => r.id)).toEqual([...rules.map((r) => r.id)].sort());
    expect(byId(rules, "a11y-text-contrast")!.text).not.toContain("On white");
  });
});
