import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  decideSuggestions,
  pendingSuggestions,
  readSystemModel,
  STEWARD_DIR,
  SYSTEM_MODEL_FILE,
  SystemModelError,
  systemModelPath,
  writeSystemModel,
  type Suggestion,
  type SuggestionKind,
  type SystemModel,
} from "@steward/model";
import { describeRules, rulesForModel, summarizeRules } from "@steward/scanner";
import { assertDirectory, runScan, StewardError } from "./scan.js";

export interface ReviewRun {
  /** The model as written (or as it was, when nothing was pending). */
  model: SystemModel;
  /** Suggestions accepted by this run. */
  accepted: Suggestion[];
  /** Suggestions still waiting for a decision. */
  pending: Suggestion[];
  /** Absolute path of `system.json`, or `null` when nothing was written. */
  writtenTo: string | null;
}

export interface ReviewOptions {
  /** Accept every suggestion that has no decision yet. */
  acceptAll?: boolean;
  /** ISO timestamp for the decisions. Defaults to now; tests pass a fixed one. */
  now?: string;
  /** The folder as the person typed it, for messages. Defaults to `target`. */
  shownAs?: string;
}

/** Reads the repo's system model, or explains calmly why it can't. */
export async function readModel(root: string, shown: string): Promise<SystemModel> {
  let model: SystemModel | null;
  try {
    model = await readSystemModel(root);
  } catch (err) {
    if (!(err instanceof SystemModelError)) throw err;
    throw new StewardError(`I couldn't read ${STEWARD_DIR}/${SYSTEM_MODEL_FILE}, so I left it as is. ${err.message}`);
  }
  if (!model) throw new StewardError(`There's no Steward system in ${shown} yet. Run \`steward scan ${shown}\` first.`);
  return model;
}

/**
 * Reviews a repo's suggestions. With `acceptAll`, records an accepted
 * decision for every pending suggestion and rebuilds the generated rules.
 * Never edits the person's code; only `.steward/system.json` changes.
 */
export async function runReview(target: string, options: ReviewOptions = {}): Promise<ReviewRun> {
  const root = resolve(target);
  const shown = options.shownAs ?? target;
  await assertDirectory(root, shown);
  const model = await readModel(root, shown);
  const pending = pendingSuggestions(model);
  if (!options.acceptAll || pending.length === 0) return { model, accepted: [], pending, writtenTo: null };

  const now = options.now ?? new Date().toISOString();
  const decided = decideSuggestions(model, pending, "accepted", now);
  const before = await readFile(systemModelPath(root), "utf8");
  await writeSystemModel(root, { ...decided, rules: rulesForModel(decided) });
  // Re-scan, as the Setup screen does, so accepted merges and new colors are in the tokens right away,
  // not only after the next `steward scan`. If that fails, put system.json back exactly as it was.
  try {
    const { output, writtenTo } = await runScan(root, { now, shownAs: shown });
    return { model: output.model, accepted: pending, pending: pendingSuggestions(output.model), writtenTo };
  } catch (err) {
    await writeFile(systemModelPath(root), before, "utf8");
    throw err;
  }
}

const KIND_ORDER: readonly SuggestionKind[] = ["color", "token", "spacing", "component", "contrast"];
const KIND_NAMES: Readonly<Record<SuggestionKind, [string, string]>> = {
  color: ["color merge", "color merges"],
  spacing: ["spacing snap", "spacing snaps"],
  component: ["component merge", "component merges"],
  contrast: ["contrast fix", "contrast fixes"],
  token: ["new color token", "new color tokens"],
};

function byKind(suggestions: readonly Suggestion[]): string {
  const parts = KIND_ORDER.map((k) => [k, suggestions.filter((s) => s.kind === k).length] as const)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${KIND_NAMES[k][n === 1 ? 0 : 1]}`);
  return parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Pure: what `steward decide` prints. `root` is the repo's absolute path,
 * for the command that opens the Setup screen on it.
 */
export function formatReviewReport(run: ReviewRun, shownPath: string, acceptAll: boolean, root = "."): string {
  const { accepted, pending, model } = run;
  const lines: string[] = [];
  if (accepted.length > 0) {
    lines.push(
      `Accepted ${plural(accepted.length, "suggestion")}: ${byKind(accepted)}.`,
      "Only the system file changed; your code is as it was.",
      describeRules(summarizeRules(model.rules)),
      `Wrote ${shownPath}`,
      `To undo one, remove its entry from "decisions" in that file and scan again.`,
    );
  } else if (pending.length === 0) {
    const acceptedCount = model.decisions.filter((d) => d.status === "accepted").length;
    const declined = model.decisions.length - acceptedCount;
    lines.push(`Nothing waiting for a decision: every suggestion has one (${acceptedCount} accepted, ${declined} declined).`);
  } else if (!acceptAll) {
    lines.push(
      `${plural(pending.length, "suggestion")} ${pending.length === 1 ? "is" : "are"} waiting for a decision: ${byKind(pending)}.`,
      `Decide on them one by one on the Setup screen: from the Steward repo, run \`STEWARD_REPO=${root} pnpm -F web dev\` and open http://127.0.0.1:3000/setup.`,
      "Or `steward decide --accept-all` accepts all of them.",
    );
  }
  return `${lines.join("\n")}\n`;
}
