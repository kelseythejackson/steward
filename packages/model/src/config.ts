/**
 * `.steward/config.json`: how Steward Review behaves in a repo. Written by
 * people, so it's small and forgiving: a missing file means the defaults.
 *
 * ```json
 * { "mode": "warn", "base": "main", "rules": { "no-arbitrary-spacing": "off" } }
 * ```
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const CONFIG_FILE = "config.json";

/** `warn` never fails the build. `error` fails it when Review finds anything on the checked lines. */
export type ReviewMode = "warn" | "error";
export type RuleSwitch = "on" | "off";

export interface StewardConfig {
  mode: ReviewMode;
  /** The branch `steward check` compares with. Unset: the repo's default branch. */
  base?: string;
  /**
   * Review rules by id (`no-hardcoded-color`, `a11y-img-alt`, ...). A rule
   * runs only when it's on here and its system rule (if any) is enabled in
   * `system.json`. Rules not listed are on. Ids aren't checked here, since
   * the rules live in `@steward/guard`.
   */
  rules: Record<string, RuleSwitch>;
}

/** A problem with the contents of `config.json`, phrased so a person can fix it. */
export class StewardConfigError extends Error {
  override name = "StewardConfigError";
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const KEYS = new Set(["mode", "base", "rules"]);

/** Pure: parses and checks `config.json` text. Throws `StewardConfigError` with a calm, specific message. */
export function parseStewardConfig(text: string, source = `.steward/${CONFIG_FILE}`): StewardConfig {
  const fail = (problem: string): never => {
    throw new StewardConfigError(`${source} ${problem}`);
  };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return fail(`isn't valid JSON (${(err as Error).message}).`);
  }
  if (!isRecord(raw)) return fail('should be an object like { "mode": "warn" }.');

  const unknown = Object.keys(raw).filter((k) => !KEYS.has(k)).sort();
  if (unknown.length > 0) fail(`has ${unknown.map((k) => `"${k}"`).join(", ")}, which Steward doesn't use. It knows "mode", "base" and "rules".`);

  const mode = raw["mode"] ?? "warn";
  if (mode !== "warn" && mode !== "error") fail(`has mode ${JSON.stringify(mode)}. Use "warn" (never fails the build) or "error" (fails it when Review finds something).`);

  const base = raw["base"];
  if (base !== undefined && (typeof base !== "string" || base.trim() === "")) fail('has a "base" that should be a branch name, like "main".');

  const rulesRaw = raw["rules"] ?? {};
  if (!isRecord(rulesRaw)) return fail('has "rules" that should be an object, like { "a11y-img-alt": "off" }.');
  const rules: Record<string, RuleSwitch> = {};
  for (const id of Object.keys(rulesRaw).sort()) {
    const v = rulesRaw[id];
    if (v !== "on" && v !== "off") fail(`turns rule "${id}" to ${JSON.stringify(v)}. Use "on" or "off".`);
    rules[id] = v as RuleSwitch;
  }

  const config: StewardConfig = { mode: mode as ReviewMode, rules };
  if (typeof base === "string") config.base = base.trim();
  return config;
}

/** Reads `.steward/config.json` from a repo. Returns the defaults when there isn't one. */
export async function readStewardConfig(repoRoot: string): Promise<StewardConfig> {
  let text: string;
  try {
    text = await readFile(join(repoRoot, ".steward", CONFIG_FILE), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { mode: "warn", rules: {} };
    throw err;
  }
  return parseStewardConfig(text);
}
