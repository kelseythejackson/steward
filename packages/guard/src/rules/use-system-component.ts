import { posix } from "node:path";
import { compareStrings } from "@steward/model";
import type { CheckContext, ComponentRef, ReplacedComponent } from "../context.js";
import type { TextEdit } from "../findings.js";
import type { ElementUse, ParsedFile, Range } from "../parse.js";
import type { Coverage, GuardRule, Hit } from "../rule.js";

const RAW_BUTTON_RULE = "no-raw-button";
/** Import sources that point into the repo, as opposed to a package like `@radix-ui/react-dialog`. */
const LOCAL_SOURCE = /^(\.|\/|~\/|@\/|src\/)/;

interface Rename {
  to: ComponentRef;
  nameRange: Range;
  closingNameRange?: Range;
}

/** `<button …>…</button>` → `<Button …>…</Button>`, everything else as written. */
function renameElement(source: string, from: string, to: string): string {
  let out = source.replace(new RegExp(`^<${from.replace(".", "\\.")}(?=[\\s/>])`), `<${to}`);
  if (out.endsWith(`</${from}>`)) out = `${out.slice(0, -(from.length + 3))}</${to}>`;
  return out;
}

/** The import a file needs for a component, relative to the file when its path is known. */
function importLineFor(file: ParsedFile, c: ComponentRef): string {
  if (file.path === undefined) return c.importLine;
  const target = c.filePath.replace(/\.[cm]?[jt]sx?$/, "").replace(/\/index$/, "");
  let rel = posix.relative(posix.dirname(file.path), target);
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return `import { ${c.name} } from "${rel}";`;
}

/** Adds the import, but only to a real file that doesn't import the component yet. */
function importEdit(file: ParsedFile, c: ComponentRef): TextEdit | null {
  if (!file.isModule || file.path === undefined || file.imports.has(c.name)) return null;
  const line = importLineFor(file, c);
  return file.importAt === 0 ? { start: 0, end: 0, text: `${line}\n` } : { start: file.importAt, end: file.importAt, text: `\n${line}` };
}

function rename(e: ElementUse, to: ComponentRef): Rename {
  const data: Rename = { to, nameRange: e.nameRange };
  if (e.closingNameRange) data.closingNameRange = e.closingNameRange;
  return data;
}

function rawButton(file: ParsedFile, e: ElementUse, button: NonNullable<CheckContext["button"]>): Hit {
  const variantHint = button.hasPrimary ? ` Add \`variant="primary"\` only if this is the page's main action.` : "";
  const importHint = file.imports.has(button.name) ? "" : ` Import it with \`${importLineFor(file, button)}\``;
  return {
    line: e.line,
    column: e.column,
    range: e.nameRange,
    found: e.openingTag,
    systemRule: RAW_BUTTON_RULE,
    message: `This is a raw \`<button>\`. Your system has a shared \`${button.name}\` for this.`,
    evidence: `<button> element; ${button.name} is the shared component that renders buttons`,
    fix: { description: `Use \`${button.name}\` from your system.${variantHint}${importHint}`, replacement: renameElement(e.source, "button", button.name) },
    data: rename(e, button),
  };
}

function replacedComponent(file: ParsedFile, e: ElementUse, r: ReplacedComponent): Hit {
  const keeper = r.keeper;
  const steps = [`Use \`<${keeper.name}>\` instead, and check the props match, since \`${e.name}\` may take different ones.`];
  if (file.imports.has(e.name)) steps.push(`Then remove the \`${e.name}\` import if nothing else uses it.`);
  if (!file.imports.has(keeper.name)) steps.push(`Import it with \`${importLineFor(file, keeper)}\``);
  const hit: Hit = {
    line: e.line,
    column: e.column,
    range: e.nameRange,
    found: e.openingTag,
    message: `This is \`${e.name}\`, which your team merged into \`${keeper.name}\`.`,
    evidence: `accepted merge of ${r.members.join(", ")} into ${keeper.name}`,
    fix: { description: steps.join(" "), replacement: renameElement(e.source, e.name, keeper.name) },
    data: rename(e, keeper),
  };
  if (r.systemRule) hit.systemRule = r.systemRule;
  return hit;
}

/**
 * Raw `<button>` elements when the system has a shared button, and
 * components a person merged away (`PrimaryBtn` when the team kept `Button`).
 * The fix renames the tag and adds the import; the props are left as written.
 */
export const useSystemComponent: GuardRule = {
  id: "use-system-component",
  description: "Use the system's shared components instead of raw elements or components that were merged away.",
  category: "component",
  severity: "warn",
  covers(ctx) {
    const out: Coverage[] = [];
    if (ctx.button) out.push({ label: "raw buttons", systemRule: RAW_BUTTON_RULE });
    const merges = [...new Set(ctx.replaced.values())].sort((a, b) => compareStrings(a.keeper.name, b.keeper.name));
    for (const m of merges) {
      const c: Coverage = { label: `components merged into \`${m.keeper.name}\`` };
      if (m.systemRule) c.systemRule = m.systemRule;
      out.push(c);
    }
    return out;
  },
  check(file, ctx) {
    const hits: Hit[] = [];
    for (const e of file.elements) {
      if (e.name === "button") {
        // The button component (and the duplicates merged into it) render the raw element on purpose.
        if (ctx.button && !(file.path !== undefined && ctx.button.files.includes(file.path))) hits.push(rawButton(file, e, ctx.button));
        continue;
      }
      const r = ctx.replaced.get(e.name);
      if (!r) continue;
      // A same-named component from a package isn't the one that was merged.
      const source = file.imports.get(e.name);
      if (source !== undefined && !LOCAL_SOURCE.test(source)) continue;
      hits.push(replacedComponent(file, e, r));
    }
    return hits;
  },
  fix(file, hit) {
    const data = hit.data as Rename;
    const edits: TextEdit[] = [{ ...data.nameRange, text: data.to.name }];
    if (data.closingNameRange) edits.push({ ...data.closingNameRange, text: data.to.name });
    const imp = importEdit(file, data.to);
    if (imp) edits.push(imp);
    return edits;
  },
};
