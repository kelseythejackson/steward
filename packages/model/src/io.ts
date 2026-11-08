import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { serializeSystemModel } from "./canonical.js";
import { parseSystemModel } from "./parse.js";
import type { SystemModel } from "./types.js";

export const STEWARD_DIR = ".steward";
export const SYSTEM_MODEL_FILE = "system.json";

export function systemModelPath(repoRoot: string): string {
  return join(repoRoot, STEWARD_DIR, SYSTEM_MODEL_FILE);
}

/** Reads `.steward/system.json` from a repo. Returns `null` if Steward hasn't been set up there yet. */
export async function readSystemModel(repoRoot: string): Promise<SystemModel | null> {
  let text: string;
  try {
    text = await readFile(systemModelPath(repoRoot), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  return parseSystemModel(text, `${STEWARD_DIR}/${SYSTEM_MODEL_FILE}`);
}

/**
 * Writes the model with stable ordering, creating `.steward/` if needed.
 * Writes to a temp file first so a crash never leaves a half-written model.
 * Returns the path written.
 */
export async function writeSystemModel(repoRoot: string, model: SystemModel): Promise<string> {
  const target = systemModelPath(repoRoot);
  await mkdir(join(repoRoot, STEWARD_DIR), { recursive: true });
  const tmp = `${target}.tmp`;
  await writeFile(tmp, serializeSystemModel(model), "utf8");
  await rename(tmp, target);
  return target;
}
