/**
 * `pnpm -F web demo`: copies the fixture to a temp folder, scans it fresh
 * (so every suggestion is waiting), adds the Report's check history from
 * real pull requests (`apps/web/demo/history.jsonl`, see demo/README.md),
 * and starts the app on that copy. The committed fixture never changes.
 * Extra arguments go to `next dev`.
 */
import { spawn } from "node:child_process";
import { copyFile, cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runScan } from "@steward/cli";

const fixture = fileURLToPath(new URL("../../../fixtures/messy-app", import.meta.url));
const copy = join(await mkdtemp(join(tmpdir(), "steward-demo-")), "messy-app");
await cp(fixture, copy, { recursive: true, filter: (src) => !src.includes("node_modules") && !src.includes("/.steward") && !src.endsWith("FIXTURE_NOTES.md") });
const { output } = await runScan(copy);
console.log(`Scanned a fresh copy of the fixture at ${copy}: ${output.model.suggestions.length} suggestions waiting.`);
await copyFile(fileURLToPath(new URL("../demo/history.jsonl", import.meta.url)), join(copy, ".steward", "history.jsonl"));
console.log("Added the Report's history: Steward Review checks from real pull requests on a test repo (apps/web/demo/README.md).");

// `pnpm -F web demo -- -p 3001` passes the `--` through; next dev would take it as a folder.
const args = process.argv.slice(2).filter((a, i) => !(i === 0 && a === "--"));

// Only this computer can reach the app: it writes the repo's system.json, so it mustn't be open to the local network.
const next = spawn("pnpm", ["exec", "next", "dev", "-H", "127.0.0.1", ...args], { stdio: "inherit", env: { ...process.env, STEWARD_REPO: copy, NEXT_TELEMETRY_DISABLED: "1" } });
next.on("exit", (code) => process.exit(code ?? 0));
