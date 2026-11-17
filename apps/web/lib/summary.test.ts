import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseSystemModel } from "@steward/model";
import { describe, expect, it } from "vitest";
import { contrastSummary } from "./contrast-summary.ts";
import { reviewSummary, setupSummary } from "./summary.ts";

const model = parseSystemModel(readFileSync(fileURLToPath(new URL("../../../fixtures/messy-app/.steward/system.json", import.meta.url)), "utf8"));

describe("summaries", () => {
  it("Setup counts the fixture's tokens, components and pending suggestions", () => {
    expect(setupSummary(model)).toEqual({ colors: 18, spacing: 7, components: 13, waiting: 0, decided: model.decisions.length });
  });

  it("Review counts rules on and off, and exceptions", () => {
    expect(reviewSummary(model)).toEqual({ rulesOn: model.rules.length, rulesOff: 0, exceptions: 0 });
  });
});

describe("the Contrast card's summary", () => {
  it("counts only accepted fixes as fixed (a declined fix still fails)", () => {
    expect(contrastSummary(9, 0)).toBe("9 pairs below WCAG AA");
    expect(contrastSummary(9, 2)).toBe("7 of 9 pairs still below WCAG AA · 2 fixed");
    expect(contrastSummary(9, 9)).toBe("All 9 pairs fixed");
    expect(contrastSummary(1, 0)).toBe("1 pair below WCAG AA");
    expect(contrastSummary(1, 1)).toBe("1 pair fixed");
    expect(contrastSummary(0, 0)).toBe("0 pairs below WCAG AA");
  });
});
