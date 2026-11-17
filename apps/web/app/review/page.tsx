import { RULES } from "@steward/guard";
import { ruleLabel } from "../../lib/fixes";
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
      <RuleList />
    </>
  );
}

/** What each Review rule looks for and how to fix it. The Report's "How to fix" links land here (`#rule-id`). */
function RuleList() {
  const groups = [
    { title: "Consistency", rules: RULES.filter((r) => r.category !== "accessibility") },
    { title: "Accessibility basics", rules: RULES.filter((r) => r.category === "accessibility") },
  ];
  return (
    <section aria-labelledby="rules-title" className="mt-8 flex flex-col gap-6">
      <h2 id="rules-title" className="text-lg font-semibold text-gray-900">
        What Review checks
      </h2>
      {groups.map((g) => (
        <div key={g.title} className="flex flex-col gap-3">
          <h3 className="text-sm font-medium text-gray-700">{g.title}</h3>
          {g.title === "Accessibility basics" && (
            <p className="text-sm text-gray-700">These are static checks: they catch some accessibility problems, not all. Test with a keyboard and a screen reader too.</p>
          )}
          <ul className="flex flex-col gap-2">
            {g.rules.map((r) => (
              <li key={r.id} id={r.id} className="scroll-mt-6 rounded-lg border border-gray-200 bg-white p-4">
                <p className="text-sm font-medium text-gray-900">{ruleLabel(r.id)}</p>
                <p className="text-sm text-gray-700">{r.description}</p>
                <p className="mt-1 font-mono text-xs text-gray-700">{r.id}</p>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
