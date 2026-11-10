import { compareStrings, suggestionId, type ComponentMergeSuggestion, type MergeDecision } from "@steward/model";
import { baseWord } from "./names.js";
import { patternOverlap } from "./patterns.js";
import type { ComponentInfo } from "./types.js";

/** A pair is flagged when at least this many of the three signals match. */
export const MIN_SIGNALS = 2;
/** Shared class patterns (Jaccard) needed for the class signal. */
export const MIN_CLASS_OVERLAP = 0.5;
/** Pairs whose behavior differs in this many traits or more are "similar", never flagged. */
export const MAX_BEHAVIOR_DIFFERENCES = 2;

/** Generic containers count as the same root: swapping `<section>` for `<div>` is cosmetic. */
const CONTAINERS = new Set(["div", "section", "article", "aside", "main"]);

/**
 * HTML attributes a component gets for free when it spreads `...rest` from
 * `*HTMLAttributes`. `href` isn't here: a button that takes `href` is a real API difference.
 */
const HTML_PROPS = new Set([
  "children", "className", "style", "id", "title", "role", "tabIndex", "type", "name", "value", "disabled",
  "onClick", "onChange", "onFocus", "onBlur", "onKeyDown", "onKeyUp", "onMouseEnter", "onMouseLeave", "onSubmit",
]);

export type Signal = "name" | "root" | "classes";

export interface ComponentComparison {
  a: ComponentInfo;
  b: ComponentInfo;
  matched: Signal[];
  /** Plain-English phrase for each matched signal, e.g. `same root element (<button>)`. */
  phrases: string[];
  classOverlap: number;
  /** Behavior only one side has. */
  behaviorDifferences: { a: string[]; b: string[] };
  /** `flag`: likely duplicate. `similar`: looks alike but behaves differently. `different`: not enough signals. */
  verdict: "flag" | "similar" | "different";
}

export interface SimilarComponents {
  members: string[];
  matched: Signal[];
  reason: string;
}

export interface DuplicateReport {
  suggestions: ComponentMergeSuggestion[];
  /** Pairs that look alike but behave differently, with why they aren't flagged. */
  similar: SimilarComponents[];
}

export interface DuplicateOptions {
  decisions?: readonly MergeDecision[];
}

const list = (xs: readonly string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const percent = (x: number) => `${Math.round(x * 100)}%`;

function rootMatch(a: ComponentInfo, b: ComponentInfo): string | null {
  const shared = a.rootElements.filter((t) => b.rootElements.includes(t) && t !== "fragment");
  if (shared.length > 0) return `same root element (${shared.map((t) => `<${t}>`).join(", ")})`;
  const ca = a.rootElements.find((t) => CONTAINERS.has(t));
  const cb = b.rootElements.find((t) => CONTAINERS.has(t));
  return ca && cb ? `same root element (both are containers: <${ca}> and <${cb}>)` : null;
}

/** Compares two components on the three signals, then checks whether their behavior differs too much to call them duplicates. */
export function compareComponents(a: ComponentInfo, b: ComponentInfo): ComponentComparison {
  const matched: Signal[] = [];
  const phrases: string[] = [];
  if (a.name !== b.name && baseWord(a.name) === baseWord(b.name)) {
    matched.push("name");
    phrases.push(`similar name (both are a ${baseWord(a.name)})`);
  }
  const root = rootMatch(a, b);
  if (root) {
    matched.push("root");
    phrases.push(root);
  }
  const classOverlap = patternOverlap(a.rootClassPatterns, b.rootClassPatterns);
  if (classOverlap >= MIN_CLASS_OVERLAP) {
    matched.push("classes");
    phrases.push(`${percent(classOverlap)} shared class patterns`);
  }
  const behaviorDifferences = {
    a: a.behavior.filter((t) => !b.behavior.includes(t)),
    b: b.behavior.filter((t) => !a.behavior.includes(t)),
  };
  const differences = behaviorDifferences.a.length + behaviorDifferences.b.length;
  const verdict = matched.length < MIN_SIGNALS ? "different" : differences >= MAX_BEHAVIOR_DIFFERENCES ? "similar" : "flag";
  return { a, b, matched, phrases, classOverlap, behaviorDifferences, verdict };
}

function isRejected(members: readonly string[], decisions: readonly MergeDecision[]): boolean {
  const id = suggestionId("component", members);
  const key = [...members].sort(compareStrings).join(",");
  return decisions.some(
    (d) => d.kind === "component" && d.status === "rejected" && (d.suggestionId === id || [...d.members].sort(compareStrings).join(",") === key),
  );
}

/** What a person should check before merging `member` into `keeper`. */
function differencesToCheck(member: ComponentInfo, keeper: ComponentInfo): string | null {
  const covered = keeper.spreadsRest && keeper.extendsTypes.some((t) => /HTMLAttributes/.test(t));
  const extraProps = member.props.filter((p) => !keeper.props.includes(p) && !(covered && HTML_PROPS.has(p)));
  const parts: string[] = [];
  if (extraProps.length > 0) parts.push(`has props ${keeper.name} doesn't (${extraProps.join(", ")})`);
  for (const t of member.behavior.filter((t) => !keeper.behavior.includes(t))) parts.push(t);
  const missing = keeper.behavior.filter((t) => !member.behavior.includes(t));
  if (parts.length === 0 && missing.length === 0) return null;
  let out = parts.length > 0 ? `${member.name} ${list(parts)}` : "";
  if (missing.length > 0) out += `${out ? "; " : ""}${keeper.name} ${list(missing)}, which ${member.name} doesn't`;
  return out;
}

const byUsage = (a: ComponentInfo, b: ComponentInfo) => b.usages - a.usages || compareStrings(a.name, b.name) || compareStrings(a.file, b.file);
const keyOf = (c: ComponentInfo) => `${c.file}#${c.name}`;

/**
 * Pure: compares every pair of components and groups likely duplicates.
 * Each group becomes one merge suggestion that keeps the most-used
 * component and says, for every other member, which signals matched.
 * Pairs that look alike but behave differently are listed as `similar`.
 */
export function findDuplicates(components: readonly ComponentInfo[], options: DuplicateOptions = {}): DuplicateReport {
  const decisions = options.decisions ?? [];
  const all = [...components].sort((a, b) => compareStrings(a.name, b.name) || compareStrings(a.file, b.file));

  const comparisons = new Map<string, ComponentComparison>();
  const parent = new Map(all.map((c) => [keyOf(c), keyOf(c)]));
  const find = (k: string): string => (parent.get(k) === k ? k : find(parent.get(k)!));
  const similar: SimilarComponents[] = [];

  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const c = compareComponents(all[i]!, all[j]!);
      comparisons.set(`${keyOf(c.a)}|${keyOf(c.b)}`, c);
      comparisons.set(`${keyOf(c.b)}|${keyOf(c.a)}`, { ...c, a: c.b, b: c.a, behaviorDifferences: { a: c.behaviorDifferences.b, b: c.behaviorDifferences.a } });
      if (c.verdict === "flag") parent.set(find(keyOf(c.a)), find(keyOf(c.b)));
      if (c.verdict === "similar") {
        const describe = (name: string, traits: string[]) => (traits.length > 0 ? ` ${name} ${list(traits)}.` : "");
        similar.push({
          members: [c.a.name, c.b.name],
          matched: c.matched,
          reason:
            `${c.a.name} and ${c.b.name} look alike: ${list(c.phrases)}. But they behave differently, so they aren't flagged as duplicates.` +
            describe(c.a.name, c.behaviorDifferences.a) +
            describe(c.b.name, c.behaviorDifferences.b),
        });
      }
    }
  }

  const groups = new Map<string, ComponentInfo[]>();
  for (const c of all) groups.set(find(keyOf(c)), [...(groups.get(find(keyOf(c))) ?? []), c]);

  const suggestions: ComponentMergeSuggestion[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const members = group.map((c) => c.name).sort(compareStrings);
    if (isRejected(members, decisions)) continue;
    const keeper = [...group].sort(byUsage)[0]!;
    const others = group.filter((c) => c !== keeper).sort((a, b) => compareStrings(a.name, b.name));

    const evidence: Record<string, number | string> = { members: group.length, keeperUsages: keeper.usages };
    const signalSentences: string[] = [];
    const checks: string[] = [];
    for (const m of others) {
      // Explain each member against the keeper, or against the member it was matched with.
      let c = comparisons.get(`${keyOf(m)}|${keyOf(keeper)}`)!;
      if (c.verdict !== "flag") {
        c = group.map((g) => comparisons.get(`${keyOf(m)}|${keyOf(g)}`)).find((x) => x?.verdict === "flag") ?? c;
      }
      const against = c.b.name === keeper.name ? "" : ` (matched with ${c.b.name})`;
      signalSentences.push(`${m.name}${against}: ${c.phrases.join(", ")}.`);
      evidence[`${m.name}.signals`] = c.matched.join(", ");
      evidence[`${m.name}.classOverlap`] = Math.round(c.classOverlap * 100) / 100;
      const check = differencesToCheck(m, keeper);
      if (check) checks.push(check);
    }

    const names = others.map((c) => c.name);
    let summary = `${list(names)} ${names.length === 1 ? "looks like a duplicate" : "look like duplicates"} of ${keeper.name}. ${signalSentences.join(" ")}`;
    summary += ` ${keeper.name} is used most (${keeper.usages} ${keeper.usages === 1 ? "place" : "places"}).`;
    if (checks.length > 0) summary += ` Check before merging: ${checks.join("; ")}.`;

    suggestions.push({ id: suggestionId("component", members), kind: "component", members, proposed: { name: keeper.name }, reason: { summary, evidence } });
  }

  suggestions.sort((a, b) => compareStrings(a.proposed.name, b.proposed.name) || compareStrings(a.id, b.id));
  similar.sort((a, b) => compareStrings(a.members.join(","), b.members.join(",")));
  return { suggestions, similar };
}
