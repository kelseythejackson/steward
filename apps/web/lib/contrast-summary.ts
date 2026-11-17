/** Pure, safe for the browser: the Contrast card's summary line. */

/**
 * `7 of 9 pairs still below WCAG AA · 2 fixed`. Only accepted fixes count as
 * fixed: a declined fix still fails, so it's still below ("raise the floor").
 */
export function contrastSummary(total: number, accepted: number): string {
  const pairs = `${total} ${total === 1 ? "pair" : "pairs"}`;
  if (accepted === 0) return `${pairs} below WCAG AA`;
  if (accepted >= total) return total === 1 ? "1 pair fixed" : `All ${pairs} fixed`;
  return `${total - accepted} of ${pairs} still below WCAG AA · ${accepted} fixed`;
}
