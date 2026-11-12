import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSystemModel, serializeSystemModel } from "@steward/model";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "./main.js";
import { runReview } from "./review.js";
import { runScan } from "./scan.js";

const FIXTURE = fileURLToPath(new URL("../../../fixtures/messy-app", import.meta.url));
const NOW = "2026-11-12T10:00:00.000Z";

async function run(argv: string[], cwd: string) {
  let stdout = "";
  let stderr = "";
  const code = await main(argv, { stdout: (t) => (stdout += t), stderr: (t) => (stderr += t), cwd });
  return { code, stdout, stderr };
}

describe("steward review", () => {
  let work: string;
  let app: string;
  beforeEach(async () => {
    work = await mkdtemp(join(tmpdir(), "steward-review-"));
    app = join(work, "messy-app");
    await cp(FIXTURE, app, { recursive: true, filter: (src) => !src.includes("/.steward") && !src.includes("node_modules") });
  });
  afterEach(async () => {
    await rm(work, { recursive: true, force: true });
  });

  it("asks for a scan first when there's no system yet", async () => {
    const r = await run(["review", "messy-app"], work);
    expect(r.code).toBe(1);
    expect(r.stderr).toBe("There's no system to review in messy-app yet. Run `steward scan messy-app` first.\n");
  });

  it("without --accept-all, says what's waiting and changes nothing", async () => {
    await runScan(app);
    const before = await readFile(join(app, ".steward/system.json"), "utf8");
    const r = await run(["review", "messy-app"], work);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(
      "24 suggestions are waiting for a decision: 6 color merges, 7 spacing snaps, 2 component merges and 9 contrast fixes.\n" +
        "The review screen is coming soon. For now, `steward review --accept-all` accepts all of them, or edit the file by hand.\n",
    );
    expect(await readFile(join(app, ".steward/system.json"), "utf8")).toBe(before);
  });

  it("--accept-all accepts every pending suggestion, rebuilds the rules and leaves the code alone", async () => {
    await runScan(app);
    const source = await readFile(join(app, "src/components/Button.tsx"), "utf8");
    const r = await run(["review", "messy-app", "--accept-all"], work);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(
      [
        "Accepted 24 suggestions: 6 color merges, 7 spacing snaps, 2 component merges and 9 contrast fixes.",
        "Only the system file changed; your code is as it was.",
        "Rules: 25 starter rules (6 accessibility basics, 19 from changes you accepted)",
        "Wrote messy-app/.steward/system.json",
        'To undo one, remove its entry from "decisions" in that file and scan again.',
        "",
      ].join("\n"),
    );
    const model = parseSystemModel(await readFile(join(app, ".steward/system.json"), "utf8"));
    expect(model.decisions).toHaveLength(24);
    expect(model.decisions.every((d) => d.status === "accepted")).toBe(true);
    expect(model.rules.map((x) => x.id)).toContain("no-raw-button");
    expect(await readFile(join(app, "src/components/Button.tsx"), "utf8")).toBe(source);
  });

  it("keeps earlier decisions, and a re-scan keeps the same rules", async () => {
    const { output } = await runScan(app);
    const declined = output.model.suggestions.find((s) => s.kind === "component")!;
    const path = join(app, ".steward/system.json");
    await writeFile(
      path,
      serializeSystemModel({
        ...output.model,
        decisions: [{ suggestionId: declined.id, kind: declined.kind, members: declined.members, status: "rejected", decidedAt: NOW }],
      }),
    );

    const reviewed = await runReview(app, { acceptAll: true, now: NOW });
    expect(reviewed.accepted.map((s) => s.id)).not.toContain(declined.id);
    expect(reviewed.model.decisions.find((d) => d.suggestionId === declined.id)!.status).toBe("rejected");

    const rescanned = await runScan(app);
    expect(rescanned.output.model.rules).toEqual(reviewed.model.rules);
  });

  it("says when there's nothing left to review", async () => {
    await runScan(app);
    await run(["review", "messy-app", "--accept-all"], work);
    const r = await run(["review", "messy-app", "--accept-all"], work);
    expect(r.stdout).toBe("Nothing to review: every suggestion has a decision (24 accepted, 0 declined).\n");
  });
});
