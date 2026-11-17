/** Writes app/steward-theme.css from the fixture's system: Steward uses its own product. */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseSystemModel } from "@steward/model";
import { themeCss } from "../lib/theme.ts";

export const THEME_SOURCE = "fixtures/messy-app/.steward/system.json";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const out = fileURLToPath(new URL("../app/steward-theme.css", import.meta.url));

const model = parseSystemModel(await readFile(`${root}${THEME_SOURCE}`, "utf8"), THEME_SOURCE);
await writeFile(out, themeCss(model, THEME_SOURCE));
console.log(`Wrote app/steward-theme.css from ${THEME_SOURCE}`);
