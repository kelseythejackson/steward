import { suggestionId, type MergeDecision } from "@steward/model";
import { describe, expect, it } from "vitest";
import { compareComponents, findDuplicates, MIN_CLASS_OVERLAP, MIN_SIGNALS } from "./duplicates.js";
import { inventoryFile } from "./inventory.js";
import type { ComponentInfo } from "./types.js";

const one = (code: string, file: string, usages = 0): ComponentInfo => ({ ...inventoryFile(code, file)[0]!, usages });

const button = one(
  `export function Button({ variant, children, ...rest }: { variant?: string; children: any } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className="inline-flex rounded-md px-4 py-2 text-sm font-medium bg-[#3b82f6] text-white" {...rest}>{children}</button>;
}`,
  "src/Button.tsx",
  4,
);
const primary = one(
  `export const PrimaryBtn = ({ label, onClick, fullWidth }: { label?: string; onClick?: () => void; fullWidth?: boolean }) => (
  <button onClick={onClick} className="rounded-md bg-[#3a81f5] px-[18px] py-[9px] text-sm font-semibold text-white" />
);`,
  "src/PrimaryBtn.tsx",
  1,
);
const cta = one(
  `export function CTAButton({ href, size }: { href?: string; size?: string }) {
  const base = "inline-flex rounded-full bg-[#3b83f7] px-5 py-2.5 text-sm font-semibold text-white";
  if (href) return <a href={href} className={base} />;
  return <button type="button" className={base} />;
}`,
  "src/CTAButton.tsx",
  2,
);
const card = one(
  `export function Card({ title }: { title?: string }) { return <section className="rounded-lg border border-[#e5e7eb] bg-white p-6 shadow-sm" />; }`,
  "src/Card.tsx",
  3,
);
const panel = one(
  `export function Panel({ heading }: { heading?: string }) { return <div className="rounded-xl border border-[#e4e4e7] bg-white p-[13px] shadow-sm" />; }`,
  "src/Panel.tsx",
  5,
);
const modal = one(
  `export function Modal({ open, title, onClose }: { open: boolean; title: string; onClose: () => void }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; }, []);
  return <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40" onClick={onClose}><div className="rounded-lg bg-white p-6" /></div>;
}`,
  "src/Modal.tsx",
  1,
);
const dialog = one(
  `export function Dialog({ open, title, onConfirm, onCancel }: { open: boolean; title: string; onConfirm: () => void; onCancel: () => void }) {
  useEffect(() => { const t = (e: KeyboardEvent) => { if (e.key !== "Tab") return; first.focus(); }; }, []);
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"><div role="dialog" aria-modal="true" className="rounded-xl bg-white p-6" /></div>;
}`,
  "src/Dialog.tsx",
  1,
);
const page = one(`export function Billing() { return <div><h1 className="text-2xl" /></div>; }`, "src/pages/Billing.tsx");
const page2 = one(`export function Dashboard() { return <div><h1 className="text-2xl" /></div>; }`, "src/pages/Dashboard.tsx");

describe("compareComponents", () => {
  it("uses 2 of 3 signals, with class patterns counting from 50% overlap", () => {
    expect(MIN_SIGNALS).toBe(2);
    expect(MIN_CLASS_OVERLAP).toBe(0.5);
  });

  it("matches similar names and the same root element", () => {
    const c = compareComponents(button, primary);
    expect(c.matched).toEqual(expect.arrayContaining(["name", "root"]));
    expect(c.verdict).toBe("flag");
  });

  it("counts different containers (section and div) as the same root, and matches Card and Panel without similar names", () => {
    const c = compareComponents(card, panel);
    expect(c).toMatchObject({ matched: ["root", "classes"], classOverlap: 1, verdict: "flag" });
  });

  it("lists Modal and Dialog as similar but not flagged, because their behavior differs", () => {
    const c = compareComponents(modal, dialog);
    expect(c.matched).toEqual(["root", "classes"]);
    expect(c.verdict).toBe("similar");
    expect(c.behaviorDifferences).toEqual({
      a: ["handles clicks on its root <div>", "handles the Escape key"],
      b: ["handles the Tab key", "moves focus", "sets aria-modal", 'sets role="dialog"'],
    });
  });

  it("allows one behavior difference: CTAButton can render a link and is still flagged", () => {
    const c = compareComponents(button, cta);
    expect(c.behaviorDifferences).toEqual({ a: [], b: ["renders a link"] });
    expect(c.verdict).toBe("flag");
  });

  it("doesn't match two bare <div> pages on root alone", () => {
    expect(compareComponents(page, page2)).toMatchObject({ matched: ["root"], verdict: "different" });
  });
});

describe("findDuplicates", () => {
  const all = [page2, dialog, primary, card, button, modal, cta, panel, page];

  it("makes one suggestion per group, keeping the most-used component, with the signals for each member", () => {
    const r = findDuplicates(all);
    expect(r.suggestions.map((s) => [s.proposed.name, s.members])).toEqual([
      ["Button", ["Button", "CTAButton", "PrimaryBtn"]],
      ["Panel", ["Card", "Panel"]],
    ]);
    const buttons = r.suggestions[0]!;
    expect(buttons.id).toBe(suggestionId("component", ["Button", "CTAButton", "PrimaryBtn"]));
    expect(buttons.reason.summary).toMatch(/^CTAButton and PrimaryBtn look like duplicates of Button\. /);
    expect(buttons.reason.summary).toContain("PrimaryBtn: similar name (both are a button), same root element (<button>)");
    expect(buttons.reason.summary).toContain("Button is used most (4 places).");
    expect(buttons.reason.summary).toContain("Check before merging: CTAButton has props Button doesn't (href, size) and renders a link; PrimaryBtn has props Button doesn't (fullWidth, label).");
    expect(buttons.reason.evidence).toMatchObject({ "PrimaryBtn.signals": "name, root, classes", keeperUsages: 4 });
  });

  it("explains Card and Panel's signals without a name match", () => {
    const cards = findDuplicates(all).suggestions[1]!;
    expect(cards.reason.summary).toBe(
      "Card looks like a duplicate of Panel. Card: same root element (both are containers: <section> and <div>), 100% shared class patterns. " +
        "Panel is used most (5 places). Check before merging: Card has props Panel doesn't (title).",
    );
  });

  it("lists similar-but-different pairs with the reason they aren't flagged", () => {
    expect(findDuplicates(all).similar).toEqual([
      {
        members: ["Dialog", "Modal"],
        matched: ["root", "classes"],
        reason:
          "Dialog and Modal look alike: same root element (<div>) and 100% shared class patterns. But they behave differently, so they aren't flagged as duplicates. " +
          'Dialog handles the Tab key, moves focus, sets aria-modal and sets role="dialog". Modal handles clicks on its root <div> and handles the Escape key.',
      },
    ]);
  });

  it("does not re-suggest a rejected merge", () => {
    const decisions: MergeDecision[] = [
      { suggestionId: suggestionId("component", ["Card", "Panel"]), kind: "component", members: ["Panel", "Card"], status: "rejected", decidedAt: "2026-11-01T00:00:00.000Z" },
    ];
    expect(findDuplicates(all, { decisions }).suggestions.map((s) => s.proposed.name)).toEqual(["Button"]);
  });

  it("is deterministic", () => {
    expect(findDuplicates([...all].reverse())).toEqual(findDuplicates(all));
  });
});
