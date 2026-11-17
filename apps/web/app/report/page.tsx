import { loadRepo } from "../../lib/steward";
import { reportSummary } from "../../lib/summary";
import { PageHeader, Panel, RepoProblem, Stats } from "../ui";

export const dynamic = "force-dynamic";

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en", { dateStyle: "medium", timeZone: "UTC" }) : "None yet");

export default async function ReportPage() {
  const repo = await loadRepo();
  return (
    <>
      <PageHeader title="Report" description="How consistent your product is over time." />
      <div className="flex flex-col gap-6">
        {repo.kind !== "ready" ? (
          <RepoProblem state={repo} />
        ) : repo.historyProblem ? (
          <Panel>
            <p className="text-sm text-gray-700">Steward couldn't read the check history: {repo.historyProblem}</p>
          </Panel>
        ) : repo.history.length === 0 ? (
          <Panel>
            <p className="text-sm text-gray-700">No checks recorded yet. Each run of {"`steward check`"} adds one to .steward/history.jsonl.</p>
          </Panel>
        ) : (
          (() => {
            const s = reportSummary(repo.history);
            return (
              <Stats
                items={[
                  { label: "Checks recorded", value: s.checks },
                  { label: "Pull requests checked", value: s.pullRequests },
                  { label: "First check", value: day(s.first) },
                  { label: "Latest check", value: day(s.latest) },
                ]}
              />
            );
          })()
        )}
        <p className="text-sm text-gray-500">Steward measures your UI, not your people.</p>
      </div>
    </>
  );
}
