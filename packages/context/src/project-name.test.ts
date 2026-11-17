import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { projectName } from "./project-name.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "steward-name-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("projectName", () => {
  it("uses package.json's name, without its scope", async () => {
    await writeFile(join(dir, "package.json"), '{ "name": "acme-metrics" }');
    expect(await projectName(dir)).toBe("acme-metrics");
    await writeFile(join(dir, "package.json"), '{ "name": "@acme/web" }');
    expect(await projectName(dir)).toBe("web");
  });

  it("falls back to the folder's name when there's no usable package.json", async () => {
    expect(await projectName(dir)).toMatch(/^steward-name-/);
    await writeFile(join(dir, "package.json"), "not json");
    expect(await projectName(dir)).toMatch(/^steward-name-/);
  });
});
