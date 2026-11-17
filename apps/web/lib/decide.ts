/**
 * Saves a decision from the review screen to the repo's system.json, then
 * re-runs the scan (as `steward scan` would) so tokens and rules reflect it
 * right away. Only `.steward/system.json` changes; the person's code never does.
 */
import { readFile, writeFile } from "node:fs/promises";
import { runScan } from "@steward/cli";
import {
  acceptSuggestions,
  DecisionError,
  editColorGroups,
  keepComponent,
  leaveSpacingOff,
  parseSystemModel,
  pendingSuggestions,
  rejectSuggestions,
  systemModelPath,
  undoDecision,
  writeSystemModel,
  type ColorGroupEdit,
  type SystemModel,
} from "@steward/model";
import { isFixture } from "./steward.ts";
import { versionOf } from "./version.ts";
import { cli, FROM_STEWARD } from "./commands.ts";

export type Decision =
  | { kind: "accept"; ids: string[] }
  | { kind: "accept-all" }
  | { kind: "reject"; ids: string[] }
  | { kind: "undo"; id: string }
  | { kind: "color-groups"; groups: ColorGroupEdit[] }
  | { kind: "leave-off"; id: string; values: string[] }
  | { kind: "keep"; id: string; keep: string };

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

/** Checks a decision's shape: it arrives from the browser, so it's not trusted. */
export function isDecision(v: unknown): v is Decision {
  if (!v || typeof v !== "object") return false;
  const d = v as Record<string, unknown>;
  switch (d["kind"]) {
    case "accept":
    case "reject":
      return isStrings(d["ids"]) && d["ids"].length > 0;
    case "accept-all":
      return true;
    case "undo":
      return typeof d["id"] === "string";
    case "color-groups":
      return Array.isArray(d["groups"]) && d["groups"].every((g) => g && typeof g === "object" && isStrings((g as Record<string, unknown>)["members"]) && typeof (g as Record<string, unknown>)["path"] === "string");
    case "leave-off":
      return typeof d["id"] === "string" && isStrings(d["values"]);
    case "keep":
      return typeof d["id"] === "string" && typeof d["keep"] === "string";
    default:
      return false;
  }
}

export type DecideResult = { ok: true; message: string; version: string } | { ok: false; message: string };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function apply(model: SystemModel, d: Decision, now: string): { model: SystemModel; message: string } {
  switch (d.kind) {
    case "accept":
      return { model: acceptSuggestions(model, d.ids, now), message: `Accepted ${plural(d.ids.length, "suggestion")}.` };
    case "accept-all": {
      const ids = pendingSuggestions(model).map((s) => s.id);
      if (ids.length === 0) throw new DecisionError("There's nothing waiting for a decision.");
      return { model: acceptSuggestions(model, ids, now), message: `Accepted all ${plural(ids.length, "suggestion")}.` };
    }
    case "reject":
      {
        // A declined contrast fix isn't settled: the pair still fails, so say that rather than "kept".
        const contrast = d.ids.length === 1 && model.suggestions.some((s) => s.id === d.ids[0] && s.kind === "contrast");
        const message = contrast
          ? "Fix declined. The pair still fails WCAG AA, so it stays on the Contrast card; you can undo this there."
          : d.ids.length === 1
            ? "Kept as it is. Steward won't suggest it again."
            : `Kept ${d.ids.length} as they are.`;
        return { model: rejectSuggestions(model, d.ids, now), message };
      }
    case "undo":
      return { model: undoDecision(model, d.id), message: "Undone. It's waiting for a decision again." };
    case "color-groups":
      return { model: editColorGroups(model, d.groups, now), message: `Saved ${plural(d.groups.length, "color group")}.` };
    case "leave-off":
      return { model: leaveSpacingOff(model, d.id, d.values, now), message: `${d.values.join(", ")} won't snap. Review will still flag ${d.values.length === 1 ? "it" : "them"} as off the scale.` };
    case "keep":
      return { model: keepComponent(model, d.id, d.keep, now), message: `Accepted: keeping ${d.keep}.` };
  }
}

/** Saves waiting for their turn, by repo. One save at a time per repo, so none is lost. */
const queues = new Map<string, Promise<unknown>>();

/**
 * Applies one decision to the repo at `root`, after any save already in
 * progress there. A second save made from the same page version then sees
 * the file changed and asks the person to reload, instead of silently
 * overwriting the first.
 */
export function applyDecision(root: string, version: string, decision: Decision, now = new Date().toISOString()): Promise<DecideResult> {
  const turn = (queues.get(root) ?? Promise.resolve()).then(() => applyNow(root, version, decision, now));
  queues.set(root, turn.catch(() => undefined));
  return turn;
}

/**
 * Applies one decision to the repo at `root`. `version` is the fingerprint
 * the page loaded; if system.json changed since, nothing is written.
 */
async function applyNow(root: string, version: string, decision: Decision, now: string): Promise<DecideResult> {
  let text: string;
  try {
    text = await readFile(systemModelPath(root), "utf8");
  } catch {
    return { ok: false, message: `There's no system.json to save to. Scan the repo first: ${FROM_STEWARD}, run \`${cli("scan <path>")}\`.` };
  }
  if (await isFixture(root)) {
    return { ok: false, message: "This is Steward's own test fixture, and its tests depend on it, so decisions aren't saved here. Run `pnpm -F web demo` for a copy you can change." };
  }
  if (versionOf(text) !== version) return { ok: false, message: "The system changed since this page loaded, so nothing was saved. Reload to see the latest, then try again." };

  let result: { model: SystemModel; message: string };
  try {
    result = apply(parseSystemModel(text), decision, now);
  } catch (err) {
    if (err instanceof DecisionError) return { ok: false, message: err.message };
    throw err;
  }
  await writeSystemModel(root, result.model);
  // Re-scan so tokens and rules reflect the decision now, as `steward scan` would.
  // If that fails, put system.json back exactly as it was: a decision must never leave the system unscannable.
  try {
    await runScan(root, { now });
  } catch (err) {
    await writeFile(systemModelPath(root), text, "utf8");
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Steward couldn't re-scan with that decision (${detail}), so nothing was saved and the system is as it was.` };
  }
  return { ok: true, message: result.message, version: versionOf(await readFile(systemModelPath(root), "utf8")) };
}
