/**
 * `pnpm -F web demo`: copies the fixture to a temp folder, scans it fresh
 * (so every suggestion is waiting), and starts the app on that copy. The
 * committed fixture never changes. Extra arguments go to `next dev`.
 */
import { spawn } from "node:child_process";
import { cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runScan } from "@steward/cli";

const fixture = fileURLToPath(new URL("../../../fixtures/messy-app", import.meta.url));
const copy = join(await mkdtemp(join(tmpdir(), "steward-demo-")), "messy-app");
await cp(fixture, copy, { recursive: true, filter: (src) => !src.includes("node_modules") && !src.includes("/.steward") && !src.endsWith("FIXTURE_NOTES.md") });
const { output } = await runScan(copy);
console.log(`Scanned a fresh copy of the fixture at ${copy}: ${output.model.suggestions.length} suggestions waiting.`);

const next = spawn("pnpm", ["exec", "next", "dev", ...process.argv.slice(2)], { stdio: "inherit", env: { ...process.env, STEWARD_REPO: copy } });
next.on("exit", (code) => process.exit(code ?? 0));
