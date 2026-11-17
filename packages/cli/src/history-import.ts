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
import {
  appendHistory,
  checkHistoryRecord,
  readHistory,
  readImportedArtifacts,
  serializeHistoryRecord,
  writeImportedArtifacts,
  type HistoryRecord,
} from "@steward/model";
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
  /** steward-history artifacts downloaded and read this time (not expired). */
  artifacts: number;
  /** Records appended. */
  added: number;
  /** Records already in history.jsonl. */
  alreadyThere: number;
  /** Expired artifacts GitHub no longer has. */
  expired: number;
  /** Lines that weren't valid history records, so weren't imported. */
  refused: number;
  /** Artifacts imported on an earlier run (listed in history-imported.json), so not downloaded again. */
  skipped: number;
  /** Artifacts that downloaded but couldn't be read as a zip, by name. Not remembered, so the next import tries them again. */
  unreadable: string[];
}

interface Artifact {
  id: number;
  name: string;
  expired: boolean;
  archive_download_url: string;
}

/** Why a request never got an answer, in a few words: Node's `fetch failed` hides the reason in `cause`. */
function networkReason(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const cause = err instanceof Error ? (err.cause as { code?: unknown; message?: unknown } | undefined) : undefined;
  const detail = typeof cause?.code === "string" ? cause.code : typeof cause?.message === "string" ? cause.message : "";
  return detail && !message.includes(detail) ? `${message}: ${detail}` : message;
}

/**
 * Downloads every steward-history artifact in `repo` that wasn't imported
 * before and appends the records not already in the history. Running it
 * twice adds nothing and downloads nothing new.
 */
export async function importHistory(root: string, options: { repo: string; token: string; apiUrl?: string; fetch?: Fetch }): Promise<ImportResult> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const api = options.apiUrl ?? "https://api.github.com";
  const headers = { authorization: `Bearer ${options.token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "steward" };
  const unreachable = (err: unknown) =>
    new StewardError(
      `Steward couldn't reach GitHub (${networkReason(err)}). Check your connection${options.apiUrl ? `, and GITHUB_API_URL (${options.apiUrl})` : ""}, then try again.`,
    );
  async function get(url: string): Promise<Response> {
    let res: Response;
    try {
      res = await fetchImpl(url, { headers });
    } catch (err) {
      throw unreachable(err);
    }
    if (res.status === 401 || res.status === 403) throw new StewardError(`GitHub didn't let Steward read ${options.repo}'s artifacts (${res.status}). Check you're logged in (\`gh auth login\`) with access to that repo.`);
    if (res.status === 404) throw new StewardError(`GitHub couldn't find ${options.repo}, or your login can't see it. Check the name with --repo owner/name.`);
    if (!res.ok) throw new StewardError(`GitHub's API answered ${res.status} for ${url}.`);
    return res;
  }
  /** The body, read in full. A connection that drops partway is a network problem too. */
  async function body<T>(res: Response, read: (r: Response) => Promise<T>, url: string): Promise<T> {
    try {
      return await read(res);
    } catch (err) {
      if (err instanceof SyntaxError) {
        throw new StewardError(`The answer from ${url} wasn't GitHub's API (it isn't JSON)${options.apiUrl ? `. Check GITHUB_API_URL (${options.apiUrl})` : ""}.`);
      }
      throw unreachable(err);
    }
  }

  const artifacts: Artifact[] = [];
  for (let page = 1; ; page++) {
    const url = `${api}/repos/${options.repo}/actions/artifacts?per_page=100&page=${page}`;
    const list = (await body(await get(url), (r) => r.json(), url)) as { artifacts?: Artifact[] };
    const batch = list.artifacts ?? [];
    artifacts.push(...batch.filter((a) => a.name.startsWith(ARTIFACT_PREFIX)));
    if (batch.length < 100) break;
  }

  const have = new Set((await readHistory(root)).map(serializeHistoryRecord));
  const imported = await readImportedArtifacts(root);
  const before = imported.size;
  const result: ImportResult = { repo: options.repo, artifacts: 0, added: 0, alreadyThere: 0, expired: 0, refused: 0, skipped: 0, unreadable: [] };
  try {
    // Oldest first, so history.jsonl stays roughly in order.
    for (const a of [...artifacts].reverse()) {
      if (a.expired) {
        result.expired++;
        continue;
      }
      if (imported.has(a.id)) {
        result.skipped++;
        continue;
      }
      const zip = Buffer.from(await body(await get(a.archive_download_url), (r) => r.arrayBuffer(), a.archive_download_url));
      let files: Map<string, Buffer>;
      try {
        files = unzip(zip);
      } catch {
        result.unreadable.push(a.name);
        continue;
      }
      result.artifacts++;
      for (const [name, content] of files) {
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
      if (Number.isSafeInteger(a.id)) imported.add(a.id);
    }
  } finally {
    // Remember what was read, even if a later download failed, so the next run picks up from there.
    if (imported.size > before) await writeImportedArtifacts(root, imported);
  }
  result.unreadable.sort();
  return result;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Pure: what `steward history import` prints. */
export function formatImport(r: ImportResult, shown: string): string {
  const file = `${shown}/.steward/history.jsonl`;
  const seen = r.artifacts + r.expired + r.skipped + r.unreadable.length;
  const lines = [
    seen === 0
      ? `No steward-history artifacts in ${r.repo} yet. They appear after the Steward Review action runs on a pull request.`
      : r.artifacts === 0 && r.unreadable.length === 0
        ? `No new steward-history artifacts in ${r.repo}, so ${file} is up to date.`
        : `Imported ${plural(r.added, "record")} from ${plural(r.artifacts, "artifact")} in ${r.repo} into ${file}.`,
  ];
  if (r.skipped > 0) lines.push(`${plural(r.skipped, "artifact")} ${r.skipped === 1 ? "was" : "were"} imported before, so ${r.skipped === 1 ? "it wasn't" : "they weren't"} downloaded again.`);
  if (r.alreadyThere > 0) lines.push(`${plural(r.alreadyThere, "record")} ${r.alreadyThere === 1 ? "was" : "were"} already there, so ${r.alreadyThere === 1 ? "it wasn't" : "they weren't"} added again.`);
  if (r.expired > 0) lines.push(`${plural(r.expired, "artifact")} had expired on GitHub (they're kept 90 days).`);
  if (r.refused > 0) lines.push(r.refused === 1 ? "1 line wasn't a valid history record, so it wasn't imported." : `${r.refused} lines weren't valid history records, so they weren't imported.`);
  if (r.unreadable.length > 0) {
    const n = r.unreadable.length;
    lines.push(`${n === 1 ? "1 artifact" : `${n} artifacts`} couldn't be read as a zip archive, so ${n === 1 ? "it was" : "they were"} skipped: ${r.unreadable.join(", ")}. The next import tries again.`);
  }
  return `${lines.join("\n")}\n`;
}
