import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateDesignMd } from "@steward/context";
import { parseSystemModel } from "@steward/model";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "./main.js";

const FIXTURE = fileURLToPath(new URL("../../../fixtures/messy-app", import.meta.url));

async function run(argv: string[], cwd: string) {
  let stdout = "";
  let stderr = "";
  const code = await main(argv, { stdout: (t) => (stdout += t), stderr: (t) => (stderr += t), cwd });
  return { code, stdout, stderr };
}

describe("steward context", () => {
  let work: string;
  let app: string;
  let expected: string;
  beforeEach(async () => {
    work = await mkdtemp(join(tmpdir(), "steward-context-"));
    app = join(work, "messy-app");
    // Keep the committed system.json (the accepted state) but leave node_modules behind.
    await cp(FIXTURE, app, { recursive: true, filter: (src) => !src.includes("node_modules") && !src.endsWith("design.md") });
    expected = generateDesignMd(parseSystemModel(await readFile(join(app, ".steward/system.json"), "utf8")), { name: "messy-app" });
  });
  afterEach(async () => {
    await rm(work, { recursive: true, force: true });
  });

  it("prints design.md without writing anything", async () => {
    const r = await run(["context", "messy-app"], work);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(expected);
    await expect(readFile(join(app, "design.md"), "utf8")).rejects.toThrow();
  });

  it("--file writes design.md to the repo root and says so", async () => {
    const r = await run(["context", "messy-app", "--file"], work);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(
      `Wrote messy-app/design.md (${expected.split("\n").length - 1} lines) from .steward/system.json.\n` +
        "Next: point your AI coding tool at it. Run this again after each scan or review to keep it current.\n",
    );
    expect(await readFile(join(app, "design.md"), "utf8")).toBe(expected);
  });

  it("overwrites a design.md it wrote before", async () => {
    await run(["context", "messy-app", "--file"], work);
    const path = join(app, "design.md");
    await writeFile(path, `${expected}\nstale line\n`);
    expect((await run(["context", "messy-app", "--file"], work)).code).toBe(0);
    expect(await readFile(path, "utf8")).toBe(expected);
  });

  it("leaves a hand-written design.md alone", async () => {
    const path = join(app, "design.md");
    await writeFile(path, "# Our design notes\n");
    const r = await run(["context", "messy-app", "--file"], work);
    expect(r.code).toBe(1);
    expect(r.stderr).toBe(
      "There's already a design.md in messy-app that Steward didn't write, so I left it alone. Rename or move it, then run this again. Or run `steward context messy-app` without --file to print it instead.\n",
    );
    expect(await readFile(path, "utf8")).toBe("# Our design notes\n");
  });

  it("asks for a scan first when there's no system yet", async () => {
    await rm(join(app, ".steward"), { recursive: true });
    const r = await run(["context", "messy-app"], work);
    expect(r.code).toBe(1);
    expect(r.stderr).toBe("There's no Steward system in messy-app yet. Run `steward scan messy-app` first.\n");
  });
});
