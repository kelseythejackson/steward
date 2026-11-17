/**
 * How to run Steward's command, for instructions in the app. Steward isn't
 * installed as a global `steward` command yet, so the only form that works
 * is through pnpm, from the Steward folder. Keep every instruction on this.
 */
export const cli = (args: string) => `pnpm steward ${args}`;
export const FROM_STEWARD = "from the Steward folder";
