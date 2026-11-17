/**
 * Reads the repo the app is pointed at (`STEWARD_REPO`): its system model
 * and check history. Server-side only, and read-only: the app never writes
 * to the repo. Every way this can go wrong is a state the pages can explain.
 */
import { stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { HistoryError, readHistory, readSystemModel, SystemModelError, type HistoryRecord, type SystemModel } from "@steward/model";

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
      /** Set when history.jsonl couldn't be read; the rest still works. */
      historyProblem?: string;
      hasDesignMd: boolean;
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

/** Reads the repo named by `STEWARD_REPO`. Never throws for a problem a person can fix. */
export async function loadRepo(env: Env = process.env): Promise<RepoState> {
  const path = repoPath(env);
  if (!path) return { kind: "not-set" };
  if (!(await isDirectory(path))) return { kind: "missing", path };

  let model: SystemModel | null;
  try {
    model = await readSystemModel(path);
  } catch (err) {
    if (err instanceof SystemModelError) return { kind: "broken", path, message: err.message };
    throw err;
  }
  if (!model) return { kind: "no-system", path };

  const state: Extract<RepoState, { kind: "ready" }> = { kind: "ready", path, model, history: [], hasDesignMd: await exists(join(path, "design.md")) };
  try {
    state.history = await readHistory(path);
  } catch (err) {
    if (!(err instanceof HistoryError)) throw err;
    state.historyProblem = err.message;
  }
  return state;
}
