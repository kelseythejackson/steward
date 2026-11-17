import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseSystemModel } from "@steward/model";
import { describe, expect, it } from "vitest";
import { reviewSummary, setupSummary } from "./summary.ts";

const model = parseSystemModel(readFileSync(fileURLToPath(new URL("../../../fixtures/messy-app/.steward/system.json", import.meta.url)), "utf8"));

describe("summaries", () => {
  it("Setup counts the fixture's tokens, components and pending suggestions", () => {
    expect(setupSummary(model)).toEqual({ colors: 17, spacing: 7, components: 13, waiting: 0, decided: model.decisions.length });
  });

  it("Review counts rules on and off, and exceptions", () => {
    expect(reviewSummary(model)).toEqual({ rulesOn: model.rules.length, rulesOff: 0, exceptions: 0 });
  });
});
