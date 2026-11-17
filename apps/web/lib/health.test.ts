import type { HistoryRecord } from "@steward/model";
import { describe, expect, it } from "vitest";
import { a11yOf, driftOf, health, shownPart, pullRequestsIn, tiles, topSources, weekOf, weeklyTrend, type PullRequest } from "./health.ts";

const NOW = new Date("2026-11-17T12:00:00.000Z");
let day = 0;
function rec(over: Partial<HistoryRecord> & { problems?: Record<string, number> } = {}): HistoryRecord {
  return {
    v: 1,
    date: over.date ?? new Date(NOW.getTime() - ++day * 3_600_000).toISOString(),
    scope: "changes",
    pr: 1,
    source: "unknown",
    files: 1,
    changedLines: 10,
    problems: {},
    tokenSuggestions: 0,
    exceptions: 0,
    fixesAccepted: 0,
    components: { system: 0, total: 0, share: null },
    ...over,
  };
}
const pr = (latest: Partial<HistoryRecord>, first?: Partial<HistoryRecord>): PullRequest => ({ first: rec({ ...latest, ...first }), latest: rec(latest) });

describe("pullRequestsIn", () => {
  it("counts each pull request once (first and latest check), leaves out local checks, and keeps to the period", () => {
    const history = [
      rec({ pr: 7, date: "2026-11-10T00:00:00.000Z", problems: { "no-hardcoded-color": 3 } }),
      rec({ pr: 7, date: "2026-11-12T00:00:00.000Z", problems: { "no-hardcoded-color": 1 } }),
      rec({ pr: null, date: "2026-11-12T00:00:00.000Z" }),
      rec({ pr: 8, date: "2026-08-01T00:00:00.000Z" }),
    ];
    const r = pullRequestsIn(history, "30d", NOW);
    expect(r.pullRequests).toHaveLength(1);
    expect(r.pullRequests[0]!.first.problems["no-hardcoded-color"]).toBe(3);
    expect(r.pullRequests[0]!.latest.problems["no-hardcoded-color"]).toBe(1);
    expect(r.localChecks).toBe(1);
    expect(pullRequestsIn(history, "all", NOW).pullRequests).toHaveLength(2);
  });
});

describe("health", () => {
  it("works out the score the way the page explains it", () => {
    // Built from system: 6 of 8 = 0.75. Drift: (2 + 0 + 4) / 3 = 2 per PR → 1 − 2/10 = 0.8.
    // Accessibility: (1 + 0 + 2) / 3 = 1 per PR → 1 − 1/5 = 0.8. Clean AI: 1 of 2 AI PRs clean on arrival = 0.5.
    // Score = 100 × (0.3·0.75 + 0.3·0.8 + 0.25·0.8 + 0.15·0.5) = 100 × 0.74 = 74.
    const prs = [
      pr({ source: "ai-agent", problems: { "no-hardcoded-color": 2, "a11y-img-alt": 1 }, components: { system: 2, total: 3, share: 0.667 } }),
      pr({ source: "ai-agent", components: { system: 3, total: 3, share: 1 } }),
      pr({ source: "human", problems: { "use-system-component": 4, "a11y-label-inputs": 2 }, components: { system: 1, total: 2, share: 0.5 } }),
    ];
    const h = health(prs);
    expect(h.parts.map((p) => p.value)).toEqual([0.75, 0.8, 0.8, 0.5]);
    expect(h.score).toBe(74);
    expect(h.parts[1]!.measured).toBe("2 off-system colors, spacing values or components per pull request.");
    expect(h.parts[3]!.measured).toBe("1 of 2 AI-written pull requests needed no fixes.");
  });

  it("uses the latest check for drift (fixes during review count) and the first for clean AI output", () => {
    const fixed = pr({ source: "ai-agent", problems: {} }, { problems: { "no-hardcoded-color": 3 } });
    const h = health([fixed, fixed, fixed]);
    expect(h.parts.find((p) => p.key === "drift")!.value).toBe(1);
    expect(h.parts.find((p) => p.key === "ai")!.value).toBe(0);
  });

  it("leaves out a part with no data and scales the other weights up", () => {
    const prs = [pr({ problems: { "no-hardcoded-color": 5 } }), pr({}), pr({})];
    const h = health(prs);
    // No components checked, no AI PRs: drift (1 − 5/3/10 = 0.833) and accessibility (1) share 0.3 : 0.25.
    expect(h.parts.filter((p) => p.value === null).map((p) => p.key)).toEqual(["components", "ai"]);
    expect(h.score).toBe(Math.round((100 * (0.3 * (1 - 5 / 3 / 10) + 0.25 * 1)) / 0.55));
  });

  it("caps each part at 0, however much drift there is", () => {
    const h = health([pr({ problems: { "no-hardcoded-color": 50, "a11y-img-alt": 20 } }), pr({}), pr({})]);
    // 50 / 3 ≈ 16.7 off-system values per PR, past the limit of 10; 20 / 3 ≈ 6.7 accessibility problems, past 5.
    expect(h.parts.find((p) => p.key === "drift")!.value).toBe(0);
    expect(h.parts.find((p) => p.key === "accessibility")!.value).toBe(0);
  });

  it("adds up from the values the page shows, so anyone can check the arithmetic", () => {
    // Awkward fractions on purpose: 1.25 drift and 0.75 accessibility per PR, 7 of 9 elements, 1 of 3 AI PRs clean.
    const prs = [
      pr({ source: "ai-agent", problems: { "no-hardcoded-color": 3, "a11y-img-alt": 2 }, components: { system: 2, total: 3, share: 0.667 } }),
      pr({ source: "ai-agent", problems: { "no-arbitrary-spacing": 2 }, components: { system: 3, total: 3, share: 1 } }),
      pr({ source: "ai-agent", components: { system: 2, total: 3, share: 0.667 } }),
      pr({ source: "human", problems: { "a11y-label-inputs": 1 } }),
    ];
    const h = health(prs);
    const counted = h.parts.filter((p) => p.value !== null);
    const weight = counted.reduce((s, p) => s + p.weight, 0);
    const fromShown = Math.round((100 * counted.reduce((s, p) => s + p.weight * Number(shownPart(p.value!)), 0)) / weight);
    expect(fromShown).toBe(h.score);
    expect(h.parts.map((p) => shownPart(p.value!))).toEqual(["0.778", "0.875", "0.85", "0.333"]);
  });

  it("has no score with fewer than 3 pull requests", () => {
    expect(health([pr({}), pr({})]).score).toBeNull();
  });
});

describe("tiles and top sources", () => {
  const prs = [
    pr({ source: "ai-agent", problems: {}, fixesAccepted: 2 }, { problems: { "use-system-component": 3, "a11y-img-alt": 1 } }),
    pr({ source: "ai-agent", problems: { "use-system-component": 1 } }),
    pr({ source: "human", problems: { "no-arbitrary-spacing": 2 } }),
  ];

  it("counts drift and accessibility caught on first checks, and fixes accepted", () => {
    expect(tiles(prs)).toMatchObject({ driftCaught: 6, accessibilityFound: 1, fixesAccepted: 2, aiNoFixes: 0 });
  });

  it("ranks rules by how often they were seen, with the source type behind them (never a person)", () => {
    expect(topSources(prs)).toEqual([
      { rule: "use-system-component", timesSeen: 4, mainSource: "ai-agent" },
      { rule: "no-arbitrary-spacing", timesSeen: 2, mainSource: "human" },
      { rule: "a11y-img-alt", timesSeen: 1, mainSource: "ai-agent" },
    ]);
  });

  it("calls a source mixed when no one type is behind 60%", () => {
    const mixed = [pr({ source: "ai-agent", problems: { "no-hardcoded-color": 1 } }), pr({ source: "human", problems: { "no-hardcoded-color": 1 } })];
    expect(topSources(mixed)[0]!.mainSource).toBe("mixed");
  });

  it("splits drift from accessibility", () => {
    const r = rec({ problems: { "no-hardcoded-color": 1, "use-system-component": 1, "a11y-img-alt": 2, "a11y-text-contrast": 1 } });
    expect([driftOf(r), a11yOf(r)]).toEqual([2, 3]);
  });
});

describe("weeklyTrend", () => {
  it("scores each week's pull requests, oldest first", () => {
    const at = (date: string, problems: Record<string, number>) => ({ first: rec({ date, problems }), latest: rec({ date, problems }) });
    const trend = weeklyTrend([at("2026-11-03T10:00:00.000Z", { "no-hardcoded-color": 10 }), at("2026-11-11T10:00:00.000Z", {})]);
    expect(trend.map((t) => t.week)).toEqual(["2026-11-02", "2026-11-09"]);
    expect(trend[0]!.score).toBeLessThan(trend[1]!.score);
    expect(weekOf("2026-11-16T23:00:00.000Z")).toBe("2026-11-16");
  });
});
