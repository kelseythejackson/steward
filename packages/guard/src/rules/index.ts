import type { GuardRule } from "../rule.js";
import { a11yIconButtonLabel, a11yImgAlt } from "./a11y.js";
import { noArbitrarySpacing } from "./no-arbitrary-spacing.js";
import { noHardcodedColor } from "./no-hardcoded-color.js";
import { useSystemComponent } from "./use-system-component.js";

/** Every rule, in the order findings on the same spot are listed. */
export const RULES: readonly GuardRule[] = [noHardcodedColor, noArbitrarySpacing, useSystemComponent, a11yImgAlt, a11yIconButtonLabel];

export { a11yIconButtonLabel, a11yImgAlt, noArbitrarySpacing, noHardcodedColor, useSystemComponent };
