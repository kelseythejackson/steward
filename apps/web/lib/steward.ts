/**
 * Reads the repo the app is pointed at (`STEWARD_REPO`): its system model
 * and check history. Server-side only. Saving decisions is `decide.ts`; it
 * only ever writes `.steward/system.json`. Every way reading can go wrong is
 * a state the pages can explain.
 */
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { parseSystemModel, readHistoryLines, SystemModelError, systemModelPath, type HistoryRecord, type SystemModel } from "@steward/model";
import { versionOf } from "./version.ts";

export const REPO_ENV = "STEWARD_REPO";

export type RepoState =
  | { kind: "not-set" }
  | { kind: "missing"; path: string }
  | { kind: "no-system"; path: string }
  | { kind: "broken"; path: string; message: string }
  | {
      kind: "ready";
      path: string;
      model: SystemModel;
      history: HistoryRecord[];
      /** Set when some lines of history.jsonl couldn't be read; the rest are still in `history`. */
      historyProblem?: string;
      hasDesignMd: boolean;
      /** Fingerprint of system.json as read, so a save never overwrites newer changes. */
      version: string;
      /** Steward's own test fixture: tests depend on its system.json, so the app never changes it. */
      readOnly: boolean;
    };

type Env = Readonly<Record<string, string | undefined>>;

/**
 * Where `STEWARD_REPO` points. A relative path is taken from where the
 * command was run (`INIT_CWD`, which pnpm sets), so
 * `STEWARD_REPO=fixtures/messy-app pnpm -F web dev` works from the repo root.
 */
export function repoPath(env: Env): string | null {
  const raw = env[REPO_ENV]?.trim();
  if (!raw) return null;
  return isAbsolute(raw) ? raw : resolve(env["INIT_CWD"] ?? process.cwd(), raw);
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** The marker that sets Steward's committed test fixture apart. Copies made by `pnpm -F web demo` and eval/setup.sh leave it out. */
export const FIXTURE_MARKER = "FIXTURE_NOTES.md";
export const isFixture = (path: string) => exists(join(path, FIXTURE_MARKER));

/** Reads the repo named by `STEWARD_REPO`. Never throws for a problem a person can fix. */
export async function loadRepo(env: Env = process.env): Promise<RepoState> {
  const path = repoPath(env);
  if (!path) return { kind: "not-set" };
  if (!(await isDirectory(path))) return { kind: "missing", path };

  let text: string;
  try {
    text = await readFile(systemModelPath(path), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { kind: "no-system", path };
    throw err;
  }
  let model: SystemModel;
  try {
    model = parseSystemModel(text);
  } catch (err) {
    if (err instanceof SystemModelError) return { kind: "broken", path, message: err.message };
    throw err;
  }

  const state: Extract<RepoState, { kind: "ready" }> = { kind: "ready", path, model, history: [], hasDesignMd: await exists(join(path, "design.md")), version: versionOf(text), readOnly: await isFixture(path) };
  const { records, problems } = await readHistoryLines(path);
  state.history = records;
  if (problems.length > 0) {
    const first = problems[0]!;
    state.historyProblem =
      `${problems.length === 1 ? "1 line" : `${problems.length} lines`} of .steward/history.jsonl couldn't be read, so ${problems.length === 1 ? "it's" : "they're"} left out ` +
      `(line ${first.line} ${first.message.replace(/^A history record /, "").replace(/\.$/, "")}). The rest are counted.`;
  }
  return state;
}
