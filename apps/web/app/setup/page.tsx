import { loadRepo } from "../../lib/steward";
import { reviewData } from "../../lib/review-data";
import { setupSummary } from "../../lib/summary";
import { PageHeader, RepoProblem } from "../ui";
import { plural } from "./parts";
import { SetupReview } from "./review";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const repo = await loadRepo();
  if (repo.kind !== "ready") {
    return (
      <>
        <PageHeader title="Setup" description="What Steward found in your code, and the suggestions waiting for a decision." />
        <RepoProblem state={repo} />
      </>
    );
  }
  const s = setupSummary(repo.model);
  const summary = `${plural(s.colors, "color token")}, ${plural(s.spacing, "spacing step")} and ${plural(s.components, "component")}.`;
  return <SetupReview data={reviewData(repo.model)} version={repo.version} summary={summary} />;
}
