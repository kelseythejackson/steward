import type { Readable, Writable } from "node:stream";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult, JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type { SystemModel } from "@steward/model";
import { z } from "zod";
import { SnippetParseError } from "@steward/guard";
import { checkSnippet, findComponent, getRules, getTokens, type ToolResult } from "./tools.js";

export const SERVER_NAME = "steward";
export const SERVER_VERSION = "0.0.0";

/**
 * Loads the current system model. Called on every tool call, so a new scan
 * or review shows up without restarting the server. Throw an `Error` with a
 * calm, plain-English message when there's no system to read; the AI tool
 * sees that message as the tool's answer.
 */
export type ModelLoader = () => Promise<SystemModel>;

async function answer<T>(load: ModelLoader, run: (model: SystemModel) => ToolResult<T>): Promise<CallToolResult> {
  let model: SystemModel;
  try {
    model = await load();
  } catch (err) {
    return { isError: true, content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }] };
  }
  let result: ToolResult<T>;
  try {
    result = run(model);
  } catch (err) {
    if (!(err instanceof SnippetParseError)) throw err;
    return { isError: true, content: [{ type: "text", text: err.message }] };
  }
  return { content: [{ type: "text", text: result.text }], structuredContent: result.data as Record<string, unknown> };
}

/**
 * Steward Brief's MCP server: three read-only tools over the team's system
 * model so AI coding tools build with its own tokens, components and rules.
 * Transport-agnostic; `steward context --serve` connects it over stdio.
 */
export function createBriefServer(load: ModelLoader): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        "Steward knows this project's design system: its color and spacing tokens, shared React components and usage rules. " +
        "Before writing UI, call find_component to reuse an existing component, get_tokens for colors and spacing instead of hardcoded values, " +
        "and get_rules to follow the team's rules, including accessibility. After writing UI, call check_snippet on it and apply the fixes.",
    },
  );
  const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

  server.registerTool(
    "get_tokens",
    {
      title: "Get design tokens",
      description:
        "Lists the project's design tokens: colors (Tailwind names like gray-500, with hex values and contrast notes) and spacing steps (like 4 = 16px). " +
        "Use these instead of hex codes or arbitrary values like p-[13px].",
      inputSchema: { type: z.enum(["color", "spacing"]).optional().describe("Only colors or only spacing. Leave out for both.") },
      annotations: readOnly,
    },
    ({ type }) => answer(load, (m) => getTokens(m, type)),
  );

  server.registerTool(
    "find_component",
    {
      title: "Find a component",
      description:
        "Finds the project's shared React components that best fit a plain-English need, such as \"primary call to action\" or \"confirmation popup\". " +
        "Returns up to three, best first, each with its import, a usage example, its rules and why it matched. Use one of these before writing a new component.",
      inputSchema: { need: z.string().trim().min(1).describe('What the UI needs to do, e.g. "primary call to action".') },
      annotations: readOnly,
    },
    ({ need }) => answer(load, (m) => findComponent(m, need)),
  );

  server.registerTool(
    "get_rules",
    {
      title: "Get usage rules",
      description:
        "Lists the project's design system rules, most important first, each with a right and wrong example. " +
        'A topic narrows them: a category (color, spacing, component, accessibility or a11y) or any word, like "contrast" or "Button".',
      inputSchema: { topic: z.string().optional().describe("A category or word to narrow the rules. Leave out for every rule.") },
      annotations: readOnly,
    },
    ({ topic }) => answer(load, (m) => getRules(m, topic)),
  );

  server.registerTool(
    "check_snippet",
    {
      title: "Check a snippet",
      description:
        "Checks a piece of JSX against the project's design system and returns each problem with its line, the reason and a suggested fix. " +
        "Covers colors outside the tokens, spacing off the scale, raw <button> elements, <img> without alt text and icon-only buttons without an aria-label. " +
        "Run it on UI you've just written, before handing it back.",
      inputSchema: { code: z.string().min(1).describe("The JSX to check: a component, a file or a piece of markup.") },
      annotations: readOnly,
    },
    ({ code }) => answer(load, (m) => checkSnippet(m, code)),
  );

  return server;
}

/**
 * Serves Steward Brief over stdio until the AI tool hangs up (stdin ends),
 * then answers any requests still in flight before closing.
 * stdout carries the protocol, so nothing else may write to it meanwhile.
 */
export async function serveOverStdio(load: ModelLoader, streams: { stdin?: Readable | undefined; stdout?: Writable | undefined } = {}): Promise<void> {
  const stdin = streams.stdin ?? process.stdin;
  const server = createBriefServer(load);
  const transport = new StdioServerTransport(stdin, streams.stdout ?? process.stdout);
  const hungUp = new Promise<void>((resolve) => {
    stdin.once("end", resolve);
    stdin.once("close", resolve);
  });
  await server.connect(transport);

  // Track requests until their response is sent, so hanging up never drops an answer.
  const inFlight = new Set<string | number>();
  let settled: (() => void) | undefined;
  const received = transport.onmessage;
  transport.onmessage = (message: JSONRPCMessage) => {
    if ("id" in message && "method" in message) inFlight.add(message.id);
    received?.(message);
  };
  const send = transport.send.bind(transport);
  transport.send = async (message: JSONRPCMessage) => {
    await send(message);
    if ("id" in message && message.id !== undefined && !("method" in message) && inFlight.delete(message.id) && inFlight.size === 0) settled?.();
  };

  await hungUp;
  if (inFlight.size > 0) await new Promise<void>((resolve) => (settled = resolve));
  await server.close();
}
