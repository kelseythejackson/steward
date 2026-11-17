import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseSystemModel, type HistoryRecord } from "@steward/model";
import { describe, expect, it } from "vitest";
import { reportSummary, reviewSummary, setupSummary } from "./summary.ts";

const model = parseSystemModel(readFileSync(fileURLToPath(new URL("../../../fixtures/messy-app/.steward/system.json", import.meta.url)), "utf8"));
const record = (date: string, pr: number | null): HistoryRecord => ({
  v: 1,
  date,
  scope: "changes",
  pr,
  source: "unknown",
  files: 1,
  changedLines: 1,
  problems: {},
  tokenSuggestions: 0,
  exceptions: 0,
  fixesAccepted: null,
  components: { system: 0, total: 0, share: null },
});

describe("summaries", () => {
  it("Setup counts the fixture's tokens, components and pending suggestions", () => {
    expect(setupSummary(model)).toEqual({ colors: 17, spacing: 7, components: 13, waiting: 0, decided: model.decisions.length });
  });

  it("Review counts rules on and off, and exceptions", () => {
    expect(reviewSummary(model)).toEqual({ rulesOn: model.rules.length, rulesOff: 0, exceptions: 0 });
  });

  it("Report gives totals only: checks, distinct pull requests and the date range", () => {
    const s = reportSummary([record("2026-11-18T00:00:00.000Z", 7), record("2026-11-16T00:00:00.000Z", 7), record("2026-11-17T00:00:00.000Z", null), record("2026-11-17T01:00:00.000Z", 9)]);
    expect(s).toEqual({ checks: 4, first: "2026-11-16T00:00:00.000Z", latest: "2026-11-18T00:00:00.000Z", pullRequests: 2 });
    expect(reportSummary([])).toEqual({ checks: 0, first: null, latest: null, pullRequests: 0 });
  });
});
