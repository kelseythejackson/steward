/**
 * `steward check`: runs Steward Review on a repo. By default only on lines
 * changed since a base branch, so old code isn't flagged on every pull
 * request; `--all` checks every file. Reads git and files; never writes.
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { allLines, parseAddedLines, reviewFiles, RULES, unknownRules, type ReviewResult, type ReviewScope, type SourceFile } from "@steward/guard";
import { readStewardConfig, STEWARD_DIR, CONFIG_FILE, StewardConfigError, type StewardConfig } from "@steward/model";
import { readModel } from "./review.js";
import { assertDirectory, StewardError } from "./scan.js";

export interface CheckOptions {
  /** Check every file, not just the changed lines. */
  all?: boolean;
  /** Branch to compare with. Wins over `base` in config.json. */
  base?: string;
  /** The folder as the person typed it, for messages. */
  shownAs?: string;
}

/** What `steward check --json` prints. */
export interface CheckJson extends ReviewResult {
  summary: { files: number; changedLines?: number; findings: number; exactFixes: number; byRule: Record<string, number> };
}

const run = promisify(execFile);

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", ["-c", "core.quotePath=false", ...args], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

async function gitOk(root: string, args: string[]): Promise<string | null> {
  try {
    return (await git(root, args)).trim();
  } catch {
    return null;
  }
}

/** Files Review reads: TSX and JSX, but not stories and tests (kept out of the system, as in Setup) or build output. */
export const isReviewable = (path: string) =>
  /\.(?:tsx|jsx)$/.test(path) &&
  !/\.(?:stories|story|test|spec)\.[jt]sx$/.test(path) &&
  !/(?:^|\/)(?:__tests__|__stories__|\.storybook|node_modules|dist|build|\.next|\.steward)\//.test(path);

const zList = (out: string) => out.split("\0").filter((p) => p !== "");

async function readConfig(root: string): Promise<StewardConfig> {
  let config: StewardConfig;
  try {
    config = await readStewardConfig(root);
  } catch (err) {
    if (!(err instanceof StewardConfigError)) throw err;
    throw new StewardError(err.message);
  }
  const unknown = unknownRules(config);
  if (unknown.length > 0) {
    const names = unknown.map((id) => `"${id}"`).join(", ");
    throw new StewardError(
      `${STEWARD_DIR}/${CONFIG_FILE} mentions ${names}, which ${unknown.length === 1 ? "isn't a Review rule" : "aren't Review rules"}. ` +
        `The rules are: ${RULES.map((r) => r.id).join(", ")}.`,
    );
  }
  return config;
}

/** The repo's default branch if git knows it (`origin/HEAD`), else the first of main, master that exists. */
async function defaultBase(root: string): Promise<string> {
  const remoteHead = await gitOk(root, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  for (const ref of [remoteHead, "main", "origin/main", "master", "origin/master"]) {
    if (ref && (await gitOk(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])) !== null) return ref;
  }
  throw new StewardError(
    `I couldn't tell which branch to compare with: there's no main or master here. ` +
      `Name one with --base <branch> or "base" in ${STEWARD_DIR}/${CONFIG_FILE}, or use --all to check every file.`,
  );
}

async function readSources(root: string, paths: Iterable<string>, lines?: Map<string, Set<number>>): Promise<SourceFile[]> {
  const files: SourceFile[] = [];
  for (const path of [...new Set(paths)].filter(isReviewable).sort()) {
    let code: string;
    try {
      code = await readFile(join(root, path), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue; // deleted in the working tree
      throw err;
    }
    const changed = lines?.get(path);
    files.push(changed ? { path, code, lines: changed } : { path, code });
  }
  return files;
}

/** Every changed line since `base` split off: commits on this branch, uncommitted edits and new files. */
async function changedSources(root: string, base: string): Promise<SourceFile[]> {
  if ((await gitOk(root, ["rev-parse", "--verify", "--quiet", `${base}^{commit}`])) === null) {
    throw new StewardError(`I couldn't find "${base}" in this repo to compare with. Check the name, or fetch it first (for example \`git fetch origin ${base}\`).`);
  }
  if ((await gitOk(root, ["rev-parse", "--verify", "--quiet", "HEAD"])) === null) {
    throw new StewardError("This repo has no commits yet, so there's nothing to compare with. Use --all to check every file.");
  }
  const mergeBase = await gitOk(root, ["merge-base", base, "HEAD"]);
  if (!mergeBase) throw new StewardError(`This branch and ${base} share no history, so I can't tell what changed. Use --all to check every file.`);

  const added = parseAddedLines(await git(root, ["diff", "-U0", "--no-color", "--no-renames", "--no-ext-diff", "--relative", mergeBase, "--"]));
  const untracked = zList(await git(root, ["ls-files", "-z", "--others", "--exclude-standard"]));
  const files = await readSources(root, [...added.keys(), ...untracked], added);
  // A new file that git doesn't track yet: every line is new.
  return files.map((f) => (f.lines ? f : { ...f, lines: allLines(f.code) }));
}

async function allSources(root: string): Promise<SourceFile[]> {
  return readSources(root, zList(await git(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"])));
}

/** Runs Review on a repo and returns the result. Throws `StewardError` with a calm message when it can't. */
export async function runCheck(target: string, options: CheckOptions = {}): Promise<ReviewResult> {
  const root = resolve(target);
  const shown = options.shownAs ?? target;
  await assertDirectory(root, shown);
  const model = await readModel(root, shown);
  const config = await readConfig(root);
  if ((await gitOk(root, ["rev-parse", "--is-inside-work-tree"])) !== "true") {
    throw new StewardError(`steward check uses git to find the files to check, and ${shown} isn't in a git repo. Run \`git init\` there first.`);
  }

  let scope: ReviewScope;
  let files: SourceFile[];
  if (options.all) {
    scope = { kind: "all" };
    files = await allSources(root);
  } else {
    const base = options.base ?? config.base ?? (await defaultBase(root));
    scope = { kind: "changes", base };
    files = await changedSources(root, base);
  }
  return reviewFiles(files, model, config, scope);
}

/** Pure: the `--json` output, with totals for scripts and CI. */
export function checkJson(result: ReviewResult): CheckJson {
  const byRule: Record<string, number> = {};
  for (const { id } of RULES) {
    const n = result.findings.filter((f) => f.rule === id).length;
    if (n > 0) byRule[id] = n;
  }
  const summary: CheckJson["summary"] = {
    files: result.files.length,
    findings: result.findings.length,
    exactFixes: result.findings.filter((f) => (f.fix.edits?.length ?? 0) > 0).length,
    byRule,
  };
  if (result.changedLines !== undefined) summary.changedLines = result.changedLines;
  return { ...result, summary };
}
