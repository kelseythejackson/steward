import { createHash } from "node:crypto";

/** A short fingerprint of system.json, so a save never overwrites changes made since the page loaded. */
export const versionOf = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);
