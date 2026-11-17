import { describeScan, type ScanSummary } from "@steward/scanner";

/** Pure: the short, plain-English report `steward scan` prints: the scan's findings, then where the model went and what to do next. */
export function formatScanReport(summary: ScanSummary, wrotePath: string, target = ".", waiting?: number): string {
  // Only point at `steward decide` when something is waiting there.
  const next = waiting === 0 ? "Nothing is waiting for a decision." : `Next: run \`steward decide ${target}\` to see the suggestions waiting for a decision.`;
  const lines = [...describeScan(summary), `Wrote ${wrotePath}`, next];
  return `${lines.join("\n")}\n`;
}
