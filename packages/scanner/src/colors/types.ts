/** Where a color was found. */
export type ColorSource = "tailwind-class" | "inline-style" | "css" | "tailwind-config";

export interface ColorLocation {
  /** Path relative to the repo root, with forward slashes. */
  file: string;
  line: number;
  /** The color exactly as written. */
  raw: string;
  source: ColorSource;
  /** Surrounding context: the class, the CSS declaration or the style property. */
  snippet: string;
}

/** A color found in code before it is matched to a canonical value. */
export interface FoundColor extends ColorLocation {
  value: string;
}

export interface ExtractedColor {
  /** Canonical lowercase hex. */
  value: string;
  /** Number of places the color is used. Definitions don't count. */
  uses: number;
  locations: ColorLocation[];
  /** Places the color is defined as a theme value, e.g. in `tailwind.config.ts`. */
  definitions: ColorLocation[];
}

export interface SkippedFile {
  file: string;
  reason: string;
}

export interface ColorExtraction {
  colors: ExtractedColor[];
  filesScanned: number;
  skipped: SkippedFile[];
}

export interface SourceFile {
  /** Path relative to the repo root, with forward slashes. */
  path: string;
  content: string;
}
