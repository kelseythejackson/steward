/**
 * The Brief screen's data: setup steps for AI tools, whether a repo is set
 * up for them, and the week 2 before/after comparison from `eval/results`.
 * Server-side; reads files, never writes.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

type Env = Readonly<Record<string, string | undefined>>;

const exists = async (p: string) => {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------------------
// Setup steps
// ---------------------------------------------------------------------------

/**
 * Where Steward's built CLI is, for the MCP server command. The app runs
 * from apps/web (or the Steward repo root via pnpm), so look there;
 * `STEWARD_CLI` overrides. Null when it isn't built yet.
 */
export async function stewardBin(env: Env, cwd: string): Promise<string | null> {
  const candidates = [env["STEWARD_CLI"], resolve(cwd, "../../packages/cli/dist/bin.js"), env["INIT_CWD"] && resolve(env["INIT_CWD"], "packages/cli/dist/bin.js")];
  for (const c of candidates) if (c && (await exists(c))) return c;
  return null;
}

/** Pure: the MCP server entry for a repo, the same for Claude Code (.mcp.json) and Cursor (.cursor/mcp.json). */
export function mcpConfig(bin: string, repo: string): string {
  return `${JSON.stringify({ mcpServers: { steward: { type: "stdio", command: "node", args: [bin, "context", repo, "--serve"] } } }, null, 2)}\n`;
}

/** Pure: a Cursor rule that puts design.md in every request. */
export const CURSOR_RULE = `---
description: Our design system (tokens, components, rules), written by Steward
alwaysApply: true
---
@design.md
`;

export interface ToolStatus {
  /** The MCP config file names Steward's server. */
  server: boolean;
  /** The tool is told to read design.md (CLAUDE.md for Claude Code, a .cursor/rules file for Cursor). */
  designMd: boolean;
}

/** Pure: does an MCP config (as text) start Steward's server (`… context <repo> --serve`)? */
export function namesSteward(configText: string): boolean {
  try {
    const servers = (JSON.parse(configText) as { mcpServers?: Record<string, { command?: string; args?: unknown[] }> }).mcpServers ?? {};
    return Object.values(servers).some((s) => {
      const parts = [s.command ?? "", ...(Array.isArray(s.args) ? s.args.map(String) : [])];
      return parts.includes("context") && parts.includes("--serve") && parts.some((p) => /steward|bin\.js$/.test(p));
    });
  } catch {
    return false;
  }
}

const readText = async (p: string) => {
  try {
    return await readFile(p, "utf8");
  } catch {
    return null;
  }
};

/** Pure: quotes a path for a POSIX shell, only when it needs it. */
const q = (s: string) => (/^[\w./@:-]+$/.test(s) ? s : `'${s.replaceAll("'", "'\\''")}'`);

/** Pure: the shell command that starts Steward's MCP server for a repo, for any tool that supports MCP. */
export function serveCommand(bin: string, repo: string): string {
  return `node ${q(bin)} context ${q(repo)} --serve`;
}

/** Pure: the `claude mcp add` command that adds Steward's server for this repo, private to you (Claude Code's "local" scope). */
export function claudeMcpAdd(bin: string, repo: string): string {
  return `claude mcp add steward -- ${serveCommand(bin, repo)}`;
}

/**
 * Claude Code keeps servers added with `claude mcp add` (local scope) in
 * ~/.claude.json, under the project's path. Read only to show the status;
 * nothing from it is shown or sent anywhere.
 */
async function claudeLocalServers(home: string, repo: string): Promise<string> {
  try {
    const projects = (JSON.parse((await readText(join(home, ".claude.json"))) ?? "{}") as { projects?: Record<string, { mcpServers?: unknown }> }).projects ?? {};
    return JSON.stringify({ mcpServers: projects[repo]?.mcpServers ?? {} });
  } catch {
    return "";
  }
}

/** What's set up in the repo itself. A tool can also be set up outside the repo (user settings), which Steward can't see. */
export async function toolStatus(repo: string, home = homedir()): Promise<{ claudeCode: ToolStatus; cursor: ToolStatus }> {
  const claudeMd = (await readText(join(repo, "CLAUDE.md"))) ?? "";
  let cursorRules = false;
  try {
    for (const f of await readdir(join(repo, ".cursor/rules"))) if (((await readText(join(repo, ".cursor/rules", f))) ?? "").includes("@design.md")) cursorRules = true;
  } catch {
    // no rules folder
  }
  return {
    claudeCode: {
      server: namesSteward((await readText(join(repo, ".mcp.json"))) ?? "") || namesSteward(await claudeLocalServers(home, repo)),
      designMd: /(^|\s)@design\.md\b/m.test(claudeMd),
    },
    cursor: { server: namesSteward((await readText(join(repo, ".cursor/mcp.json"))) ?? ""), designMd: cursorRules },
  };
}

// ---------------------------------------------------------------------------
// The before/after comparison (eval/results)
// ---------------------------------------------------------------------------

/** The eval's prompts, as in eval/README.md. */
export const PROMPTS: Readonly<Record<string, string>> = {
  pricing: "On the Billing page, add a pricing card for a Pro plan at $29/month with a small plan icon, three features, and a 'Start free trial' button.",
  settings: "Add a Notifications section to the Settings page with a form: email address, how often to send emails (instant, daily, weekly), and a Save button.",
  dialog:
    "Add a confirmation dialog for deleting a project. Open it from a 'Delete project' button on the Dashboard. It should say this can't be undone, and have Cancel and Delete buttons plus a close icon in the corner.",
};

export const CONDITIONS = ["without", "with"] as const;
export type Condition = (typeof CONDITIONS)[number];
/** `pricing-1`: a prompt and a run number. Also guards the screenshot route against odd paths. */
export const LABEL = /^[a-z]+-\d+$/;

interface EvalRun {
  label: string;
  prompt: string;
  files: { path: string; findings: { check: string; message: string }[] }[];
  totals: { addedLines: number; problems: number; byCheck: Record<string, number> };
}

export interface Side {
  /** Runs of this prompt in this copy. */
  runs: number;
  /** The run shown: the highest-numbered one. */
  shown: string;
  problems: number;
  addedLines: number;
  byCheck: Record<string, number>;
  /** Average problems across runs, when there's more than one. */
  average: number | null;
  /** The shown run's first few findings, in plain English. */
  findings: string[];
  /** Whether a screenshot was saved as `<condition>/<label>.png`. */
  screenshot: boolean;
}

export interface PromptComparison {
  prompt: string;
  text: string;
  without: Side | null;
  with: Side | null;
}

/** The eval's results folder: `STEWARD_DEMO_DIR`, else eval/results in the Steward repo. Null if there isn't one. */
export async function demoDir(env: Env, cwd: string): Promise<string | null> {
  const candidates = [env["STEWARD_DEMO_DIR"], resolve(cwd, "../../eval/results"), env["INIT_CWD"] && resolve(env["INIT_CWD"], "eval/results")];
  for (const c of candidates) if (c && (await exists(c))) return c;
  return null;
}

const runNumber = (label: string) => Number(label.split("-").at(-1));

/** Pure: whether parsed JSON has the parts of a scored run the page reads. */
function isEvalRun(v: unknown): v is EvalRun {
  if (!v || typeof v !== "object") return false;
  const r = v as Partial<EvalRun>;
  const t = r.totals as Partial<EvalRun["totals"]> | undefined;
  return (
    typeof r.label === "string" &&
    typeof r.prompt === "string" &&
    Array.isArray(r.files) &&
    r.files.every((f) => f && typeof f === "object" && Array.isArray((f as { findings?: unknown }).findings)) &&
    !!t &&
    typeof t.problems === "number" &&
    typeof t.addedLines === "number" &&
    !!t.byCheck &&
    typeof t.byCheck === "object"
  );
}

/** Pure: the note for result files that couldn't be read (left out of the comparison), or null when there are none. */
export function unreadableNote(files: readonly string[]): string | null {
  if (files.length === 0) return null;
  const one = files.length === 1;
  return `${files.length} result ${one ? "file" : "files"} in eval/results couldn't be read, so ${one ? "it's" : "they're"} left out: ${files.join(", ")}.`;
}

/** Reads the comparison, as {@link loadComparison} does, and also lists the result files it had to leave out (`<condition>/<file>`). */
export async function readComparison(dir: string): Promise<{ comparisons: PromptComparison[]; unreadable: string[] }> {
  const runs: Record<Condition, EvalRun[]> = { without: [], with: [] };
  const unreadable: string[] = [];
  for (const condition of CONDITIONS) {
    let names: string[];
    try {
      // The folder is only known at run time; tell the bundler not to trace the whole project for it.
      names = await readdir(join(/* turbopackIgnore: true */ dir, condition));
    } catch {
      continue;
    }
    for (const name of names.filter((n) => n.endsWith(".json") && LABEL.test(n.slice(0, -5))).sort()) {
      // A file that isn't a scored run (half-written, edited by hand) is left out and named on the page, rather than breaking it.
      let run: unknown;
      try {
        run = JSON.parse(await readFile(join(/* turbopackIgnore: true */ dir, condition, name), "utf8"));
      } catch {
        run = null;
      }
      if (isEvalRun(run)) runs[condition].push(run);
      else unreadable.push(`${condition}/${name}`);
    }
  }

  async function side(condition: Condition, prompt: string): Promise<Side | null> {
    const list = runs[condition].filter((r) => r.prompt === prompt).sort((a, b) => runNumber(a.label) - runNumber(b.label));
    const shown = list.at(-1);
    if (!shown) return null;
    return {
      runs: list.length,
      shown: shown.label,
      problems: shown.totals.problems,
      addedLines: shown.totals.addedLines,
      byCheck: Object.fromEntries(Object.entries(shown.totals.byCheck).filter(([, n]) => n > 0)),
      average: list.length > 1 ? Math.round((list.reduce((s, r) => s + r.totals.problems, 0) / list.length) * 10) / 10 : null,
      findings: shown.files.flatMap((f) => f.findings.map((x) => x.message)).slice(0, 3),
      screenshot: await exists(join(dir, condition, `${shown.label}.png`)),
    };
  }

  const prompts = [...new Set([...runs.without, ...runs.with].map((r) => r.prompt))].sort((a, b) => Object.keys(PROMPTS).indexOf(a) - Object.keys(PROMPTS).indexOf(b));
  const out: PromptComparison[] = [];
  for (const prompt of prompts) out.push({ prompt, text: PROMPTS[prompt] ?? prompt, without: await side("without", prompt), with: await side("with", prompt) });
  return { comparisons: out, unreadable };
}

/**
 * Reads every scored run (`<condition>/<label>.json`, as `pnpm eval:score`
 * writes them) and pairs them up by prompt. Prompts with no runs are left
 * out; a side with no runs is null; a file that can't be read is skipped.
 * Nothing is made up.
 */
export async function loadComparison(dir: string): Promise<PromptComparison[]> {
  return (await readComparison(dir)).comparisons;
}
