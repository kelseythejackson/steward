import type { ContrastUse } from "@steward/model";
import { wcagContrast } from "culori";

/** WCAG 2.2 AA minimums. */
export const REQUIRED_RATIO: Readonly<Record<ContrastUse, number>> = { text: 4.5, "large-text": 3, ui: 3 };

/** Order from strictest to most lenient, used when one pair is used several ways. */
export const USE_STRICTNESS: readonly ContrastUse[] = ["text", "large-text", "ui"];

/** WCAG contrast ratio between two colors (order doesn't matter), from 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  return wcagContrast(a, b);
}

/** Rounds down, so a failing ratio like 4.49 never displays as a passing 4.5. */
export function floorTo(n: number, places: number): number {
  const f = 10 ** places;
  return Math.floor(n * f + 1e-9) / f;
}

/** e.g. "2.5:1". Always rounded down. */
export function formatRatio(ratio: number): string {
  return `${floorTo(ratio, 1).toFixed(1)}:1`;
}

/** WCAG large text: at least 18pt (24px), or 14pt (about 18.66px) and bold. */
export function isLargeText(sizePx: number, weight: number): boolean {
  return sizePx >= 24 || (sizePx >= 18.66 && weight >= 700);
}
