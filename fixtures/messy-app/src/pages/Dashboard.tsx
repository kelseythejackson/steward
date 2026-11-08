import { useState } from "react";
import { Card } from "../components/Card";
import { Panel } from "../components/Panel";
import { Button } from "../components/Button";
import { CTAButton } from "../components/CTAButton";
import { Modal } from "../components/Modal";

const stats = [
  { label: "Active users", value: "12,480", delta: "+4.2%" },
  { label: "MRR", value: "$48,200", delta: "+1.8%" },
  { label: "Churn", value: "2.1%", delta: "-0.3%" },
];

export function Dashboard() {
  const [query, setQuery] = useState("");
  const [showTips, setShowTips] = useState(false);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[#111827]">Overview</h1>
        <div className="flex items-center gap-[10px]">
          <input
            type="search"
            placeholder="Search events…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="legacy-input h-9 rounded-md border border-[#d1d5db] px-3 text-sm text-[#374151]"
          />
          <Button variant="ghost" onClick={() => setShowTips(true)}>
            Tips
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-[10px]">
        {stats.map((s) => (
          <Card key={s.label} title={s.label}>
            <p className="text-2xl font-semibold text-[#111827]">{s.value}</p>
            <p className="mt-[7px] text-xs text-[#9ca3af]">{s.delta} vs last week</p>
          </Card>
        ))}
      </div>

      <div className="mt-[22px] grid grid-cols-2 gap-4">
        <Panel heading="Recent signups">
          <ul className="space-y-2 text-[#9ca3af]">
            <li className="flex justify-between">
              <span>northwind.io</span>
              <span className="text-[#6b7280]">2m ago</span>
            </li>
            <li className="flex justify-between">
              <span>fabrikam.dev</span>
              <span className="text-[#6b7380]">14m ago</span>
            </li>
            <li className="flex justify-between">
              <span>contoso.app</span>
              <span className="text-[#6b7280]">1h ago</span>
            </li>
          </ul>
        </Panel>

        <Panel heading="Upgrade to Pro">
          <p className="mb-4">Unlock retention cohorts, exports and unlimited seats.</p>
          <CTAButton size="lg" href="/billing">
            See plans
          </CTAButton>
        </Panel>
      </div>

      <div className="mt-8 rounded-lg bg-[#f3f4f6] p-[13px]">
        <p className="text-sm text-[#6b7280]">
          Your trial ends in 9 days.{" "}
          <button className="text-[#3a81f5] underline" onClick={() => alert("Extended!")}>
            Extend trial
          </button>
        </p>
      </div>

      <Modal open={showTips} title="Dashboard tips" onClose={() => setShowTips(false)}>
        <p>Use the search box to filter events. Click any stat for a breakdown.</p>
      </Modal>
    </div>
  );
}
