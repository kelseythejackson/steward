import { loadRepo } from "../../lib/steward";
import { PageHeader, RepoProblem, Stats } from "../ui";

export const dynamic = "force-dynamic";

export default async function BriefPage() {
  const repo = await loadRepo();
  return (
    <>
      <PageHeader title="Brief" description="Give your AI tools your components and tokens, through design.md or the MCP server." />
      {repo.kind === "ready" ? (
        <Stats
          items={[
            { label: "design.md", value: repo.hasDesignMd ? "Written" : "Not yet" },
            { label: "Rules for AI tools", value: repo.model.rules.length },
          ]}
        />
      ) : (
        <RepoProblem state={repo} />
      )}
    </>
  );
}
