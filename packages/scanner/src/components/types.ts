/** A React component found in the repo. */
export interface ComponentInfo {
  name: string;
  /** Path relative to the repo root, with forward slashes. */
  file: string;
  line: number;
  exported: boolean;
  /** Prop names from the destructured parameter and the props type, sorted. */
  props: string[];
  /** True when the component collects `...rest` props. */
  spreadsRest: boolean;
  /** Types the props extend, e.g. `ButtonHTMLAttributes<HTMLButtonElement>`. */
  extendsTypes: string[];
  /** Values of a union-typed `variant` prop. */
  variants: string[];
  /** Elements it can render at the root: host tags (`button`), components (`Card`) or `fragment`. */
  rootElements: string[];
  /** Utility families on the root element(s), e.g. `rounded`, `p`, `bg-color`. */
  rootClassPatterns: string[];
  /** Plain-English behavior traits, e.g. `sets role="dialog"`, `handles the Escape key`. */
  behavior: string[];
  /** Places in the repo that render it. */
  usages: number;
}

export interface ComponentInventory {
  /** Sorted by name, then file. */
  components: ComponentInfo[];
  filesScanned: number;
  skipped: { file: string; reason: string }[];
}
