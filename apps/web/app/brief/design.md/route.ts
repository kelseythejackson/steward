import { generateDesignMd, projectName } from "@steward/context";
import { loadRepo } from "../../../lib/steward";
import { cli, FROM_STEWARD } from "../../../lib/commands";

export const dynamic = "force-dynamic";

/** design.md for the repo, from its current system.json: the same file `pnpm steward context --file` writes. */
export async function GET(): Promise<Response> {
  const repo = await loadRepo();
  if (repo.kind !== "ready") return new Response(`There's no Steward system to describe yet. Scan it first: ${FROM_STEWARD}, run \`${cli("scan <path>")}\`.`, { status: 404 });
  return new Response(generateDesignMd(repo.model, { name: await projectName(repo.path) }), {
    headers: { "content-type": "text/markdown; charset=utf-8", "content-disposition": 'attachment; filename="design.md"' },
  });
}
