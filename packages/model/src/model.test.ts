import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  emptySystemModel,
  parseSystemModel,
  readSystemModel,
  serializeSystemModel,
  suggestionId,
  SystemModelError,
  systemModelPath,
  writeSystemModel,
  type ColorToken,
  type SystemModel,
} from "./index.js";

const blue: ColorToken = {
  $type: "color",
  $value: { colorSpace: "srgb", components: [0.231, 0.51, 0.965], hex: "#3b82f6" },
  $extensions: { "dev.steward": { uses: 12, mergedFrom: ["#3b83f7", "#3a81f5"] } },
};

const gray = (hex: string, uses: number): ColorToken => ({
  $type: "color",
  $value: { colorSpace: "srgb", components: [0.5, 0.5, 0.5], hex },
  $extensions: { "dev.steward": { uses } },
});

/** A realistic model shaped like what the scanner will produce for messy-app. */
function sampleModel(): SystemModel {
  const blueMembers = ["#3b82f6", "#3a81f5", "#3b83f7"];
  return {
    version: 1,
    tokens: {
      spacing: {
        "3": { $type: "dimension", $value: { value: 12, unit: "px" } },
        "2": { $type: "dimension", $value: { value: 8, unit: "px" } },
      },
      color: {
        gray: { "900": gray("#111827", 8), "50": gray("#f9fafb", 2), "500": gray("#6b7280", 12) },
        blue: { "500": blue },
      },
    },
    components: [
      { name: "Panel", filePath: "src/components/Panel.tsx", variants: [] },
      {
        name: "Button",
        filePath: "src/components/Button.tsx",
        line: 17,
        variants: ["secondary", "primary", "ghost"],
        props: ["variant", "children", "className"],
        rootElements: ["button"],
      },
    ],
    suggestions: [
      {
        id: suggestionId("component", ["Panel", "Card"]),
        kind: "component",
        members: ["Panel", "Card"],
        proposed: { name: "Card" },
        reason: { summary: "Card and Panel render the same container.", evidence: { sharedClasses: 5 } },
      },
      {
        id: suggestionId("color", blueMembers),
        kind: "color",
        members: blueMembers,
        proposed: { path: "color.blue.500", token: blue },
        reason: { summary: "These 3 blues are nearly identical.", evidence: { maxDeltaE: 1.2, uses: 12 } },
      },
      {
        id: suggestionId("contrast", ["foreground #9ca3af", "background #ffffff"]),
        kind: "contrast",
        members: ["#9ca3af", "#ffffff"],
        pair: { foreground: "#9ca3af", background: "#ffffff", use: "text" },
        proposed: { replaces: "foreground", path: "color.gray.500", token: gray("#6b7280", 12), ratio: 4.83, existing: true },
        reason: {
          summary: "gray-400 on white is 2.5:1; normal text needs 4.5:1.",
          evidence: { ratio: 2.54, required: 4.5, uses: 12 },
        },
      },
      {
        id: suggestionId("spacing", ["9px", "7px", "8px"]),
        kind: "spacing",
        members: ["9px", "7px", "8px"],
        proposed: { path: "spacing.2", token: { $type: "dimension", $value: { value: 8, unit: "px" } } },
        locations: [
          { file: "src/styles.css", line: 24, value: "padding: 9px 13px" },
          { file: "src/components/Card.tsx", line: 12, value: "mt-[7px]" },
        ],
        reason: { summary: "7px and 9px are 1px from 8px, the nearest step on the scale.", evidence: { step: 8, uses: 2 } },
      },
    ],
    decisions: [
      {
        suggestionId: suggestionId("spacing", ["13px", "12px"]),
        kind: "spacing",
        members: ["13px", "12px"],
        status: "rejected",
        decidedAt: "2026-11-08T10:00:00.000Z",
      },
    ],
    rules: [
      {
        id: "no-raw-button",
        text: "Use <Button> instead of a raw <button>.",
        category: "component",
        appliesTo: [
          { kind: "element", name: "button" },
          { kind: "component", name: "Button" },
        ],
        examples: { right: "<Button>Save</Button>", wrong: "<button>Save</button>" },
        source: "generated",
        basedOn: ["component-b", "component-a"],
        severity: "warn",
        enabled: true,
      },
      {
        id: "img-alt",
        text: "Images need alt text.",
        category: "accessibility",
        appliesTo: [{ kind: "element", name: "img" }],
        examples: { right: '<img src="/a.png" alt="Chart of sales" />', wrong: '<img src="/a.png" />' },
        source: "user",
        severity: "warn",
        enabled: true,
      },
    ],
  };
}

/** Recursively reverses object key order and list order, to prove output doesn't depend on input order. */
function scramble(value: unknown, path = ""): unknown {
  if (Array.isArray(value)) {
    // A color's components are ordered data, so leave them alone.
    if (path.endsWith(".components") && value.every((v) => typeof v === "number")) return value;
    return [...value].reverse().map((v, i) => scramble(v, `${path}[${i}]`));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).reverse()) out[key] = scramble((value as Record<string, unknown>)[key], `${path}.${key}`);
    return out;
  }
  return value;
}

describe("suggestionId", () => {
  it("is the same whatever order the members are in", () => {
    expect(suggestionId("color", ["#3a81f5", "#3b82f6"])).toBe(suggestionId("color", ["#3b82f6", "#3a81f5"]));
  });

  it("ignores duplicate members", () => {
    expect(suggestionId("color", ["#aaa", "#bbb", "#aaa"])).toBe(suggestionId("color", ["#aaa", "#bbb"]));
  });

  it("differs by kind and by members, and is readable", () => {
    const id = suggestionId("color", ["a", "b"]);
    expect(id).toMatch(/^color-[0-9a-f]{12}$/);
    expect(suggestionId("spacing", ["a", "b"])).not.toBe(id);
    expect(suggestionId("color", ["a", "c"])).not.toBe(id);
  });
});

describe("serializeSystemModel", () => {
  it("gives byte-identical output for the same model in a different order", () => {
    const model = sampleModel();
    expect(serializeSystemModel(scramble(model) as SystemModel)).toBe(serializeSystemModel(model));
  });

  it("sorts keys, lists and member lists", () => {
    const out = JSON.parse(serializeSystemModel(sampleModel()));
    expect(Object.keys(out)).toEqual(["components", "decisions", "rules", "suggestions", "tokens", "version"]);
    expect(out.components.map((c: { name: string }) => c.name)).toEqual(["Button", "Panel"]);
    expect(out.components[0].variants).toEqual(["ghost", "primary", "secondary"]);
    expect(out.components[0].props).toEqual(["children", "className", "variant"]);
    expect(out.rules.map((r: { id: string }) => r.id)).toEqual(["img-alt", "no-raw-button"]);
    expect(out.rules[1].basedOn).toEqual(["component-a", "component-b"]);
    expect(out.rules[1].appliesTo).toEqual([
      { kind: "component", name: "Button" },
      { kind: "element", name: "button" },
    ]);
    expect(out.decisions[0].members).toEqual(["12px", "13px"]);
    const ids = out.suggestions.map((s: { id: string }) => s.id);
    expect(ids).toEqual([...ids].sort());
    expect(out.tokens.color.blue["500"].$extensions["dev.steward"].mergedFrom).toEqual(["#3a81f5", "#3b83f7"]);
    const spacing = out.suggestions.find((s: { kind: string }) => s.kind === "spacing");
    expect(spacing.locations.map((l: { file: string }) => l.file)).toEqual(["src/components/Card.tsx", "src/styles.css"]);
  });

  it("keeps numeric token names in numeric order (50, 500, 900), not string order", () => {
    const out = serializeSystemModel(sampleModel());
    // Read the raw text: JSON.parse would reorder integer-like keys itself and hide a bug.
    const grayBlock = out.slice(out.indexOf('"gray": {'));
    const order = ['"50"', '"500"', '"900"'].map((k) => grayBlock.indexOf(k));
    expect(order.every((i) => i > 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("does not reorder a color's components", () => {
    const out = JSON.parse(serializeSystemModel(sampleModel()));
    expect(out.tokens.color.blue["500"].$value.components).toEqual([0.231, 0.51, 0.965]);
  });

  it("uses 2-space indentation and ends with a newline", () => {
    const out = serializeSystemModel(emptySystemModel());
    expect(out.endsWith("}\n")).toBe(true);
    expect(out).toContain('\n  "version": 1');
  });

  it("does not mutate the model it is given", () => {
    const model = sampleModel();
    const before = JSON.stringify(model);
    serializeSystemModel(model);
    expect(JSON.stringify(model)).toBe(before);
  });
});

describe("parseSystemModel", () => {
  it("round-trips a serialized model", () => {
    const text = serializeSystemModel(sampleModel());
    expect(serializeSystemModel(parseSystemModel(text))).toBe(text);
  });

  it("keeps other tools' $extensions and unknown fields", () => {
    const model = sampleModel() as unknown as Record<string, any>;
    model.tokens.color.blue["500"].$extensions["com.figma"] = { variableId: "VariableID:1:2" };
    model.notes = "kept";
    const out = JSON.parse(serializeSystemModel(parseSystemModel(JSON.stringify(model))));
    expect(out.tokens.color.blue["500"].$extensions["com.figma"]).toEqual({ variableId: "VariableID:1:2" });
    expect(out.notes).toBe("kept");
  });

  it("explains invalid JSON", () => {
    expect(() => parseSystemModel("{ nope")).toThrow(/\.steward\/system\.json isn't valid JSON/);
  });

  it("explains an unsupported version", () => {
    const text = JSON.stringify({ ...emptySystemModel(), version: 2 });
    expect(() => parseSystemModel(text)).toThrow("uses format version 2. This version of Steward reads version 1.");
  });

  const broken: [string, (m: Record<string, any>) => void, string][] = [
    ["a color token with no hex", (m) => delete m.tokens.color.blue["500"].$value.hex, "tokens.color.blue.500.$value.hex"],
    ["a color with 2 components", (m) => (m.tokens.color.gray["50"].$value.components = [1, 2]), "tokens.color.gray.50.$value.components"],
    ["an unsupported token type", (m) => (m.tokens.spacing["2"].$type = "shadow"), "tokens.spacing.2.$type"],
    ["an unknown dimension unit", (m) => (m.tokens.spacing["2"].$value.unit = "em"), "tokens.spacing.2.$value.unit"],
    ["a negative usage count", (m) => (m.tokens.color.gray["50"].$extensions["dev.steward"].uses = -1), "tokens.color.gray.50.$extensions.dev.steward.uses"],
    ["a component with no name", (m) => delete m.components[0].name, "components[0].name"],
    ["component props that aren't a list", (m) => (m.components[1].props = "variant"), "components[1].props"],
    ["component root elements that aren't a list", (m) => (m.components[1].rootElements = [1]), "components[1].rootElements"],
    ["a component with a bad line", (m) => (m.components[1].line = 0), "components[1].line"],
    ["a suggestion with one member", (m) => (m.suggestions[0].members = ["Card"]), "suggestions[0].members"],
    ["a suggestion with no reason", (m) => delete m.suggestions[1].reason, "suggestions[1].reason"],
    ["a color suggestion proposing a dimension", (m) => (m.suggestions[1].proposed.token = m.tokens.spacing["2"]), "suggestions[1].proposed.token.$type"],
    ["a contrast suggestion with no pair", (m) => delete m.suggestions[2].pair, "suggestions[2].pair"],
    ["a contrast pair with an unknown use", (m) => (m.suggestions[2].pair.use = "heading"), "suggestions[2].pair.use"],
    ["a contrast pair with a non-hex color", (m) => (m.suggestions[2].pair.background = "white"), "suggestions[2].pair.background"],
    ["a contrast fix with no ratio", (m) => delete m.suggestions[2].proposed.ratio, "suggestions[2].proposed.ratio"],
    ["a contrast fix replacing an unknown side", (m) => (m.suggestions[2].proposed.replaces = "border"), "suggestions[2].proposed.replaces"],
    ["contrastIssues that aren't a list", (m) => (m.tokens.color.gray["50"].$extensions["dev.steward"].contrastIssues = "x"), "tokens.color.gray.50.$extensions.dev.steward.contrastIssues"],
    ["spacing locations that aren't a list", (m) => (m.suggestions[3].locations = "src/a.tsx"), "suggestions[3].locations"],
    ["a spacing location with no line", (m) => delete m.suggestions[3].locations[0].line, "suggestions[3].locations[0].line"],
    ["a spacing location with no file", (m) => (m.suggestions[3].locations[1].file = ""), "suggestions[3].locations[1].file"],
    ["a decision with an unknown status", (m) => (m.decisions[0].status = "maybe"), "decisions[0].status"],
    ["a decision with a bad date", (m) => (m.decisions[0].decidedAt = "yesterday"), "decisions[0].decidedAt"],
    ["a rule with a non-boolean enabled", (m) => (m.rules[0].enabled = "yes"), "rules[0].enabled"],
    ["a rule with no text", (m) => (m.rules[0].text = " "), "rules[0].text"],
    ["a rule with an unknown category", (m) => (m.rules[0].category = "motion"), "rules[0].category"],
    ["a rule with an unknown source", (m) => (m.rules[1].source = "ai"), "rules[1].source"],
    ["a rule target of an unknown kind", (m) => (m.rules[0].appliesTo[0].kind = "page"), "rules[0].appliesTo[0].kind"],
    ["a token target with no path", (m) => (m.rules[0].appliesTo[0] = { kind: "token" }), "rules[0].appliesTo[0].path"],
    ["a rule with no wrong example", (m) => delete m.rules[1].examples.wrong, "rules[1].examples.wrong"],
    ["basedOn that isn't a list", (m) => (m.rules[0].basedOn = "component-a"), "rules[0].basedOn"],
    ["two rules with the same id", (m) => (m.rules[1].id = "no-raw-button"), "rules[1].id"],
  ];

  it.each(broken)("points at the exact problem for %s", (_label, breakIt, path) => {
    const model = JSON.parse(JSON.stringify(sampleModel()));
    breakIt(model);
    let error: unknown;
    try {
      parseSystemModel(JSON.stringify(model));
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(SystemModelError);
    expect((error as SystemModelError).path).toBe(path);
    expect((error as SystemModelError).message).toContain(`\`${path}\``);
  });
});

describe("readSystemModel / writeSystemModel", () => {
  let repo: string;
  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), "steward-model-"));
  });
  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it("returns null when Steward hasn't been set up in the repo", async () => {
    expect(await readSystemModel(repo)).toBeNull();
  });

  it("creates .steward/ and writes the canonical form", async () => {
    const written = await writeSystemModel(repo, sampleModel());
    expect(written).toBe(systemModelPath(repo));
    expect(await readFile(written, "utf8")).toBe(serializeSystemModel(sampleModel()));
  });

  it("round-trips through the file system", async () => {
    await writeSystemModel(repo, sampleModel());
    const read = await readSystemModel(repo);
    expect(read).not.toBeNull();
    expect(serializeSystemModel(read!)).toBe(serializeSystemModel(sampleModel()));
  });

  it("writes the same bytes twice in a row", async () => {
    await writeSystemModel(repo, scramble(sampleModel()) as SystemModel);
    const first = await readFile(systemModelPath(repo), "utf8");
    await writeSystemModel(repo, (await readSystemModel(repo))!);
    expect(await readFile(systemModelPath(repo), "utf8")).toBe(first);
  });

  it("reports a malformed file with its path", async () => {
    await mkdir(join(repo, ".steward"), { recursive: true });
    await writeFile(systemModelPath(repo), "[]", "utf8");
    await expect(readSystemModel(repo)).rejects.toThrow(".steward/system.json has a value that should be an object");
  });
});
