import { STEWARD_EXTENSION, SYSTEM_MODEL_VERSION, type SystemModel } from "./types.js";

/** A problem with the contents of `system.json`, phrased so a person can fix it. */
export class SystemModelError extends Error {
  constructor(
    message: string,
    readonly source: string,
    readonly path?: string,
  ) {
    super(message);
    this.name = "SystemModelError";
  }
}

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec => v !== null && typeof v === "object" && !Array.isArray(v);
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");
const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

const COLOR_SPACES = new Set(["srgb", "display-p3", "oklch"]);
const DIMENSION_UNITS = new Set(["px", "rem"]);
const KINDS = new Set(["color", "spacing", "component", "contrast"]);
const CONTRAST_USES = new Set(["text", "large-text", "ui"]);
const SIDES = new Set(["foreground", "background"]);
const STATUSES = new Set(["accepted", "rejected"]);
const SEVERITIES = new Set(["warn", "error"]);
const RULE_SOURCES = new Set(["generated", "user", "learned"]);
const RULE_CATEGORIES = new Set(["color", "spacing", "component", "accessibility"]);
const TARGET_KINDS = new Set(["token", "token-group", "component", "element"]);
const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;

class Checker {
  constructor(readonly source: string) {}

  fail(path: string, problem: string): never {
    throw new SystemModelError(`${this.source} has ${problem} at \`${path}\`.`, this.source, path);
  }

  string(obj: Rec, key: string, path: string, { optional = false, nonEmpty = false } = {}): void {
    const v = obj[key];
    if (v === undefined && optional) return;
    if (typeof v !== "string") this.fail(`${path}.${key}`, "a missing or non-text value");
    if (nonEmpty && v.trim() === "") this.fail(`${path}.${key}`, "an empty value");
  }

  oneOf(obj: Rec, key: string, path: string, allowed: Set<string>): void {
    const v = obj[key];
    if (typeof v !== "string" || !allowed.has(v)) {
      this.fail(`${path}.${key}`, `a value that should be one of ${[...allowed].map((a) => `"${a}"`).join(", ")}`);
    }
  }

  stringArray(obj: Rec, key: string, path: string, minLength = 0): void {
    const v = obj[key];
    if (!isStringArray(v)) this.fail(`${path}.${key}`, "a value that should be a list of text values");
    if (v.length < minLength) this.fail(`${path}.${key}`, `a list that needs at least ${minLength} entries`);
  }

  hex(obj: Rec, key: string, path: string): void {
    const v = obj[key];
    if (typeof v !== "string" || !HEX.test(v)) this.fail(`${path}.${key}`, 'a value that should be a hex color like "#3b82f6"');
  }

  record(v: unknown, path: string, what: string): Rec {
    if (!isRecord(v)) this.fail(path, `a value that should be ${what}`);
    return v;
  }

  list(v: unknown, path: string): unknown[] {
    if (!Array.isArray(v)) this.fail(path, "a value that should be a list");
    return v;
  }

  // --- tokens ---------------------------------------------------------------

  colorValue(v: unknown, path: string): void {
    const c = this.record(v, path, "a DTCG color object ({ colorSpace, components, hex })");
    this.oneOf(c, "colorSpace", path, COLOR_SPACES);
    const comps = c["components"];
    if (!Array.isArray(comps) || comps.length !== 3 || !comps.every(isFiniteNumber)) {
      this.fail(`${path}.components`, "a value that should be a list of 3 numbers");
    }
    if (typeof c["hex"] !== "string" || !HEX.test(c["hex"])) {
      this.fail(`${path}.hex`, 'a value that should be a hex color like "#3b82f6"');
    }
    const alpha = c["alpha"];
    if (alpha !== undefined && !(isFiniteNumber(alpha) && alpha >= 0 && alpha <= 1)) {
      this.fail(`${path}.alpha`, "a value that should be a number from 0 to 1");
    }
  }

  dimensionValue(v: unknown, path: string): void {
    const d = this.record(v, path, 'a DTCG dimension object like { value: 16, unit: "px" }');
    if (!isFiniteNumber(d["value"])) this.fail(`${path}.value`, "a value that should be a number");
    this.oneOf(d, "unit", path, DIMENSION_UNITS);
  }

  token(v: unknown, path: string, expectedType?: "color" | "dimension"): void {
    const t = this.record(v, path, "a token");
    const type = t["$type"];
    if (type !== "color" && type !== "dimension") {
      this.fail(`${path}.$type`, 'a token type Steward doesn\'t support yet (it supports "color" and "dimension")');
    }
    if (expectedType && type !== expectedType) this.fail(`${path}.$type`, `a token that should be a ${expectedType}`);
    if (type === "color") this.colorValue(t["$value"], `${path}.$value`);
    else this.dimensionValue(t["$value"], `${path}.$value`);
    this.string(t, "$description", path, { optional: true });

    const exts = t["$extensions"];
    if (exts === undefined) return;
    const e = this.record(exts, `${path}.$extensions`, "an object");
    const ours = e[STEWARD_EXTENSION];
    if (ours === undefined) return;
    const extPath = `${path}.$extensions.${STEWARD_EXTENSION}`;
    const s = this.record(ours, extPath, "an object");
    const uses = s["uses"];
    if (uses !== undefined && !(Number.isInteger(uses) && (uses as number) >= 0)) {
      this.fail(`${extPath}.uses`, "a value that should be a whole number of 0 or more");
    }
    if (s["mergedFrom"] !== undefined) this.stringArray(s, "mergedFrom", extPath);
    if (s["contrastIssues"] !== undefined) this.stringArray(s, "contrastIssues", extPath);
  }

  tokenGroup(v: unknown, path: string): void {
    const g = this.record(v, path, "a group of tokens");
    for (const [name, node] of Object.entries(g)) {
      const childPath = `${path}.${name}`;
      if (name.startsWith("$")) {
        this.fail(childPath, "a group property, which Steward doesn't support yet");
      }
      if (isRecord(node) && "$value" in node) this.token(node, childPath);
      else this.tokenGroup(node, childPath);
    }
  }

  // --- everything else -----------------------------------------------------

  components(v: unknown): void {
    this.list(v, "components").forEach((item, i) => {
      const path = `components[${i}]`;
      const c = this.record(item, path, "a component entry");
      this.string(c, "name", path, { nonEmpty: true });
      this.string(c, "filePath", path, { nonEmpty: true });
      this.stringArray(c, "variants", path);
      if (c["props"] !== undefined) this.stringArray(c, "props", path);
      if (c["rootElements"] !== undefined) this.stringArray(c, "rootElements", path);
      if (c["line"] !== undefined && (!Number.isInteger(c["line"]) || (c["line"] as number) < 1)) {
        this.fail(`${path}.line`, "a value that should be a line number of 1 or more");
      }
    });
  }

  reason(v: unknown, path: string): void {
    const r = this.record(v, path, "a reason ({ summary, evidence })");
    this.string(r, "summary", path, { nonEmpty: true });
    const ev = this.record(r["evidence"], `${path}.evidence`, "an object of numbers or text");
    for (const [k, val] of Object.entries(ev)) {
      if (typeof val !== "string" && !isFiniteNumber(val)) {
        this.fail(`${path}.evidence.${k}`, "a value that should be a number or text");
      }
    }
  }

  suggestions(v: unknown): void {
    this.list(v, "suggestions").forEach((item, i) => {
      const path = `suggestions[${i}]`;
      const s = this.record(item, path, "a suggestion");
      this.string(s, "id", path, { nonEmpty: true });
      this.oneOf(s, "kind", path, KINDS);
      this.stringArray(s, "members", path, 2);
      this.reason(s["reason"], `${path}.reason`);
      const p = this.record(s["proposed"], `${path}.proposed`, "an object");
      if (s["kind"] === "contrast") {
        const pair = this.record(s["pair"], `${path}.pair`, "an object like { foreground, background, use }");
        this.hex(pair, "foreground", `${path}.pair`);
        this.hex(pair, "background", `${path}.pair`);
        this.oneOf(pair, "use", `${path}.pair`, CONTRAST_USES);
        this.oneOf(p, "replaces", `${path}.proposed`, SIDES);
        this.string(p, "path", `${path}.proposed`, { nonEmpty: true });
        this.token(p["token"], `${path}.proposed.token`, "color");
        if (!isFiniteNumber(p["ratio"]) || p["ratio"] < 1) this.fail(`${path}.proposed.ratio`, "a value that should be a contrast ratio of 1 or more");
        if (typeof p["existing"] !== "boolean") this.fail(`${path}.proposed.existing`, "a value that should be true or false");
      } else if (s["kind"] === "component") {
        this.string(p, "name", `${path}.proposed`, { nonEmpty: true });
      } else {
        this.string(p, "path", `${path}.proposed`, { nonEmpty: true });
        this.token(p["token"], `${path}.proposed.token`, s["kind"] === "color" ? "color" : "dimension");
        if (s["kind"] === "spacing" && s["locations"] !== undefined) this.locations(s["locations"], `${path}.locations`);
      }
    });
  }

  locations(v: unknown, path: string): void {
    this.list(v, path).forEach((item, i) => {
      const at = `${path}[${i}]`;
      const l = this.record(item, at, "a location ({ file, line, value })");
      this.string(l, "file", at, { nonEmpty: true });
      if (!Number.isInteger(l["line"]) || (l["line"] as number) < 1) this.fail(`${at}.line`, "a value that should be a line number of 1 or more");
      this.string(l, "value", at, { nonEmpty: true });
    });
  }

  decisions(v: unknown): void {
    this.list(v, "decisions").forEach((item, i) => {
      const path = `decisions[${i}]`;
      const d = this.record(item, path, "a merge decision");
      this.string(d, "suggestionId", path, { nonEmpty: true });
      this.oneOf(d, "kind", path, KINDS);
      this.stringArray(d, "members", path, 2);
      this.oneOf(d, "status", path, STATUSES);
      this.string(d, "decidedAt", path);
      if (Number.isNaN(Date.parse(d["decidedAt"] as string))) {
        this.fail(`${path}.decidedAt`, "a value that should be an ISO date like 2026-11-08T12:00:00.000Z");
      }
    });
  }

  rules(v: unknown): void {
    const ids = new Set<string>();
    this.list(v, "rules").forEach((item, i) => {
      const path = `rules[${i}]`;
      const r = this.record(item, path, "a rule");
      this.string(r, "id", path, { nonEmpty: true });
      if (ids.has(r["id"] as string)) this.fail(`${path}.id`, `a second rule with the id "${r["id"] as string}"`);
      ids.add(r["id"] as string);
      this.string(r, "text", path, { nonEmpty: true });
      this.oneOf(r, "category", path, RULE_CATEGORIES);
      this.list(r["appliesTo"], `${path}.appliesTo`).forEach((t, j) => {
        const at = `${path}.appliesTo[${j}]`;
        const target = this.record(t, at, 'a target like { kind: "component", name: "Button" }');
        this.oneOf(target, "kind", at, TARGET_KINDS);
        const key = target["kind"] === "token" || target["kind"] === "token-group" ? "path" : "name";
        this.string(target, key, at, { nonEmpty: true });
      });
      const ex = this.record(r["examples"], `${path}.examples`, "an object like { right, wrong }");
      this.string(ex, "right", `${path}.examples`, { nonEmpty: true });
      this.string(ex, "wrong", `${path}.examples`, { nonEmpty: true });
      this.oneOf(r, "source", path, RULE_SOURCES);
      if (r["basedOn"] !== undefined) this.stringArray(r, "basedOn", path);
      this.oneOf(r, "severity", path, SEVERITIES);
      if (typeof r["enabled"] !== "boolean") this.fail(`${path}.enabled`, "a value that should be true or false");
    });
  }
}

/**
 * Parses and checks the contents of `system.json`. Unknown extra fields are
 * kept as they are, so other tools' data survives a read and write.
 */
export function parseSystemModel(text: string, source = ".steward/system.json"): SystemModel {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new SystemModelError(`${source} isn't valid JSON (${detail}).`, source);
  }

  const check = new Checker(source);
  const root = check.record(data, "(top level)", "an object");
  if (root["version"] !== SYSTEM_MODEL_VERSION) {
    throw new SystemModelError(
      `${source} uses format version ${JSON.stringify(root["version"])}. This version of Steward reads version ${SYSTEM_MODEL_VERSION}.`,
      source,
      "version",
    );
  }
  check.tokenGroup(root["tokens"], "tokens");
  check.components(root["components"]);
  check.suggestions(root["suggestions"]);
  check.decisions(root["decisions"]);
  check.rules(root["rules"]);

  return root as unknown as SystemModel;
}
