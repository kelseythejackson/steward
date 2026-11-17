import { readFile, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { checkFile, isReviewable, SnippetParseError } from "@steward/guard";
import { compareStrings, readSystemModel, STEWARD_DIR, SYSTEM_MODEL_FILE, SystemModelError, writeSystemModel, type Exception, type SystemModel } from "@steward/model";
import { buildSystemModel, colorNamesInModel, colorsInModel, scanRepo, summarizeScan, type ScanResult, type ScanSummary } from "@steward/scanner";

/** A problem the person can fix, with a calm message saying how. */
export class StewardError extends Error {
  override name = "StewardError";
}

/** What `steward scan --json` prints. Paths are repo-relative so output doesn't depend on the machine. */
export interface ScanOutput {
  /** Where the model was written, relative to the scanned repo. */
  systemModelPath: string;
  summary: ScanSummary;
  model: SystemModel;
  /** Everything the extractors and suggesters found, including locations and skipped places. */
  details: ScanResult;
}

export interface ScanRun {
  output: ScanOutput;
  /** Absolute path of the written `system.json`. */
  writtenTo: string;
}

export async function assertDirectory(path: string, shown: string): Promise<void> {
  try {
    if ((await stat(path)).isDirectory()) return;
  } catch {
    throw new StewardError(`I couldn't find a folder at ${shown}. Check the path and try again.`);
  }
  throw new StewardError(`${shown} is a file, not a folder. Point Steward at the root of your repo.`);
}

export interface ScanOptions {
  /** Today, for new exceptions' `firstSeen`. Defaults to now; tests pass a fixed one. */
  now?: string;
  /** The folder as the person typed it, for messages. Defaults to `target`. */
  shownAs?: string;
}

const exceptionKey = (e: Pick<Exception, "rule" | "file" | "found" | "reason">) => [e.rule, e.file, e.found, e.reason].join("\0");

/**
 * The `steward-ignore` comments in the repo, as exceptions for system.json.
 * The comments are the source of truth: one whose comment is gone drops
 * out, and one still there keeps the day it was first recorded.
 */
export async function collectExceptions(root: string, paths: readonly string[], model: SystemModel, previous: readonly Exception[], today: string): Promise<Exception[]> {
  const firstSeen = new Map(previous.map((e) => [exceptionKey(e), e.firstSeen]));
  const out = new Map<string, Exception>();
  for (const path of paths.filter(isReviewable)) {
    const code = await readFile(join(root, path), "utf8");
    if (!code.includes("steward-ignore")) continue;
    let ignored;
    try {
      ignored = checkFile({ path, code }, model).ignored;
    } catch (err) {
      if (err instanceof SnippetParseError) continue;
      throw err;
    }
    for (const { finding, reason } of ignored) {
      const e = { rule: finding.rule, file: path, found: finding.found, reason };
      const key = exceptionKey(e);
      out.set(key, { ...e, firstSeen: firstSeen.get(key) ?? today });
    }
  }
  return [...out.values()].sort((a, b) => compareStrings(exceptionKey(a), exceptionKey(b)));
}

/** Scans a repo and writes `.steward/system.json`, keeping earlier decisions and rules. */
export async function runScan(target: string, options: ScanOptions = {}): Promise<ScanRun> {
  const root = resolve(target);
  await assertDirectory(root, options.shownAs ?? target);

  let previous: SystemModel | null;
  try {
    previous = await readSystemModel(root);
  } catch (err) {
    if (!(err instanceof SystemModelError)) throw err;
    throw new StewardError(
      `I couldn't read the existing ${STEWARD_DIR}/${SYSTEM_MODEL_FILE}, so I left it as is. ${err.message}\nFix the file or move it aside, then scan again.`,
    );
  }

  // On a re-scan, only colors already in the system become tokens on their own; new ones wait for a person.
  const known = previous ? colorsInModel(previous.tokens) : [];
  // Tokens keep their names across scans, so code using them never points at a different color.
  const names = previous ? colorNamesInModel(previous.tokens) : new Map<string, string>();
  const details = await scanRepo(root, {
    decisions: previous?.decisions ?? [],
    rules: previous?.rules ?? [],
    ...(known.length > 0 ? { knownColors: known } : {}),
    ...(names.size > 0 ? { colorNames: names } : {}),
  });
  const built = buildSystemModel(details, previous);
  const today = (options.now ?? new Date().toISOString()).slice(0, 10);
  const model = { ...built, exceptions: await collectExceptions(root, details.files, built, previous?.exceptions ?? [], today) };
  const writtenTo = await writeSystemModel(root, model);
  return {
    writtenTo,
    output: {
      systemModelPath: relative(root, writtenTo).split(sep).join("/"),
      summary: { ...summarizeScan(details), ...(model.exceptions.length > 0 ? { exceptions: model.exceptions.length } : {}) },
      model,
      details,
    },
  };
}
