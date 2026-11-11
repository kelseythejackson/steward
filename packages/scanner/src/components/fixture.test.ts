import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { extractComponents, findDuplicates, type ComponentInventory, type DuplicateReport } from "./index.js";

const FIXTURE = fileURLToPath(new URL("../../../../fixtures/messy-app", import.meta.url));

describe("components on fixtures/messy-app", () => {
  let inv: ComponentInventory;
  let report: DuplicateReport;
  beforeAll(async () => {
    inv = await extractComponents(FIXTURE);
    report = findDuplicates(inv.components);
  });

  it("lists every component with its file, root element and usage", () => {
    expect(inv.skipped).toEqual([]);
    expect(inv.components.map((c) => [c.name, c.file, c.rootElements.join("|"), c.usages])).toEqual([
      ["App", "src/App.tsx", "div", 1],
      ["Billing", "src/pages/Billing.tsx", "div", 1],
      ["Button", "src/components/Button.tsx", "button", 4],
      ["CTAButton", "src/components/CTAButton.tsx", "a|button", 2],
      ["Card", "src/components/Card.tsx", "section", 3],
      ["Dashboard", "src/pages/Dashboard.tsx", "div", 1],
      ["Dialog", "src/components/Dialog.tsx", "div", 1],
      ["Modal", "src/components/Modal.tsx", "div", 1],
      ["Navbar", "src/components/Navbar.tsx", "header", 1],
      ["Panel", "src/components/Panel.tsx", "div", 5],
      ["PrimaryBtn", "src/components/PrimaryBtn.tsx", "button", 1],
      ["Settings", "src/pages/Settings.tsx", "div", 1],
      ["TextField", "src/components/TextField.tsx", "div", 2],
    ]);
  });

  it("reads props and variants", () => {
    const button = inv.components.find((c) => c.name === "Button")!;
    expect(button).toMatchObject({ props: ["children", "className", "variant"], spreadsRest: true, variants: ["ghost", "primary", "secondary"] });
    expect(inv.components.find((c) => c.name === "PrimaryBtn")?.props).toEqual(["children", "disabled", "fullWidth", "label", "onClick"]);
  });

  it("flags the three buttons and Card/Panel, as FIXTURE_NOTES §3 expects", () => {
    expect(report.suggestions.map((s) => [s.proposed.name, s.members])).toEqual([
      ["Button", ["Button", "CTAButton", "PrimaryBtn"]],
      ["Panel", ["Card", "Panel"]],
    ]);
    expect(report.suggestions[0]!.reason.summary).toContain("PrimaryBtn: similar name (both are a button), same root element (<button>).");
    expect(report.suggestions[1]!.reason.summary).toContain("Card: same root element (both are containers: <section> and <div>), 100% shared class patterns.");
  });

  it("does not flag Modal and Dialog, and says why", () => {
    expect(report.suggestions.flatMap((s) => s.members)).not.toContain("Modal");
    expect(report.similar.map((s) => s.members)).toEqual([["Dialog", "Modal"]]);
    expect(report.similar[0]!.reason).toContain("But they behave differently, so they aren't flagged as duplicates.");
  });
});
