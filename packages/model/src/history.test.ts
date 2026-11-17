import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendHistory, checkHistoryRecord, HISTORY_FIELDS, HistoryError, parseHistory, readHistory, serializeHistoryRecord, type HistoryRecord } from "./history.js";

const record = (over: Partial<HistoryRecord> = {}): HistoryRecord => ({
  v: 1,
  date: "2026-11-17T10:00:00.000Z",
  scope: "changes",
  pr: 7,
  source: "ai-agent",
  files: 2,
  changedLines: 12,
  problems: { "no-hardcoded-color": 2, "a11y-img-alt": 1 },
  tokenSuggestions: 0,
  exceptions: 1,
  fixesAccepted: 1,
  components: { system: 3, total: 4, share: 0.75 },
  ...over,
});

describe("history records", () => {
  it("serialize to one line, fields in a fixed order, problems sorted", () => {
    const line = serializeHistoryRecord(record());
    expect(line).not.toContain("\n");
    expect(Object.keys(JSON.parse(line))).toEqual([...HISTORY_FIELDS]);
    expect(Object.keys(JSON.parse(line).problems)).toEqual(["a11y-img-alt", "no-hardcoded-color"]);
  });

  it.each([
    ["an author", { author: "jane-doe" }],
    ["a username", { username: "jane-doe" }],
    ["an email", { email: "jane@example.com" }],
    ["per-person counts", { byAuthor: { "jane-doe": 3 } }],
  ])("refuse %s: only the listed fields are kept", (_, extra) => {
    expect(() => serializeHistoryRecord({ ...record(), ...extra } as HistoryRecord)).toThrow(HistoryError);
    expect(() => serializeHistoryRecord({ ...record(), ...extra } as HistoryRecord)).toThrow(/which history doesn't keep/);
  });

  it("refuse extra fields inside components, and names used as problem keys", () => {
    expect(() => checkHistoryRecord({ ...record(), components: { system: 1, total: 1, share: 1, author: "jane-doe" } })).toThrow(/components\.author/);
    expect(() => checkHistoryRecord({ ...record(), problems: { "Jane Doe": 1 } })).toThrow(/problems\.Jane Doe/);
  });

  it.each([
    ["a source that isn't a type", { source: "jane-doe" }, /"source"/],
    ["a PR number of 0", { pr: 0 }, /"pr"/],
    ["a negative count", { files: -1 }, /"files"/],
    ["a share over 1", { components: { system: 2, total: 1, share: 2 } }, /components/],
    ["a missing field", { fixesAccepted: undefined }, /missing "fixesAccepted"|"fixesAccepted"/],
  ])("refuse %s", (_, over, message) => {
    const r = { ...record(), ...over } as Record<string, unknown>;
    if (r["fixesAccepted"] === undefined) delete r["fixesAccepted"];
    expect(() => checkHistoryRecord(r)).toThrow(message);
  });

  it("parse back, skipping blank lines and naming a bad line", () => {
    const text = `${serializeHistoryRecord(record())}\n\n${serializeHistoryRecord(record({ pr: null, source: "unknown" }))}\n`;
    expect(parseHistory(text).map((r) => r.source)).toEqual(["ai-agent", "unknown"]);
    expect(() => parseHistory(`${serializeHistoryRecord(record())}\n{"author":"x"}\n`)).toThrow(/line 2: /);
  });
});

describe("appendHistory", () => {
  it("only ever appends: earlier lines stay byte for byte", async () => {
    const root = await mkdtemp(join(tmpdir(), "steward-history-"));
    try {
      expect(await readHistory(root)).toEqual([]);
      await appendHistory(root, record());
      const first = await readFile(join(root, ".steward/history.jsonl"), "utf8");
      await appendHistory(root, record({ pr: 8 }));
      const both = await readFile(join(root, ".steward/history.jsonl"), "utf8");
      expect(both.startsWith(first)).toBe(true);
      expect((await readHistory(root)).map((r) => r.pr)).toEqual([7, 8]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses to write a record with an author, and leaves the file as it was", async () => {
    const root = await mkdtemp(join(tmpdir(), "steward-history-"));
    try {
      await mkdir(join(root, ".steward"));
      await writeFile(join(root, ".steward/history.jsonl"), `${serializeHistoryRecord(record())}\n`);
      await expect(appendHistory(root, { ...record(), author: "jane-doe" } as HistoryRecord)).rejects.toThrow(HistoryError);
      expect(await readFile(join(root, ".steward/history.jsonl"), "utf8")).toBe(`${serializeHistoryRecord(record())}\n`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
