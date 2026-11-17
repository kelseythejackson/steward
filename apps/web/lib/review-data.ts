/**
 * Pure: what the Setup review screen shows, built from the system model.
 * Plain data only, so it can go from the server to the browser.
 */
import { colorTokenGroups, type DecisionStatus, type SystemModel } from "@steward/model";
import { tokenName } from "./names.ts";

export type Status = "waiting" | DecisionStatus;

export interface ColorToken {
  path: string;
  /** `gray-200`: how it's written in a class. */
  name: string;
  /** The token's own color, `#rrggbb` or `#rrggbbaa`. */
  hex: string;
  /** Every color it stands for, its own first. */
  members: string[];
}

export interface ColorMerge {
  id: string;
  status: Status;
  members: string[];
  name: string;
  hex: string;
  reason: string;
}

export interface SpacingSnap {
  id: string;
  status: Status;
  /** The step values snap to, e.g. 10. */
  step: number;
  /** The off-scale values, e.g. ["9px"]. */
  values: string[];
  places: { file: string; line: number; value: string }[];
  reason: string;
}

export interface ComponentMerge {
  id: string;
  status: Status;
  members: string[];
  keep: string;
  reason: string;
}

export interface ContrastFix {
  id: string;
  status: Status;
  foreground: string;
  background: string;
  ratio: number;
  required: number;
  fix: { name: string; hex: string; ratio: number; replaces: "foreground" | "background" };
  reason: string;
}

export interface ReviewData {
  waiting: number;
  colors: { found: string[]; tokens: ColorToken[]; merges: ColorMerge[] };
  spacing: { scale: { px: number; uses: number }[]; snaps: SpacingSnap[] };
  components: ComponentMerge[];
  contrast: ContrastFix[];
}


export function reviewData(model: SystemModel): ReviewData {
  const decisions = new Map(model.decisions.map((d) => [d.suggestionId, d]));
  const status = (id: string): Status => decisions.get(id)?.status ?? "waiting";

  // The proposed system: the tokens as they are, with each merge still waiting folded in, so the card
  // shows what accepting would make. (A merge applies to system.json only once it's accepted.)
  let groups = colorTokenGroups(model).map((g) => ({ path: g.path, members: [...g.members] }));
  for (const s of model.suggestions) {
    if (s.kind !== "color" || decisions.has(s.id)) continue;
    const into = groups.find((g) => g.path === s.proposed.path);
    if (!into) continue;
    const moving = s.members.filter((m) => !into.members.includes(m));
    groups = groups
      .map((g) => (g === into ? g : { ...g, members: g.members.filter((m) => !moving.includes(m)) }))
      .filter((g) => g.members.length > 0);
    into.members.push(...moving);
  }
  const tokens = groups.map((g) => ({ path: g.path, name: tokenName(g.path), hex: g.members[0]!, members: g.members }));
  const hexOf = (path: string) => tokens.find((t) => t.path === path)?.hex ?? "";

  const paletteFixes = new Set(model.suggestions.flatMap((s) => (s.kind === "contrast" && !s.proposed.existing ? [s.proposed.token.$value.hex] : [])));
  const colors: ColorMerge[] = [];
  const spacing: SpacingSnap[] = [];
  const components: ComponentMerge[] = [];
  const contrast: ContrastFix[] = [];
  for (const s of model.suggestions) {
    if (s.kind === "color") {
      colors.push({ id: s.id, status: status(s.id), members: s.members, name: tokenName(s.proposed.path), hex: s.proposed.token.$value.hex, reason: s.reason.summary });
    } else if (s.kind === "spacing") {
      const step = s.proposed.token.$value.value;
      spacing.push({ id: s.id, status: status(s.id), step, values: s.members.filter((m) => m !== `${step}px`), places: s.locations ?? [], reason: s.reason.summary });
    } else if (s.kind === "component") {
      components.push({ id: s.id, status: status(s.id), members: s.members, keep: decisions.get(s.id)?.keep ?? s.proposed.name, reason: s.reason.summary });
    } else if (s.kind === "contrast") {
      const e = s.reason.evidence;
      contrast.push({
        id: s.id,
        status: status(s.id),
        foreground: s.pair.foreground,
        background: s.pair.background,
        ratio: Number(e["ratio"]),
        required: Number(e["required"]),
        fix: { name: tokenName(s.proposed.path), hex: s.proposed.token.$value.hex, ratio: s.proposed.ratio, replaces: s.proposed.replaces },
        reason: s.reason.summary,
      });
    }
  }

  const scale: { px: number; uses: number }[] = [];
  const spacingGroup = model.tokens["spacing"];
  if (spacingGroup && typeof spacingGroup === "object") {
    for (const [k, v] of Object.entries(spacingGroup)) {
      if (k.startsWith("$") || !v || typeof v !== "object" || !("$value" in v) || v.$type !== "dimension") continue;
      scale.push({ px: v.$value.value, uses: v.$extensions?.["dev.steward"]?.uses ?? 0 });
    }
  }

  return {
    waiting: [...colors, ...spacing, ...components, ...contrast].filter((x) => x.status === "waiting").length,
    // "Found in code" leaves out contrast fixes from Tailwind's palette: an accepted one is a token before any code uses it.
    colors: { found: [...new Set(tokens.flatMap((t) => t.members))].filter((hex) => !paletteFixes.has(hex)), tokens, merges: colors },
    spacing: { scale: scale.sort((a, b) => a.px - b.px), snaps: spacing.sort((a, b) => a.step - b.step) },
    components,
    contrast,
  };
}

export { nameForMovedColor, tokenName } from "./names.ts";
