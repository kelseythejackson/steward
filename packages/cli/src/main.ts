import { isAbsolute, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { formatScanReport } from "./report.js";
import type { Readable, Writable } from "node:stream";
import { formatContextReport, runContext, runServe } from "./context.js";
import { formatReviewReport, runReview } from "./review.js";
import { runScan, StewardError } from "./scan.js";

export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  cwd: string;
  /** Raw streams for `context --serve`, which speaks MCP over stdio. Default to the process's own. */
  stdin?: Readable;
  stdoutStream?: Writable;
}

const COMMANDS = [
  ["scan [path]", "Steward Setup: scan a React + Tailwind repo and build the system model"],
  ["review [path]", "Review the scan's suggestions (the review screen is coming soon)"],
  ["context [path]", "Steward Brief: give AI coding tools your system (design.md or an MCP server)"],
  ["check", "Run Review locally on the working tree (coming soon)"],
] as const;

function help(): string {
  const lines = ["Usage: steward <command> [options]", "", "Commands:"];
  for (const [name, text] of COMMANDS) lines.push(`  ${name.padEnd(13)} ${text}`);
  lines.push(
    "",
    "Options for scan:",
    "  --json        Print the full result as JSON instead of the report",
    "",
    "Options for review:",
    "  --accept-all  Accept every suggestion that has no decision yet",
    "",
    "Options for context:",
    "  --file        Write design.md to the repo root instead of printing it",
    "  --serve       Start the MCP server over stdio for AI coding tools",
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

  const { output, writtenTo } = await runScan(positionals[0] ?? ".");
  if (values.json) io.stdout(`${JSON.stringify(output, null, 2)}\n`);
  else io.stdout(formatScanReport(output.summary, displayPath(io.cwd, writtenTo)));
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
  io.stdout(formatReviewReport(run, shown, values["accept-all"]));
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

/** Runs the CLI and returns the exit code. Kept apart from `bin.ts` so it can be tested in-process. */
export async function main(argv: string[], io: Io): Promise<number> {
  const [command, ...rest] = argv;
  try {
    if (command === undefined || command === "help" || command === "--help" || command === "-h") {
      io.stdout(help());
      return 0;
    }
    if (command === "scan") return await scan(rest, io);
    if (command === "review") return await review(rest, io);
    if (command === "context") return await context(rest, io);
    if (COMMANDS.some(([name]) => name.split(" ")[0] === command)) {
      io.stderr(`steward ${command} isn't built yet. For now, try \`steward scan <path>\`.\n`);
      return 1;
    }
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
