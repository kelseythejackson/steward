import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseStewardConfig, readStewardConfig, StewardConfigError } from "./config.js";

describe("parseStewardConfig", () => {
  it("fills in the defaults: warn mode, every rule on", () => {
    expect(parseStewardConfig("{}")).toEqual({ mode: "warn", rules: {} });
  });

  it("reads mode, base and rule switches", () => {
    const text = JSON.stringify({ mode: "error", base: " develop ", rules: { "a11y-img-alt": "off", "no-hardcoded-color": "on" } });
    expect(parseStewardConfig(text)).toEqual({ mode: "error", base: "develop", rules: { "a11y-img-alt": "off", "no-hardcoded-color": "on" } });
  });

  it.each([
    ["not JSON", "{ mode: warn }", /isn't valid JSON/],
    ["a list", "[]", /should be an object/],
    ["an unknown key", '{"severity":"warn"}', /"severity", which Steward doesn't use/],
    ["an unknown mode", '{"mode":"strict"}', /mode "strict". Use "warn" \(never fails the build\) or "error"/],
    ["an empty base", '{"base":""}', /"base" that should be a branch name/],
    ["rules as a list", '{"rules":["a11y-img-alt"]}', /"rules" that should be an object/],
    ["a rule set to true", '{"rules":{"a11y-img-alt":false}}', /turns rule "a11y-img-alt" to false. Use "on" or "off"/],
  ])("explains %s calmly", (_, text, message) => {
    expect(() => parseStewardConfig(text)).toThrow(StewardConfigError);
    expect(() => parseStewardConfig(text)).toThrow(message);
  });

  it("names the file in its messages", () => {
    expect(() => parseStewardConfig("[]")).toThrow(/^\.steward\/config\.json should be/);
  });
});

describe("readStewardConfig", () => {
  it("returns the defaults when there's no config file, and reads one when there is", async () => {
    const root = await mkdtemp(join(tmpdir(), "steward-config-"));
    try {
      expect(await readStewardConfig(root)).toEqual({ mode: "warn", rules: {} });
      await mkdir(join(root, ".steward"));
      await writeFile(join(root, ".steward/config.json"), '{"mode":"error"}');
      expect(await readStewardConfig(root)).toEqual({ mode: "error", rules: {} });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("source hints", () => {
  it("reads label and bot lists for telling AI-written PRs apart", () => {
    expect(parseStewardConfig('{"source":{"aiLabels":["ai-generated"," copilot "]}}').source).toEqual({ aiLabels: ["ai-generated", "copilot"] });
  });

  it("explains unknown keys and values that aren't lists of names", () => {
    expect(() => parseStewardConfig('{"source":{"authors":["jane"]}}')).toThrow(/"source\.authors", which Steward doesn't use/);
    expect(() => parseStewardConfig('{"source":{"aiBots":"claude[bot]"}}')).toThrow(/"source\.aiBots" that should be a list of names/);
  });
});
