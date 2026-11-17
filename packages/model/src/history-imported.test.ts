import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  historyImportedPath,
  parseImportedArtifacts,
  readImportedArtifacts,
  serializeImportedArtifacts,
  writeImportedArtifacts,
} from "./history-imported.js";

describe("history-imported.json", () => {
  it("writes ids only, deduplicated and sorted", () => {
    expect(serializeImportedArtifacts([30, 4, 30, 1000])).toBe("[4,30,1000]\n");
    expect(serializeImportedArtifacts([])).toBe("[]\n");
  });

  it("keeps only positive whole numbers, never names or URLs", () => {
    expect([...parseImportedArtifacts('[3, 1, "jane-doe", {"login": "x"}, -2, 1.5, "https://x", 2]')].sort()).toEqual([1, 2, 3]);
    expect(serializeImportedArtifacts([5, "jane" as unknown as number, 0])).toBe("[5]\n");
  });

  it.each([["{ broken"], ['{"artifacts": [1]}'], ["null"], [""]])("treats %j as empty", (text) => {
    expect(parseImportedArtifacts(text).size).toBe(0);
  });

  describe("on disk", () => {
    let root: string;
    beforeEach(async () => {
      root = await mkdtemp(join(tmpdir(), "steward-imported-"));
    });
    afterEach(async () => {
      await rm(root, { recursive: true, force: true });
    });

    it("is empty when there's no file, and reads back what it wrote", async () => {
      expect((await readImportedArtifacts(root)).size).toBe(0);
      const path = await writeImportedArtifacts(root, new Set([9, 2]));
      expect(path).toBe(join(root, ".steward", "history-imported.json"));
      expect(await readFile(path, "utf8")).toBe("[2,9]\n");
      expect([...(await readImportedArtifacts(root))]).toEqual([2, 9]);
    });

    it("treats a damaged file as empty", async () => {
      await mkdir(join(root, ".steward"));
      await writeFile(historyImportedPath(root), "<<<<<<< HEAD\n[1]\n");
      expect((await readImportedArtifacts(root)).size).toBe(0);
    });
  });
});
