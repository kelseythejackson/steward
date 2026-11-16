import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { parseSystemModel, type SystemModel } from "@steward/model";
import { afterEach, describe, expect, it } from "vitest";
import { createBriefServer, type ModelLoader } from "./mcp-server.js";
import { checkSnippet, findComponent, getRules, getTokens } from "./tools.js";

const FIXTURE_MODEL = fileURLToPath(new URL("../../../fixtures/messy-app/.steward/system.json", import.meta.url));
const fixture = (): SystemModel => parseSystemModel(readFileSync(FIXTURE_MODEL, "utf8"));

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

async function connect(load: ModelLoader) {
  const server = createBriefServer(load);
  const client = new Client({ name: "test", version: "0.0.0" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  close = async () => {
    await client.close();
    await server.close();
  };
  return client;
}

const textOf = (r: Awaited<ReturnType<Client["callTool"]>>) => (r.content as { type: string; text: string }[])[0]!.text;

describe("Steward Brief MCP server", () => {
  it("lists the four read-only tools", async () => {
    const client = await connect(async () => fixture());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["check_snippet", "find_component", "get_rules", "get_tokens"]);
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
    expect(client.getInstructions()).toContain("find_component");
  });

  it("get_tokens answers with text and data, filtered by type", async () => {
    const client = await connect(async () => fixture());
    const r = await client.callTool({ name: "get_tokens", arguments: { type: "spacing" } });
    expect(textOf(r)).toBe(getTokens(fixture(), "spacing").text);
    expect(r.structuredContent).toEqual(getTokens(fixture(), "spacing").data);
  });

  it("get_tokens refuses a type it doesn't know", async () => {
    const client = await connect(async () => fixture());
    const r = await client.callTool({ name: "get_tokens", arguments: { type: "typography" } });
    expect(r.isError).toBe(true);
  });

  it("find_component returns the best matches for a need", async () => {
    const client = await connect(async () => fixture());
    const r = await client.callTool({ name: "find_component", arguments: { need: "primary call to action" } });
    expect(textOf(r)).toBe(findComponent(fixture(), "primary call to action").text);
    expect((r.structuredContent as { matches: { name: string }[] }).matches[0]!.name).toBe("Button");
  });

  it("find_component needs a description", async () => {
    const client = await connect(async () => fixture());
    expect((await client.callTool({ name: "find_component", arguments: { need: "  " } })).isError).toBe(true);
  });

  it("get_rules returns rules for a topic, or all of them", async () => {
    const client = await connect(async () => fixture());
    const some = await client.callTool({ name: "get_rules", arguments: { topic: "spacing" } });
    expect(textOf(some)).toBe(getRules(fixture(), "spacing").text);
    const all = await client.callTool({ name: "get_rules", arguments: {} });
    expect((all.structuredContent as { rules: unknown[] }).rules).toHaveLength(25);
  });

  it("check_snippet returns each problem with a fix", async () => {
    const client = await connect(async () => fixture());
    const code = `<button className="p-[13px]" onClick={close}><XIcon /></button>`;
    const r = await client.callTool({ name: "check_snippet", arguments: { code } });
    expect(r.isError).toBeFalsy();
    expect(textOf(r)).toBe(checkSnippet(fixture(), code).text);
    const findings = (r.structuredContent as { findings: { rule: string; fix: { replacement?: string } }[] }).findings;
    expect(findings.map((f) => f.rule)).toEqual(["use-system-component", "a11y-accessible-name", "no-arbitrary-spacing"]);
  });

  it("check_snippet says calmly when the code isn't JSX", async () => {
    const client = await connect(async () => fixture());
    const r = await client.callTool({ name: "check_snippet", arguments: { code: "<div className=" } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/^I couldn't read that as JSX, so nothing was checked\./);
  });

  it("reads the system again on every call, so a new scan shows up without a restart", async () => {
    let model = fixture();
    const client = await connect(async () => model);
    const before = await client.callTool({ name: "get_rules", arguments: {} });
    model = { ...model, rules: model.rules.slice(0, 1) };
    const after = await client.callTool({ name: "get_rules", arguments: {} });
    expect((before.structuredContent as { rules: unknown[] }).rules).toHaveLength(25);
    expect((after.structuredContent as { rules: unknown[] }).rules).toHaveLength(1);
  });

  it("passes on a calm message when there's no system to read", async () => {
    const client = await connect(async () => {
      throw new Error("There's no Steward system in app yet. Run `steward scan app` first.");
    });
    const r = await client.callTool({ name: "get_tokens", arguments: {} });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toBe("There's no Steward system in app yet. Run `steward scan app` first.");
  });
});
