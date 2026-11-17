import { basename } from "node:path";
import { generateDesignMd } from "@steward/context";
import { loadRepo } from "../../../lib/steward";

export const dynamic = "force-dynamic";

/** design.md for the repo, from its current system.json: the same file `steward context --file` writes. */
export async function GET(): Promise<Response> {
  const repo = await loadRepo();
  if (repo.kind !== "ready") return new Response("There's no Steward system to describe yet. Run `steward scan` first.", { status: 404 });
  return new Response(generateDesignMd(repo.model, { name: basename(repo.path) }), {
    headers: { "content-type": "text/markdown; charset=utf-8", "content-disposition": 'attachment; filename="design.md"' },
  });
}
