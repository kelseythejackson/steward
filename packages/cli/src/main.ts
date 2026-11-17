import { isAbsolute, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { Readable, Writable } from "node:stream";
import { componentUse, formatReview, historyRecord } from "@steward/guard";
import { checkJson, runCheck } from "./check.js";
import { runGithubCheck } from "./github.js";
import { formatImport, githubToken, importHistory, originRepo } from "./history-import.js";
import { writeHistory } from "./history.js";
import { formatScanReport } from "./report.js";
import { formatContextReport, runContext, runServe } from "./context.js";
import { formatReviewReport, readModel, runReview } from "./review.js";
import { runScan, StewardError } from "./scan.js";

export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  cwd: string;
  /** Raw streams for `context --serve`, which speaks MCP over stdio. Default to the process's own. */
  stdin?: Readable;
  stdoutStream?: Writable;
  /** Environment for `check --github`. Defaults to the process's own. */
  env?: Readonly<Record<string, string | undefined>>;
  /** For `check --github`'s API calls; tests pass a fake. Defaults to the global fetch. */
  fetch?: typeof globalThis.fetch;
  /** The time, for history records. Defaults to now; tests pass a fixed one. */
  now?: () => Date;
}

const COMMANDS = [
  ["scan [path]", "Steward Setup: scan a React + Tailwind repo and build the system model"],
  ["decide [path]", "List the scan's suggestions waiting for a decision, or accept them all (the Setup screen does this too)"],
  ["context [path]", "Steward Brief: give AI coding tools your system (design.md or an MCP server)"],
  ["history import [path]", "Bring the pull request checks' history in from GitHub, for the Report"],
  ["check [path]", "Steward Review: check the lines changed since the base branch (or every file with --all)"],
] as const;

function help(): string {
  const lines = ["Usage: steward <command> [options]", "", "Commands:"];
  for (const [name, text] of COMMANDS) lines.push(`  ${name.padEnd(22)} ${text}`);
  lines.push(
    "",
    "Options for scan:",
    "  --json        Print the full result as JSON instead of the report",
    "",
    "Options for decide (also works as `steward review`):",
    "  --accept-all  Accept every suggestion that has no decision yet",
    "",
    "Options for context:",
    "  --file        Write design.md to the repo root instead of printing it",
    "  --serve       Start the MCP server over stdio for AI coding tools",
    "",
    "Options for history import:",
    "  --repo <owner/name>  GitHub repo to read (default: the folder's origin remote). Uses GITHUB_TOKEN, GH_TOKEN or `gh auth login`",
    "",
    "Options for check:",
    "  --base <ref>  Branch to compare with (default: \"base\" in .steward/config.json, then the repo's default branch)",
    "  --all         Check every TSX and JSX file, not just changed lines",
    "  --json        Print the full result as JSON",
    "  --github      In GitHub Actions: comment on the pull request's lines and keep one summary comment",
    "  Stories and tests are left out. In .steward/config.json, \"mode\": \"error\" fails the build when",
    "  anything is found (the default, \"warn\", never does), and \"rules\": { \"<rule>\": \"off\" } turns a rule off.",
  );
  return `${lines.join("\n")}\n`;
}

/** Relative to where the person ran the command, unless that means climbing out of it. */
function displayPath(cwd: string, path: string): string {
  const rel = relative(cwd, path);
  return rel === "" || rel.startsWith("..") || isAbsolute(rel) ? path : rel;
}

async function scan(args: string[], io: Io): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { json: { type: "boolean", default: false }, help: { type: "boolean", short: "h", default: false } },
  });
  if (values.help) {
    io.stdout(help());
    return 0;
  }
  if (positionals.length > 1) throw new StewardError(`scan takes one folder, but got ${positionals.length}: ${positionals.join(" ")}`);

  // From the CLI's own working folder, like check and review, not wherever Node happened to start.
  const target = positionals[0] ?? ".";
  const { output, writtenTo } = await runScan(resolve(io.cwd, target), { shownAs: target });
  if (values.json) io.stdout(`${JSON.stringify(output, null, 2)}\n`);
  else io.stdout(formatScanReport(output.summary, displayPath(io.cwd, writtenTo), target));
  return 0;
}

async function review(args: string[], io: Io): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { "accept-all": { type: "boolean", default: false }, help: { type: "boolean", short: "h", default: false } },
  });
  if (values.help) {
    io.stdout(help());
    return 0;
  }
  if (positionals.length > 1) throw new StewardError(`review takes one folder, but got ${positionals.length}: ${positionals.join(" ")}`);

  const target = positionals[0] ?? ".";
  const run = await runReview(resolve(io.cwd, target), { acceptAll: values["accept-all"], shownAs: target });
  const shown = run.writtenTo ? displayPath(io.cwd, run.writtenTo) : "";
  io.stdout(formatReviewReport(run, shown, values["accept-all"], resolve(io.cwd, target)));
  return 0;
}

async function context(args: string[], io: Io): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      file: { type: "boolean", default: false },
      serve: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help) {
    io.stdout(help());
    return 0;
  }
  if (positionals.length > 1) throw new StewardError(`context takes one folder, but got ${positionals.length}: ${positionals.join(" ")}`);

  const target = positionals[0] ?? ".";
  if (values.serve) {
    if (values.file) throw new StewardError("Use --file or --serve, not both: --file writes design.md, --serve starts the MCP server.");
    await runServe(resolve(io.cwd, target), { shownAs: target, log: io.stderr, stdin: io.stdin, stdout: io.stdoutStream });
    return 0;
  }
  const run = await runContext(resolve(io.cwd, target), { file: values.file, shownAs: target });
  io.stdout(run.writtenTo ? formatContextReport(run, displayPath(io.cwd, run.writtenTo)) : run.markdown);
  return 0;
}

async function check(args: string[], io: Io): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      base: { type: "string" },
      all: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      github: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help) {
    io.stdout(help());
    return 0;
  }
  if (positionals.length > 1) throw new StewardError(`check takes one folder, but got ${positionals.length}: ${positionals.join(" ")}`);
  if (values.github && (values.all || values.json)) throw new StewardError("--github checks the pull request's changes and comments on them, so it doesn't go with --all or --json.");
  if (values.github) {
    const githubIo = { stdout: io.stdout, cwd: io.cwd, env: io.env ?? process.env, ...(io.fetch ? { fetch: io.fetch } : {}), ...(io.now ? { now: io.now } : {}) };
    return runGithubCheck(positionals[0] ?? ".", githubIo, values.base === undefined ? {} : { base: values.base });
  }
  if (values.all && values.base !== undefined) throw new StewardError("Use --all or --base, not both: --all checks every file, --base picks what to compare changes with.");

  const target = positionals[0] ?? ".";
  const options = { all: values.all, shownAs: target, ...(values.base === undefined ? {} : { base: values.base }) };
  const root = resolve(io.cwd, target);
  const run = await runCheck(root, options);
  const { result } = run;
  io.stdout(values.json ? `${JSON.stringify(checkJson(result), null, 2)}\n` : formatReview(result));
  // Outside a pull request there's no PR number, no labels to read the source from, and no suggestions to accept.
  const record = historyRecord(result, {
    date: (io.now?.() ?? new Date()).toISOString(),
    pr: null,
    source: "unknown",
    fixesAccepted: null,
    components: componentUse(run.files, run.model),
  });
  await writeHistory(root, record, { log: io.stderr });
  return result.failed ? 1 : 0;
}

async function history(args: string[], io: Io): Promise<number> {
  const [sub, ...rest] = args;
  if (sub !== "import") throw new StewardError("history has one command: `steward history import [path]`, which brings the pull request checks' history in from GitHub.");
  const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { repo: { type: "string" }, help: { type: "boolean", short: "h", default: false } } });
  if (values.help) {
    io.stdout(help());
    return 0;
  }
  if (positionals.length > 1) throw new StewardError(`history import takes one folder, but got ${positionals.length}: ${positionals.join(" ")}`);
  const target = positionals[0] ?? ".";
  const root = resolve(io.cwd, target);
  await readModel(root, target);
  const repo = values.repo ?? (await originRepo(root));
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    throw new StewardError(`I couldn't tell which GitHub repo ${target} is${values.repo ? ` ("${values.repo}" isn't owner/name)` : ": its origin remote isn't on GitHub"}. Name it with --repo owner/name.`);
  }
  const env = io.env ?? process.env;
  const token = await githubToken(env);
  if (!token) throw new StewardError("Steward needs your GitHub login to download the history. Run `gh auth login`, or set GITHUB_TOKEN.");
  const result = await importHistory(root, { repo, token, ...(env["GITHUB_API_URL"] ? { apiUrl: env["GITHUB_API_URL"] } : {}), ...(io.fetch ? { fetch: io.fetch } : {}) });
  io.stdout(formatImport(result, target));
  return 0;
}

/** Runs the CLI and returns the exit code. Kept apart from `bin.ts` so it can be tested in-process. */
export async function main(argv: string[], io: Io): Promise<number> {
  const [command, ...rest] = argv;
  try {
    if (command === undefined || command === "help" || command === "--help" || command === "-h") {
      io.stdout(help());
      return 0;
    }
    if (command === "scan") return await scan(rest, io);
    // "decide": Review is the pull request checks. "review" still works for anyone who learned it first.
    if (command === "decide" || command === "review") return await review(rest, io);
    if (command === "context") return await context(rest, io);
    if (command === "check") return await check(rest, io);
    if (command === "history") return await history(rest, io);
    io.stderr(`I don't know the command "${command}".\n\n${help()}`);
    return 1;
  } catch (err) {
    if (err instanceof StewardError) {
      io.stderr(`${err.message}\n`);
      return 1;
    }
    if (err instanceof TypeError && "code" in err && String(err.code).startsWith("ERR_PARSE_ARGS")) {
      io.stderr(`${err.message}\n\n${help()}`);
      return 1;
    }
    throw err;
  }
}
