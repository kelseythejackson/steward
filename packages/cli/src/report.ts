import { describeScan, type ScanSummary } from "@steward/scanner";

/** Pure: the short, plain-English report `steward scan` prints: the scan's findings, then where the model went and what to do next. */
export function formatScanReport(summary: ScanSummary, wrotePath: string): string {
  const lines = [...describeScan(summary), `Wrote ${wrotePath}`, "Next: open that file to see the suggestions. The review screen is coming soon."];
  return `${lines.join("\n")}\n`;
}
