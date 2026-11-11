import { compareStrings, suggestionId, type ComponentMergeSuggestion, type MergeDecision } from "@steward/model";
import { keptApart } from "../collections.js";
import { baseWord } from "./names.js";
import type { ComponentInfo } from "./types.js";

/** A pair is flagged when at least this many of the three signals match. */
export const MIN_SIGNALS = 2;
/** Shared class patterns (Jaccard) needed for the class signal, along with `MIN_SHARED_PATTERNS`. */
export const MIN_CLASS_OVERLAP = 0.5;
/** Pairs whose behavior differs in this many traits or more are "similar", never flagged. */
export const MAX_BEHAVIOR_DIFFERENCES = 2;

/** Generic containers count as the same root: swapping `<section>` for `<div>` is cosmetic. */
const CONTAINERS = new Set(["div", "section", "article", "aside", "main"]);
/** Roots that say little about what a component is. They only count as a signal alongside real shared styling. */
const GENERIC_ROOTS = new Set([...CONTAINERS, "span"]);
/**
 * Shared class patterns needed before the class signal or a generic root
 * (`<div>`, `<section>`) counts. Overlap between two tiny class lists
 * (`rounded p-4`) says little, so it never counts on its own.
 */
export const MIN_SHARED_PATTERNS = 3;

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

type RootMatch = "specific" | "generic" | null;

function rootPhrase(a: ComponentInfo, b: ComponentInfo, kind: Exclude<RootMatch, null>): string {
  const shared = a.rootElements.filter((t) => b.rootElements.includes(t) && t !== "fragment" && (kind === "generic" || !GENERIC_ROOTS.has(t)));
  if (kind === "specific") return `same root element (${shared.map((t) => `<${t}>`).join(", ")})`;
  const ca = a.rootElements.find((t) => CONTAINERS.has(t));
  const cb = b.rootElements.find((t) => CONTAINERS.has(t));
  if (ca && cb && ca !== cb) return `same root element (both are containers: <${ca}> and <${cb}>)`;
  return `same root element (${shared.map((t) => `<${t}>`).join(", ")})`;
}

/** What the pairwise check needs about one component, computed once. */
interface Features {
  base: string;
  roots: Set<string>;
  hasContainer: boolean;
  /** Renders only an `<svg>`: an icon. Icon sets share their shape on purpose, so they're never flagged. */
  isIcon: boolean;
  patterns: Set<string>;
  behavior: Set<string>;
}

function featuresOf(c: ComponentInfo): Features {
  return {
    base: baseWord(c.name),
    roots: new Set(c.rootElements.filter((t) => t !== "fragment")),
    hasContainer: c.rootElements.some((t) => CONTAINERS.has(t)),
    isIcon: c.rootElements.length > 0 && c.rootElements.every((t) => t === "svg"),
    patterns: new Set(c.rootClassPatterns),
    behavior: new Set(c.behavior),
  };
}

/** Shared count and Jaccard overlap of two pattern sets, without allocating. */
function overlapOf(a: Set<string>, b: Set<string>): { shared: number; overlap: number } {
  if (a.size === 0 || b.size === 0) return { shared: 0, overlap: 0 };
  let shared = 0;
  for (const p of a) if (b.has(p)) shared++;
  return { shared, overlap: shared / (a.size + b.size - shared) };
}

interface Core {
  name: boolean;
  root: RootMatch;
  classes: boolean;
  classOverlap: number;
  signals: number;
  verdict: ComponentComparison["verdict"];
}

/** The verdict for one pair, cheap enough to run on every pair in a big repo. */
function coreCompare(a: ComponentInfo, b: ComponentInfo, fa: Features, fb: Features): Core {
  const { shared, overlap: classOverlap } = overlapOf(fa.patterns, fb.patterns);
  if (fa.isIcon || fb.isIcon) return { name: false, root: null, classes: false, classOverlap, signals: 0, verdict: "different" };
  const name = a.name !== b.name && fa.base === fb.base;
  let root: RootMatch = null;
  for (const t of fa.roots) {
    if (!fb.roots.has(t)) continue;
    if (!GENERIC_ROOTS.has(t)) {
      root = "specific";
      break;
    }
    root = "generic";
  }
  if (root === null && fa.hasContainer && fb.hasContainer) root = "generic";
  if (root === "generic" && shared < MIN_SHARED_PATTERNS) root = null;
  const classes = classOverlap >= MIN_CLASS_OVERLAP && shared >= MIN_SHARED_PATTERNS;
  const signals = Number(name) + Number(root !== null) + Number(classes);
  let differences = 0;
  if (signals >= MIN_SIGNALS) {
    for (const t of fa.behavior) if (!fb.behavior.has(t)) differences++;
    for (const t of fb.behavior) if (!fa.behavior.has(t)) differences++;
  }
  const verdict = signals < MIN_SIGNALS ? "different" : differences >= MAX_BEHAVIOR_DIFFERENCES ? "similar" : "flag";
  return { name, root, classes, classOverlap, signals, verdict };
}

/** Compares two components on the three signals, then checks whether their behavior differs too much to call them duplicates. */
export function compareComponents(a: ComponentInfo, b: ComponentInfo): ComponentComparison {
  const core = coreCompare(a, b, featuresOf(a), featuresOf(b));
  const matched: Signal[] = [];
  const phrases: string[] = [];
  if (core.name) {
    matched.push("name");
    phrases.push(`similar name (both are a ${baseWord(a.name)})`);
  }
  if (core.root) {
    matched.push("root");
    phrases.push(rootPhrase(a, b, core.root));
  }
  if (core.classes) {
    matched.push("classes");
    phrases.push(`${percent(core.classOverlap)} shared class patterns`);
  }
  const behaviorDifferences = {
    a: a.behavior.filter((t) => !b.behavior.includes(t)),
    b: b.behavior.filter((t) => !a.behavior.includes(t)),
  };
  return { a, b, matched, phrases, classOverlap: core.classOverlap, behaviorDifferences, verdict: core.verdict };
}

/** Components in a rejected merge stay apart for good, even when the group would change. */
const rejectedSets = (decisions: readonly MergeDecision[]) => decisions.filter((d) => d.kind === "component" && d.status === "rejected").map((d) => d.members);

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

/** A flagged pair, strongest first: more signals, then more shared classes, then names. */
/**
 * Pure: compares every pair of components and groups likely duplicates.
 * Groups use complete linkage: every member must be flagged against every
 * other member, so A≈B and B≈C never pulls in an unrelated C.
 * Each group becomes one merge suggestion that keeps the most-used
 * component and says, for every other member, which signals matched.
 * Pairs that look alike but behave differently are listed as `similar`.
 */
export function findDuplicates(components: readonly ComponentInfo[], options: DuplicateOptions = {}): DuplicateReport {
  const decisions = options.decisions ?? [];
  const all = [...components].sort((a, b) => compareStrings(a.name, b.name) || compareStrings(a.file, b.file));
  const n = all.length;
  const features = all.map(featuresOf);
  // Members are component names, plus the file when two components share a name, so they never collide.
  const nameCount = new Map<string, number>();
  for (const c of all) nameCount.set(c.name, (nameCount.get(c.name) ?? 0) + 1);
  const labels = all.map((c) => (nameCount.get(c.name)! > 1 ? `${c.name} (${c.file})` : c.name));
  const apart = keptApart(rejectedSets(decisions));

  // Flagged pairs live in a bitset (n² bits) plus compact arrays, so memory stays small even when everything matches.
  const bits = new Uint8Array(Math.ceil((n * n) / 8));
  const at = (i: number, j: number) => (i < j ? i * n + j : j * n + i);
  const isFlagged = (i: number, j: number) => (bits[at(i, j) >> 3]! & (1 << (at(i, j) & 7))) !== 0;
  const edgeI: number[] = [];
  const edgeJ: number[] = [];
  const edgeScore: number[] = [];
  const similar: SimilarComponents[] = [];

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const core = coreCompare(all[i]!, all[j]!, features[i]!, features[j]!);
      if (core.verdict === "flag" && apart(labels[i]!, labels[j]!)) continue;
      if (core.verdict === "flag") {
        const k = at(i, j);
        bits[k >> 3]! |= 1 << (k & 7);
        edgeI.push(i);
        edgeJ.push(j);
        edgeScore.push(core.signals + core.classOverlap); // more signals first, then more shared classes
      } else if (core.verdict === "similar") {
        const c = compareComponents(all[i]!, all[j]!);
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

  // Strongest pairs merge first (ties in index order, so it's deterministic); groups join only if every cross pair is flagged.
  const order = edgeScore.map((_, e) => e).sort((x, y) => edgeScore[y]! - edgeScore[x]! || edgeI[x]! - edgeI[y]! || edgeJ[x]! - edgeJ[y]!);
  const groupOf: number[][] = all.map((_, i) => [i]);
  for (const e of order) {
    const ga = groupOf[edgeI[e]!]!;
    const gb = groupOf[edgeJ[e]!]!;
    if (ga === gb) continue;
    if (!ga.every((x) => gb.every((y) => isFlagged(x, y)))) continue;
    ga.push(...gb);
    for (const m of gb) groupOf[m] = ga;
  }
  const groups = [...new Set(groupOf)].map((g) => g.map((i) => all[i]!));
  const labelOf = new Map(all.map((c, i) => [c, labels[i]!]));

  const suggestions: ComponentMergeSuggestion[] = [];
  for (const group of groups) {
    if (group.length < 2) continue;
    const members = group.map((c) => labelOf.get(c)!).sort(compareStrings);
    const keeper = [...group].sort(byUsage)[0]!;
    const others = group.filter((c) => c !== keeper).sort((a, b) => compareStrings(a.name, b.name));

    const evidence: Record<string, number | string> = { members: group.length, keeperUsages: keeper.usages };
    const signalSentences: string[] = [];
    const checks: string[] = [];
    for (const m of others) {
      // Complete linkage guarantees every member is flagged against the keeper.
      const c = compareComponents(m, keeper);
      signalSentences.push(`${m.name}: ${c.phrases.join(", ")}.`);
      evidence[`${m.name}.signals`] = c.matched.join(", ");
      evidence[`${m.name}.classOverlap`] = Math.round(c.classOverlap * 100) / 100;
      const check = differencesToCheck(m, keeper);
      if (check) checks.push(check);
    }

    const names = others.map((c) => c.name);
    let summary = `${list(names)} ${names.length === 1 ? "looks like a duplicate" : "look like duplicates"} of ${keeper.name}. ${signalSentences.join(" ")}`;
    summary += ` ${keeper.name} is used most (${keeper.usages} ${keeper.usages === 1 ? "place" : "places"}).`;
    if (checks.length > 0) summary += ` Check before merging: ${checks.join("; ")}.`;

    suggestions.push({ id: suggestionId("component", members), kind: "component", members, proposed: { name: labelOf.get(keeper)! }, reason: { summary, evidence } });
  }

  suggestions.sort((a, b) => compareStrings(a.proposed.name, b.proposed.name) || compareStrings(a.id, b.id));
  similar.sort((a, b) => compareStrings(a.members.join(","), b.members.join(",")));
  return { suggestions, similar };
}
