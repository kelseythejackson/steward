import { describeScan, type ScanSummary } from "@steward/scanner";

/** Pure: the short, plain-English report `steward scan` prints: the scan's findings, then where the model went and what to do next. */
export function formatScanReport(summary: ScanSummary, wrotePath: string, target = "."): string {
  const lines = [...describeScan(summary), `Wrote ${wrotePath}`, `Next: run \`steward decide ${target}\` to see the suggestions waiting for a decision.`];
  return `${lines.join("\n")}\n`;
}
