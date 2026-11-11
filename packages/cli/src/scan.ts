import { stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { readSystemModel, STEWARD_DIR, SYSTEM_MODEL_FILE, SystemModelError, writeSystemModel, type SystemModel } from "@steward/model";
import { buildSystemModel, scanRepo, summarizeScan, type ScanResult, type ScanSummary } from "@steward/scanner";

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

async function assertDirectory(path: string, shown: string): Promise<void> {
  try {
    if ((await stat(path)).isDirectory()) return;
  } catch {
    throw new StewardError(`I couldn't find a folder at ${shown}. Check the path and try again.`);
  }
  throw new StewardError(`${shown} is a file, not a folder. Point Steward at the root of your repo.`);
}

/** Scans a repo and writes `.steward/system.json`, keeping earlier decisions and rules. */
export async function runScan(target: string): Promise<ScanRun> {
  const root = resolve(target);
  await assertDirectory(root, target);

  let previous: SystemModel | null;
  try {
    previous = await readSystemModel(root);
  } catch (err) {
    if (!(err instanceof SystemModelError)) throw err;
    throw new StewardError(
      `I couldn't read the existing ${STEWARD_DIR}/${SYSTEM_MODEL_FILE}, so I left it as is. ${err.message}\nFix the file or move it aside, then scan again.`,
    );
  }

  const details = await scanRepo(root, { decisions: previous?.decisions ?? [] });
  const model = buildSystemModel(details, previous);
  const writtenTo = await writeSystemModel(root, model);
  return {
    writtenTo,
    output: {
      systemModelPath: relative(root, writtenTo).split(sep).join("/"),
      summary: summarizeScan(details),
      model,
      details,
    },
  };
}
