import type { GuardRule } from "../rule.js";
import { a11yAccessibleName, a11yImgAlt, a11yInteractiveElement, a11yLabelInputs } from "./a11y.js";
import { a11yFocusVisible, a11yTextContrast } from "./contrast.js";
import { noArbitrarySpacing } from "./no-arbitrary-spacing.js";
import { noHardcodedColor } from "./no-hardcoded-color.js";
import { useSystemComponent } from "./use-system-component.js";

/** Every rule, in the order findings on the same spot are listed. */
export const RULES: readonly GuardRule[] = [
  noHardcodedColor,
  noArbitrarySpacing,
  useSystemComponent,
  a11yImgAlt,
  a11yAccessibleName,
  a11yLabelInputs,
  a11yInteractiveElement,
  a11yFocusVisible,
  a11yTextContrast,
];

export { a11yAccessibleName, a11yFocusVisible, a11yImgAlt, a11yInteractiveElement, a11yLabelInputs, a11yTextContrast, noArbitrarySpacing, noHardcodedColor, useSystemComponent };
