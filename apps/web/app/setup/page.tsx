import { loadRepo } from "../../lib/steward";
import { setupSummary } from "../../lib/summary";
import { PageHeader, RepoProblem, Stats } from "../ui";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const repo = await loadRepo();
  return (
    <>
      <PageHeader title="Setup" description="What Steward found in your code, and the suggestions waiting for a decision." />
      {repo.kind === "ready" ? (
        (() => {
          const s = setupSummary(repo.model);
          return (
            <Stats
              items={[
                { label: "Color tokens", value: s.colors },
                { label: "Spacing steps", value: s.spacing },
                { label: "Components", value: s.components },
                { label: "Suggestions waiting", value: s.waiting },
              ]}
            />
          );
        })()
      ) : (
        <RepoProblem state={repo} />
      )}
    </>
  );
}
