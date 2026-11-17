/**
 * The composite action's "Build Steward" step (action.yml at the repo root),
 * run for real in bash with a stand-in `npx`, so install/build can be made
 * to pass or fail. When the build fails, nothing was checked: warn mode
 * warns and passes, error mode fails the check.
 */
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ACTION = fileURLToPath(new URL("../../../action.yml", import.meta.url));

/** The `run: |` script of the named step, dedented. Enough YAML for this one file; no dependency. */
function stepScript(yaml: string, name: string): string {
  const lines = yaml.split("\n");
  const start = lines.findIndex((l) => l.trim() === `- name: ${name}`);
  if (start === -1) throw new Error(`no step named ${name}`);
  const run = lines.findIndex((l, i) => i > start && /^\s+run: \|$/.test(l));
  const indent = lines[run]!.search(/\S/);
  const body: string[] = [];
  for (const line of lines.slice(run + 1)) {
    if (line.trim() !== "" && line.search(/\S/) <= indent) break;
    body.push(line.slice(indent + 2));
  }
  return body.join("\n");
}

describe("action.yml: Build Steward", () => {
  let work: string;
  let script: string;
  beforeEach(async () => {
    work = await mkdtemp(join(tmpdir(), "steward-action-"));
    script = stepScript(await readFile(ACTION, "utf8"), "Build Steward");
  });
  afterEach(async () => {
    await rm(work, { recursive: true, force: true });
  });

  /** Runs the step the way GitHub does (`bash -eo pipefail`), with `npx` exiting `npxExit`. */
  async function build(options: { npxExit: number; config?: string; path?: string }) {
    const bin = join(work, "bin");
    await mkdir(bin, { recursive: true });
    await writeFile(join(bin, "npx"), `#!/bin/sh\nexit ${options.npxExit}\n`);
    await chmod(join(bin, "npx"), 0o755);
    const workspace = join(work, "workspace");
    const path = options.path ?? "app";
    await mkdir(join(workspace, path, ".steward"), { recursive: true });
    if (options.config !== undefined) await writeFile(join(workspace, path, ".steward", "config.json"), options.config);
    const output = join(work, "output");
    await writeFile(output, "");
    const r = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", script], {
      cwd: work,
      encoding: "utf8",
      env: { PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, GITHUB_OUTPUT: output, GITHUB_WORKSPACE: workspace, STEWARD_PATH: path },
    });
    return { code: r.status, stdout: r.stdout, output: await readFile(output, "utf8") };
  }

  it("takes inputs only through env, never straight into the script", async () => {
    expect(script).not.toContain("${{");
    expect(script).toContain("install --frozen-lockfile --filter @steward/cli...");
  });

  it("when the build works, says so and passes", async () => {
    const r = await build({ npxExit: 0, config: '{ "mode": "error" }' });
    expect(r.code).toBe(0);
    expect(r.output).toBe("ok=true\n");
    expect(r.stdout).toBe("");
  });

  it("when the build fails in error mode, fails the check and says why", async () => {
    const r = await build({ npxExit: 1, config: '{ "mode": "error", "base": "main" }' });
    expect(r.code).toBe(1);
    expect(r.output).toBe("ok=false\n");
    expect(r.stdout).toBe("::error title=Steward Review::Steward couldn't be installed or built, so nothing was checked. Mode: error, so this fails the check.\n");
  });

  it.each([
    ["warn mode", '{ "mode": "warn" }'],
    ["no mode", "{}"],
    ["a config.json that isn't JSON", "{ broken"],
    ["no config.json", undefined],
  ])("when the build fails with %s, warns and passes", async (_, config) => {
    const r = await build({ npxExit: 1, ...(config === undefined ? {} : { config }) });
    expect(r.code).toBe(0);
    expect(r.output).toBe("ok=false\n");
    expect(r.stdout).toBe("::warning title=Steward Review::Steward couldn't be installed or built, so nothing was checked. Mode: warn, so this doesn't fail the check.\n");
  });

  it("reads the path as data, never as code", async () => {
    const r = await build({ npxExit: 1, path: "$(touch pwned)", config: '{ "mode": "error" }' });
    expect(r.code).toBe(1);
    await expect(readFile(join(work, "pwned"))).rejects.toThrow();
  });
});
