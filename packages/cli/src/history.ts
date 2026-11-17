/**
 * Writes a `steward check` run to `.steward/history.jsonl` (append-only),
 * and in GitHub Actions also to a file the action uploads as an artifact,
 * since the runner's copy is thrown away. Writing history never fails a
 * check: if it can't be written, the check says so and carries on.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { appendHistory, serializeHistoryRecord, type HistoryRecord } from "@steward/model";

/** Where the action picks up this run's record: `$RUNNER_TEMP/steward-history/record.jsonl`. */
export const ARTIFACT_DIR = "steward-history";

export async function writeHistory(root: string, record: HistoryRecord, options: { log: (text: string) => void; runnerTemp?: string | undefined }): Promise<void> {
  try {
    await appendHistory(root, record);
  } catch (err) {
    options.log(`Couldn't add this check to .steward/history.jsonl (${err instanceof Error ? err.message : String(err)}), so it isn't in the history.\n`);
  }
  if (!options.runnerTemp) return;
  try {
    const dir = join(options.runnerTemp, ARTIFACT_DIR);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "record.jsonl"), `${serializeHistoryRecord(record)}\n`, "utf8");
  } catch (err) {
    options.log(`Couldn't save this check's history record for upload (${err instanceof Error ? err.message : String(err)}).\n`);
  }
}
