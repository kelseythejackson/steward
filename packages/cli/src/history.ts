/**
 * Writes a `steward check` run to `.steward/history.jsonl` (append-only),
 * and in GitHub Actions also to a file the action uploads as an artifact,
 * since the runner's copy is thrown away. Writing history never fails a
 * check: if it can't be written, the check says so and carries on.
 */
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { appendHistory, serializeHistoryRecord, type HistoryRecord } from "@steward/model";

/** Where the action picks up this run's record: `$RUNNER_TEMP/steward-history/record.jsonl`. */
export const ARTIFACT_DIR = "steward-history";

/** Shown after a local check when git would commit the history: each person's local checks would conflict in it. */
export const GITIGNORE_TIP =
  "Tip: add .steward/history.jsonl to your .gitignore. It records checks run on this computer, so committing it would mix everyone's local runs and cause merge conflicts. The Report counts pull request checks, which come from GitHub (`steward history import`).\n";

const run = promisify(execFile);

/** Whether git ignores `.steward/history.jsonl` in this repo. Null when git can't say (not a repo, no git). */
export async function historyIgnored(root: string): Promise<boolean | null> {
  try {
    await run("git", ["check-ignore", "-q", ".steward/history.jsonl"], { cwd: root });
    return true;
  } catch (err) {
    // check-ignore exits 1 for "not ignored"; anything else means git couldn't answer.
    return (err as { code?: unknown }).code === 1 ? false : null;
  }
}

export async function writeHistory(root: string, record: HistoryRecord, options: { log: (text: string) => void; runnerTemp?: string | undefined }): Promise<void> {
  let written = true;
  try {
    await appendHistory(root, record);
  } catch (err) {
    written = false;
    options.log(`Couldn't add this check to .steward/history.jsonl (${err instanceof Error ? err.message : String(err)}), so it isn't in the history.\n`);
  }
  if (!options.runnerTemp) {
    // Never edits .gitignore itself (no silent changes); just says what to add, once git would commit the file.
    if (written && (await historyIgnored(root)) === false) options.log(GITIGNORE_TIP);
    return;
  }
  try {
    const dir = join(options.runnerTemp, ARTIFACT_DIR);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "record.jsonl"), `${serializeHistoryRecord(record)}\n`, "utf8");
  } catch (err) {
    options.log(`Couldn't save this check's history record for upload (${err instanceof Error ? err.message : String(err)}).\n`);
  }
}
