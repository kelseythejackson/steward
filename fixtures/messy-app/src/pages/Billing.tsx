import { useState } from "react";
import { Panel } from "../components/Panel";
import { CTAButton } from "../components/CTAButton";
import { Button } from "../components/Button";

const invoices = [
  { id: "INV-0042", date: "Oct 1, 2026", amount: "$199.00", status: "Paid" },
  { id: "INV-0041", date: "Sep 1, 2026", amount: "$199.00", status: "Paid" },
  { id: "INV-0040", date: "Aug 1, 2026", amount: "$149.00", status: "Refunded" },
];

export function Billing() {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-[#1f2937]">Billing</h1>

      <div className="grid grid-cols-3 gap-[10px]">
        <Panel heading="Current plan">
          <p className="text-xl font-semibold text-[#111827]">Growth</p>
          <p className="mt-[7px] text-[#9ca3af]">$199 / month, renews Nov 1</p>
          <div className="mt-4">
            <CTAButton>Upgrade</CTAButton>
          </div>
        </Panel>
        <Panel heading="Payment method">
          <p className="text-[#374151]">Visa ending 4242</p>
          <p className="mt-[7px] text-[#9ca3af]">Expires 08/28</p>
          <div className="mt-4">
            <Button variant="secondary">Update card</Button>
          </div>
        </Panel>
        <Panel heading="Usage">
          <p className="text-[#374151]">9,120 / 10,000 events</p>
          <div className="mt-[7px] h-2 w-full rounded-full bg-[#e5e7eb]">
            <div className="h-2 w-[91%] rounded-full bg-[#3b82f6]" />
          </div>
        </Panel>
      </div>

      <h2 className="mb-3 mt-[22px] text-lg font-semibold text-[#374151]">Invoices</h2>
      <table className="legacy-table w-full text-left text-sm">
        <thead>
          <tr>
            <th>Invoice</th>
            <th>Date</th>
            <th>Amount</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => (
            <tr key={inv.id} className={selected === inv.id ? "bg-[#f3f4f6]" : ""}>
              <td>
                <div onClick={() => setSelected(inv.id)} className="cursor-pointer text-[#3b82f6] hover:underline">
                  {inv.id}
                </div>
              </td>
              <td>{inv.date}</td>
              <td>{inv.amount}</td>
              <td>
                <span className={inv.status === "Paid" ? "badge-blue" : "text-[#9ca3af]"}>{inv.status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-6 flex justify-end">
        <button type="button" className="text-sm text-[#6b7280] hover:text-[#1f2937]">
          Download all invoices
        </button>
      </div>
    </div>
  );
}
