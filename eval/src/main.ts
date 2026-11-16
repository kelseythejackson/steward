/**
 * Before/after test CLI. File and git I/O live here; scoring is pure (score.ts).
 *
 *   pnpm eval:score ~/steward-eval/with --label pricing-1 [--force] [--model <repo>]
 *   pnpm eval:summary [--json]
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkContext } from "@steward/guard";
import { compareStrings, readSystemModel } from "@steward/model";
import { allLines, parseAddedLines } from "./diff.js";
import { EVAL_CHECKS, isScored, promptOf, scoreFile, totalsOf, type FileScore, type RunResult } from "./score.js";
import { summarize } from "./summary.js";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const RESULTS = join(REPO, "eval", "results");
const DEFAULT_MODEL = join(REPO, "fixtures", "messy-app");
export const BASELINE_TAG = "baseline";

const git = (cwd: string, args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}

async function scoreCommand(args: string[]): Promise<number> {
  const copy = args[0] && !args[0].startsWith("--") ? resolve(args[0]) : undefined;
  const label = flag(args, "--label");
  if (!copy || !label) {
    console.error("Usage: pnpm eval:score <copy folder> --label <prompt>-<run>   e.g. ~/steward-eval/with --label pricing-1");
    return 1;
  }
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(label)) {
    console.error(`"${label}" isn't a usable label. Use lowercase words and a run number, like pricing-1.`);
    return 1;
  }
  try {
    git(copy, ["rev-parse", "--verify", "--quiet", `${BASELINE_TAG}^{commit}`]);
  } catch {
    console.error(`${copy} has no "${BASELINE_TAG}" tag. Create the copies with eval/setup.sh first.`);
    return 1;
  }

  const modelRoot = resolve(flag(args, "--model") ?? DEFAULT_MODEL);
  const model = await readSystemModel(modelRoot);
  if (!model) {
    console.error(`No system model at ${modelRoot}/.steward/system.json. Run \`pnpm steward scan\` on it first.`);
    return 1;
  }

  const condition = basename(copy);
  const out = join(RESULTS, condition, `${label}.json`);
  if (existsSync(out) && !args.includes("--force")) {
    console.error(`${relative(REPO, out)} already exists. Use another label, or add --force to replace it.`);
    return 1;
  }

  const added = parseAddedLines(git(copy, ["diff", "-U0", "--no-color", "--no-renames", BASELINE_TAG, "--"]));
  const untracked = git(copy, ["ls-files", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean);
  const paths = [...new Set([...added.keys(), ...untracked])].filter(isScored).sort(compareStrings);

  const ctx = checkContext(model);
  const files: FileScore[] = [];
  for (const path of paths) {
    const code = await readFile(join(copy, path), "utf8");
    files.push(scoreFile(path, code, added.get(path) ?? allLines(code), ctx));
  }

  const result: RunResult = { condition, label, prompt: promptOf(label), files, totals: totalsOf(files) };
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(result, null, 2)}\n`);

  const t = result.totals;
  const parts = EVAL_CHECKS.filter((k) => t.byCheck[k.id] > 0).map((k) => `${k.label}: ${t.byCheck[k.id]}`);
  console.log(
    `${label} (${condition}): ${t.addedLines} line${t.addedLines === 1 ? "" : "s"} added in ${files.length} file${files.length === 1 ? "" : "s"}, ` +
      `${t.problems === 0 ? "no problems" : `${t.problems} problem${t.problems === 1 ? "" : "s"} (${parts.join(", ")})`}.`,
  );
  if (t.parseErrors > 0) console.log(`${t.parseErrors} file${t.parseErrors === 1 ? "" : "s"} couldn't be read as JSX, so they weren't checked.`);
  if (files.length === 0) console.log("No source files changed since the baseline. Did the run finish?");
  console.log(`Saved ${relative(REPO, out)}`);
  return 0;
}

async function loadResults(): Promise<RunResult[]> {
  if (!existsSync(RESULTS)) return [];
  const results: RunResult[] = [];
  for (const condition of (await readdir(RESULTS, { withFileTypes: true })).filter((d) => d.isDirectory())) {
    for (const file of (await readdir(join(RESULTS, condition.name))).filter((f) => f.endsWith(".json"))) {
      results.push(JSON.parse(await readFile(join(RESULTS, condition.name, file), "utf8")) as RunResult);
    }
  }
  return results.sort((a, b) => compareStrings(a.condition, b.condition) || compareStrings(a.label, b.label));
}

async function summaryCommand(args: string[]): Promise<number> {
  const results = await loadResults();
  process.stdout.write(args.includes("--json") ? `${JSON.stringify(results, null, 2)}\n` : summarize(results));
  return 0;
}

const [command, ...rest] = process.argv.slice(2);
const run = command === "score" ? scoreCommand : command === "summary" ? summaryCommand : undefined;
if (!run) {
  console.error("Usage: pnpm eval:score <copy> --label <prompt>-<run>   |   pnpm eval:summary [--json]");
  process.exitCode = 1;
} else {
  process.exitCode = await run(rest);
}
