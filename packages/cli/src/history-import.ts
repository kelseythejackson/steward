/**
 * `steward history import`: brings the pull request checks' history into
 * `.steward/history.jsonl`. The GitHub Action saves each run's record as a
 * `steward-history-*` artifact, since the runner is thrown away; this
 * downloads them with the person's own GitHub login and appends the ones
 * that aren't there yet. Every record is checked against the history rules
 * first, so nothing personal can come in this way either.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { inflateRawSync } from "node:zlib";
import { appendHistory, checkHistoryRecord, readHistory, serializeHistoryRecord, type HistoryRecord } from "@steward/model";
import { StewardError } from "./scan.js";

export const ARTIFACT_PREFIX = "steward-history-";
type Fetch = typeof globalThis.fetch;
type Env = Readonly<Record<string, string | undefined>>;
const run = promisify(execFile);

/** Pure: `owner/name` from a GitHub remote URL (https or ssh), or null for anything else. */
export function githubRepoOf(remote: string): string | null {
  const m = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(remote.trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

/**
 * Pure: the files in a zip archive (stored or deflated), by name. Reads the
 * central directory, so archives with data descriptors work too. Enough
 * for GitHub's artifact zips; no dependency.
 */
export function unzip(buf: Buffer): Map<string, Buffer> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error("not a zip archive");
  const files = new Map<string, Buffer>();
  let at = buf.readUInt32LE(eocd + 16);
  for (let n = buf.readUInt16LE(eocd + 10); n > 0; n--) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error("damaged zip archive");
    const method = buf.readUInt16LE(at + 10);
    const size = buf.readUInt32LE(at + 20);
    const nameLength = buf.readUInt16LE(at + 28);
    const name = buf.toString("utf8", at + 46, at + 46 + nameLength);
    const local = buf.readUInt32LE(at + 42);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    if (method === 0) files.set(name, Buffer.from(data));
    else if (method === 8) files.set(name, inflateRawSync(data));
    else throw new Error(`zip entry ${name} uses a compression Steward can't read`);
    at += 46 + nameLength + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
  }
  return files;
}

/** `owner/name` of the repo's `origin` remote on GitHub, or null. */
export async function originRepo(root: string): Promise<string | null> {
  try {
    const { stdout } = await run("git", ["-C", root, "remote", "get-url", "origin"]);
    return githubRepoOf(stdout);
  } catch {
    return null;
  }
}

/** The person's GitHub token: GITHUB_TOKEN, GH_TOKEN, or the GitHub CLI's login. Null if there's none. */
export async function githubToken(env: Env): Promise<string | null> {
  const fromEnv = env["GITHUB_TOKEN"] ?? env["GH_TOKEN"];
  if (fromEnv) return fromEnv;
  try {
    // Run gh with the environment Steward was given (its PATH too), so callers and tests decide whether gh is reachable.
    const { stdout } = await run("gh", ["auth", "token"], { env: { ...env } as NodeJS.ProcessEnv });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export interface ImportResult {
  repo: string;
  /** steward-history artifacts found (not expired). */
  artifacts: number;
  /** Records appended. */
  added: number;
  /** Records already in history.jsonl. */
  alreadyThere: number;
  /** Expired artifacts GitHub no longer has. */
  expired: number;
  /** Lines that weren't valid history records, so weren't imported. */
  refused: number;
}

interface Artifact {
  name: string;
  expired: boolean;
  archive_download_url: string;
}

/**
 * Downloads every steward-history artifact in `repo` and appends the
 * records not already in the history. Running it twice adds nothing.
 */
export async function importHistory(root: string, options: { repo: string; token: string; apiUrl?: string; fetch?: Fetch }): Promise<ImportResult> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const api = options.apiUrl ?? "https://api.github.com";
  const headers = { authorization: `Bearer ${options.token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "steward" };
  async function get(url: string): Promise<Response> {
    const res = await fetchImpl(url, { headers });
    if (res.status === 401 || res.status === 403) throw new StewardError(`GitHub didn't let Steward read ${options.repo}'s artifacts (${res.status}). Check you're logged in (\`gh auth login\`) with access to that repo.`);
    if (res.status === 404) throw new StewardError(`GitHub couldn't find ${options.repo}, or your login can't see it. Check the name with --repo owner/name.`);
    if (!res.ok) throw new StewardError(`GitHub's API answered ${res.status} for ${url}.`);
    return res;
  }

  const artifacts: Artifact[] = [];
  for (let page = 1; ; page++) {
    const body = (await (await get(`${api}/repos/${options.repo}/actions/artifacts?per_page=100&page=${page}`)).json()) as { artifacts?: Artifact[] };
    const batch = body.artifacts ?? [];
    artifacts.push(...batch.filter((a) => a.name.startsWith(ARTIFACT_PREFIX)));
    if (batch.length < 100) break;
  }

  const have = new Set((await readHistory(root)).map(serializeHistoryRecord));
  const result: ImportResult = { repo: options.repo, artifacts: 0, added: 0, alreadyThere: 0, expired: 0, refused: 0 };
  // Oldest first, so history.jsonl stays roughly in order.
  for (const a of [...artifacts].reverse()) {
    if (a.expired) {
      result.expired++;
      continue;
    }
    result.artifacts++;
    const zip = Buffer.from(await (await get(a.archive_download_url)).arrayBuffer());
    for (const [name, content] of unzip(zip)) {
      if (!name.endsWith(".jsonl")) continue;
      for (const line of content.toString("utf8").split("\n")) {
        if (line.trim() === "") continue;
        let record: HistoryRecord;
        try {
          record = checkHistoryRecord(JSON.parse(line));
        } catch {
          result.refused++;
          continue;
        }
        const key = serializeHistoryRecord(record);
        if (have.has(key)) {
          result.alreadyThere++;
          continue;
        }
        await appendHistory(root, record);
        have.add(key);
        result.added++;
      }
    }
  }
  return result;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Pure: what `steward history import` prints. */
export function formatImport(r: ImportResult, shown: string): string {
  const lines = [
    r.artifacts === 0 && r.expired === 0
      ? `No steward-history artifacts in ${r.repo} yet. They appear after the Steward Review action runs on a pull request.`
      : `Imported ${plural(r.added, "record")} from ${plural(r.artifacts, "artifact")} in ${r.repo} into ${shown}/.steward/history.jsonl.`,
  ];
  if (r.alreadyThere > 0) lines.push(`${plural(r.alreadyThere, "record")} ${r.alreadyThere === 1 ? "was" : "were"} already there, so ${r.alreadyThere === 1 ? "it wasn't" : "they weren't"} added again.`);
  if (r.expired > 0) lines.push(`${plural(r.expired, "artifact")} had expired on GitHub (they're kept 90 days).`);
  if (r.refused > 0) lines.push(`${plural(r.refused, "line")} weren't valid history records, so ${r.refused === 1 ? "it wasn't" : "they weren't"} imported.`);
  return `${lines.join("\n")}\n`;
}

