"use server";

import { revalidatePath } from "next/cache";
import { applyDecision, isDecision, type DecideResult } from "../../lib/decide";
import { repoPath } from "../../lib/steward";

/** Saves one decision to the repo's system.json and re-scans. The input comes from the browser, so it's checked first. */
export async function decide(version: unknown, decision: unknown): Promise<DecideResult> {
  const root = repoPath(process.env);
  if (!root) return { ok: false, message: "Steward isn't pointed at a repo. Set STEWARD_REPO and restart the app." };
  if (typeof version !== "string" || !isDecision(decision)) return { ok: false, message: "That request didn't look like a decision, so nothing was saved." };
  const result = await applyDecision(root, version, decision);
  revalidatePath("/setup");
  return result;
}
