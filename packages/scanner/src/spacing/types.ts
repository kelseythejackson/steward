/** Spacing (padding, margin, gap) is snapped to the scale. Sizes (width, height) are only listed for now. */
export type SpacingCategory = "spacing" | "size";

export type SpacingSource = "tailwind-class" | "css" | "inline-style";

export interface SpacingLocation {
  /** Path relative to the repo root, with forward slashes. */
  file: string;
  line: number;
  /** The class or declaration exactly as written, e.g. `md:mt-[7px]` or `padding: 9px 13px`. */
  raw: string;
  /** Tailwind prefix (`mt`) or CSS property (`padding`). */
  property: string;
  source: SpacingSource;
}

/** One spacing value found in code, before grouping. */
export interface FoundSpacing extends SpacingLocation {
  /** Size in px. rem is converted at 16px. Negative margins count by size. */
  px: number;
  category: SpacingCategory;
}

export interface ExtractedSpacing {
  px: number;
  uses: number;
  locations: SpacingLocation[];
}

export interface SpacingExtraction {
  /** Padding, margin and gap values, smallest first. */
  values: ExtractedSpacing[];
  /** Widths and heights, smallest first. Not snapped yet. */
  sizes: ExtractedSpacing[];
  filesScanned: number;
  skipped: { file: string; reason: string }[];
}
