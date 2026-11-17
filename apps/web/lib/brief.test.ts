import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkContext } from "@steward/guard";
import { parseSystemModel } from "@steward/model";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { allLines } from "@steward/guard";
// The eval's own scoring, so these results are in exactly the format `pnpm eval:score` writes.
import { promptOf, scoreFile, totalsOf, type RunResult } from "../../../eval/src/score.ts";
import { claudeMcpAdd, CURSOR_RULE, demoDir, loadComparison, mcpConfig, namesSteward, stewardBin, toolStatus } from "./brief.ts";

const FIXTURE = fileURLToPath(new URL("../../../fixtures/messy-app", import.meta.url));
const ctx = checkContext(parseSystemModel(readFileSync(join(FIXTURE, ".steward/system.json"), "utf8")));

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "steward-brief-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("setup steps", () => {
  it("builds an MCP entry that starts Steward's server for the repo", () => {
    const config = JSON.parse(mcpConfig("/s/packages/cli/dist/bin.js", "/work/app"));
    expect(config).toEqual({ mcpServers: { steward: { type: "stdio", command: "node", args: ["/s/packages/cli/dist/bin.js", "context", "/work/app", "--serve"] } } });
    expect(namesSteward(mcpConfig("/s/packages/cli/dist/bin.js", "/work/app"))).toBe(true);
  });

  it("only counts a config that starts Steward's server", () => {
    expect(namesSteward('{"mcpServers":{"other":{"command":"npx","args":["some-server"]}}}')).toBe(false);
    expect(namesSteward("not json")).toBe(false);
  });

  it("builds the `claude mcp add` command, quoting paths with spaces", () => {
    expect(claudeMcpAdd("/s/bin.js", "/work/app")).toBe("claude mcp add steward -- node /s/bin.js context /work/app --serve");
    expect(claudeMcpAdd("/s/bin.js", "/Users/me/My App")).toBe("claude mcp add steward -- node /s/bin.js context '/Users/me/My App' --serve");
    expect(claudeMcpAdd("/s/bin.js", "/Users/me/it's")).toBe("claude mcp add steward -- node /s/bin.js context '/Users/me/it'\\''s' --serve");
  });

  it("gives Cursor a rule that always includes design.md", () => {
    expect(CURSOR_RULE).toMatch(/^---\n[\s\S]*alwaysApply: true\n---\n@design\.md\n$/);
  });

  it("finds the built CLI, or says it isn't built", async () => {
    expect(await stewardBin({}, dir)).toBeNull();
    await writeFile(join(dir, "bin.js"), "");
    expect(await stewardBin({ STEWARD_CLI: join(dir, "bin.js") }, "/nowhere")).toBe(join(dir, "bin.js"));
  });
});

describe("toolStatus", () => {
  it("reports what the repo itself sets up for each tool", async () => {
    expect(await toolStatus(dir, join(dir, "home"))).toEqual({ claudeCode: { server: false, designMd: false }, cursor: { server: false, designMd: false } });
    await writeFile(join(dir, ".mcp.json"), mcpConfig("/s/packages/cli/dist/bin.js", dir));
    await writeFile(join(dir, "CLAUDE.md"), "# App\n\n@design.md\n");
    await mkdir(join(dir, ".cursor/rules"), { recursive: true });
    await writeFile(join(dir, ".cursor/mcp.json"), mcpConfig("/s/packages/cli/dist/bin.js", dir));
    await writeFile(join(dir, ".cursor/rules/design-system.mdc"), CURSOR_RULE);
    expect(await toolStatus(dir, join(dir, "home"))).toEqual({ claudeCode: { server: true, designMd: true }, cursor: { server: true, designMd: true } });
  });

  it("sees a server added with `claude mcp add` (Claude Code's settings for this repo), not just .mcp.json", async () => {
    const home = join(dir, "home");
    await mkdir(home);
    await writeFile(join(home, ".claude.json"), JSON.stringify({ projects: { [dir]: { mcpServers: { steward: { type: "stdio", command: "node", args: ["/s/packages/cli/dist/bin.js", "context", dir, "--serve"] } } }, "/other": {} } }));
    expect((await toolStatus(dir, home)).claudeCode.server).toBe(true);
    expect((await toolStatus(join(dir, "elsewhere"), home)).claudeCode.server).toBe(false);
  });

  it("matches the real eval copy's setup", async () => {
    await writeFile(join(dir, ".mcp.json"), '{"mcpServers":{"steward":{"type":"stdio","command":"node","args":["/Users/x/steward/packages/cli/dist/bin.js","context","/Users/x/steward-eval/with","--serve"]}}}');
    await writeFile(join(dir, "CLAUDE.md"), "# Acme Metrics\n\nThis is Acme Metrics.\n\n@design.md\n");
    expect((await toolStatus(dir, join(dir, "home"))).claudeCode).toEqual({ server: true, designMd: true });
  });
});

/** Scores a snippet as a whole new file, exactly as `pnpm eval:score` does, and saves the result. */
async function saveRun(condition: "with" | "without", label: string, code: string) {
  const file = scoreFile("src/pages/Billing.tsx", code, allLines(code), ctx);
  const result: RunResult = { condition, label, prompt: promptOf(label), files: [file], totals: totalsOf([file]) };
  await mkdir(join(dir, condition), { recursive: true });
  await writeFile(join(dir, condition, `${label}.json`), `${JSON.stringify(result, null, 2)}\n`);
}

const WITHOUT = 'export const Pro = () => (\n  <div className="rounded-xl p-[22px]">\n    <img src="/pro.svg" />\n    <button className="bg-[#3b82f6] rounded-full">Start free trial</button>\n  </div>\n);\n';
const WITH = 'export const Pro = () => (\n  <Panel heading="Pro">\n    <Button variant="primary">Start free trial</Button>\n  </Panel>\n);\n';

describe("loadComparison", () => {
  it("is empty when nothing has been scored", async () => {
    expect(await loadComparison(dir)).toEqual([]);
  });

  it("pairs runs by prompt, shows the latest run, and averages when there are several", async () => {
    await saveRun("without", "pricing-1", WITHOUT);
    await saveRun("without", "pricing-2", WITHOUT.replace('    <img src="/pro.svg" />\n', ""));
    await saveRun("with", "pricing-1", WITH);
    await writeFile(join(dir, "with", "pricing-1.png"), "png");
    const [c, ...rest] = await loadComparison(dir);
    expect(rest).toEqual([]);
    expect(c!.prompt).toBe("pricing");
    expect(c!.text).toMatch(/^On the Billing page, add a pricing card/);
    expect(c!.without).toMatchObject({ runs: 2, shown: "pricing-2", screenshot: false });
    expect(c!.without!.problems).toBeGreaterThan(0);
    expect(c!.without!.average).not.toBeNull();
    expect(c!.without!.findings.length).toBeGreaterThan(0);
    expect(c!.with).toEqual({ runs: 1, shown: "pricing-1", problems: 0, addedLines: 5, byCheck: {}, average: null, findings: [], screenshot: true });
  });

  it("leaves a side empty when only one copy has been scored", async () => {
    await saveRun("without", "dialog-1", WITHOUT);
    const [c] = await loadComparison(dir);
    expect(c!.with).toBeNull();
  });

  it("finds the results folder, or says there isn't one", async () => {
    expect(await demoDir({ STEWARD_DEMO_DIR: dir }, "/nowhere")).toBe(dir);
    expect(await demoDir({}, "/nowhere")).toBeNull();
  });
});
