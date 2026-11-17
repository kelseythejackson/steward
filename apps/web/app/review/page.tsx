import { loadRepo } from "../../lib/steward";
import { reviewSummary } from "../../lib/summary";
import { PageHeader, RepoProblem, Stats } from "../ui";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const repo = await loadRepo();
  return (
    <>
      <PageHeader title="Review" description="Checks on pull requests: off-system values and accessibility basics, with suggested fixes." />
      {repo.kind === "ready" ? (
        (() => {
          const s = reviewSummary(repo.model);
          return (
            <Stats
              items={[
                { label: "Rules on", value: s.rulesOn },
                { label: "Rules off", value: s.rulesOff },
                { label: "Marked intentional", value: s.exceptions },
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
