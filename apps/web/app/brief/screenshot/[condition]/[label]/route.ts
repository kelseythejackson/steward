import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CONDITIONS, demoDir, LABEL } from "../../../../../lib/brief";

/** A saved eval screenshot, `eval/results/<condition>/<label>.png`. Only those exact names are served. */
export async function GET(_: Request, { params }: { params: Promise<{ condition: string; label: string }> }): Promise<Response> {
  const { condition, label } = await params;
  if (!(CONDITIONS as readonly string[]).includes(condition) || !LABEL.test(label)) return new Response("Not found", { status: 404 });
  const dir = await demoDir(process.env, process.cwd());
  if (!dir) return new Response("Not found", { status: 404 });
  try {
    return new Response(new Uint8Array(await readFile(join(dir, condition, `${label}.png`))), { headers: { "content-type": "image/png", "cache-control": "no-store" } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
