import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
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
    expected = generateDesignMd(parseSystemModel(await readFile(join(app, ".steward/system.json"), "utf8")), { name: "fixture-messy-app" }); // from its package.json name, without the @steward/ scope
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

  describe("--serve", () => {
    it("speaks MCP over stdio until the AI tool hangs up, with messages on stderr only", async () => {
      const stdin = new PassThrough();
      const stdoutStream = new PassThrough();
      let stdout = "";
      let stderr = "";
      let protocol = "";
      stdoutStream.on("data", (chunk: Buffer) => (protocol += chunk.toString("utf8")));
      const running = main(["context", "messy-app", "--serve"], {
        stdout: (t) => (stdout += t),
        stderr: (t) => (stderr += t),
        cwd: work,
        stdin,
        stdoutStream,
      });

      const send = (msg: object) => stdin.write(`${JSON.stringify(msg)}\n`);
      const reply = async (id: number) => {
        for (let i = 0; i < 200; i++) {
          const line = protocol.split("\n").find((l) => l.includes(`"id":${id}`));
          if (line) return JSON.parse(line);
          await new Promise((r) => setTimeout(r, 5));
        }
        throw new Error(`no reply to ${id}; got ${protocol}`);
      };
      send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } } });
      expect((await reply(1)).result.serverInfo.name).toBe("steward");
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
      send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "find_component", arguments: { need: "primary call to action" } } });
      expect((await reply(2)).result.structuredContent.matches[0].name).toBe("Button");

      stdin.end();
      expect(await running).toBe(0);
      expect(stdout).toBe("");
      expect(stderr).toBe(
        "Steward Brief is serving fixture-messy-app's design system to AI tools over stdio. It reads only .steward/system.json, and nothing leaves this machine. Press Ctrl+C to stop.\n",
      );
    });

    it("answers requests still in flight when the AI tool hangs up", async () => {
      const stdin = new PassThrough();
      const stdoutStream = new PassThrough();
      let protocol = "";
      stdoutStream.on("data", (chunk: Buffer) => (protocol += chunk.toString("utf8")));
      const running = main(["context", "messy-app", "--serve"], { stdout: () => {}, stderr: () => {}, cwd: work, stdin, stdoutStream });
      const init = { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } };
      stdin.end(
        [
          { jsonrpc: "2.0", id: 1, method: "initialize", params: init },
          { jsonrpc: "2.0", method: "notifications/initialized" },
          { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_tokens", arguments: { type: "spacing" } } },
        ]
          .map((m) => `${JSON.stringify(m)}\n`)
          .join(""),
      );
      expect(await running).toBe(0);
      const ids = protocol.trim().split("\n").map((l) => JSON.parse(l).id);
      expect(ids).toEqual([1, 2]);
    });

    it("asks for a scan first instead of starting with no system", async () => {
      await rm(join(app, ".steward"), { recursive: true });
      const r = await run(["context", "messy-app", "--serve"], work);
      expect(r.code).toBe(1);
      expect(r.stderr).toBe("There's no Steward system in messy-app yet. Run `steward scan messy-app` first.\n");
    });

    it("won't do --file and --serve at once", async () => {
      const r = await run(["context", "messy-app", "--serve", "--file"], work);
      expect(r.code).toBe(1);
      expect(r.stderr).toBe("Use --file or --serve, not both: --file writes design.md, --serve starts the MCP server.\n");
    });
  });
});
