import { describe, expect, it } from "vitest";
import { collectComponents, inventoryFile } from "./inventory.js";

const BUTTON = `import type { ButtonHTMLAttributes, ReactNode } from "react";
type Variant = "primary" | "ghost";
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  children: ReactNode;
}
const variants: Record<Variant, string> = { primary: "bg-[#3b82f6] text-white", ghost: "bg-transparent" };
export function Button({ variant = "primary", className = "", children, ...rest }: ButtonProps) {
  return <button type="button" className={\`rounded-md px-4 \${variants[variant]} \${className}\`} {...rest}>{children}</button>;
}`;

describe("inventoryFile", () => {
  it("lists a component with its props, variants, root element and root class patterns", () => {
    const [c] = inventoryFile(BUTTON, "src/Button.tsx");
    expect(c).toMatchObject({
      name: "Button",
      file: "src/Button.tsx",
      line: 8,
      exported: true,
      props: ["children", "className", "variant"],
      spreadsRest: true,
      extendsTypes: ["ButtonHTMLAttributes<HTMLButtonElement>"],
      variants: ["ghost", "primary"],
      rootElements: ["button"],
      rootClassPatterns: ["bg-color", "px", "rounded", "text-color"],
      behavior: [],
    });
  });

  it("finds every possible root, skipping null and nested functions", () => {
    const code = `export const CTA = ({ href }: { href?: string }) => {
  const icon = () => <svg />;
  if (!href) return null;
  return href.length ? <a href={href} className="rounded-full" /> : <button className="rounded-full" />;
};`;
    const [c] = inventoryFile(code, "a.tsx");
    expect(c).toMatchObject({ name: "CTA", props: ["href"], rootElements: ["a", "button"], behavior: ["renders a link"] });
  });

  it("reads behavior: roles, aria-modal, focus, keys and root clicks", () => {
    const code = `export function M({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); if (e.key !== "Tab") return; ref.current?.focus(); };
  }, []);
  return <div onClick={onClose} className="fixed inset-0"><div role="dialog" aria-modal="true" /></div>;
}`;
    expect(inventoryFile(code, "m.tsx")[0]?.behavior).toEqual([
      "handles clicks on its root <div>",
      "handles the Escape key",
      "handles the Tab key",
      "moves focus",
      'sets aria-modal',
      'sets role="dialog"',
    ]);
  });

  it("reads props from a props identifier and an inline type, and unwraps memo/forwardRef", () => {
    const code = `type P = { title: string; onSave(): void };
const Plain = (props: P) => <div>{props.title}</div>;
export const Wrapped = memo(function Wrapped({ a }: { a: number }) { return <span>{a}</span>; });`;
    expect(inventoryFile(code, "p.tsx").map((c) => [c.name, c.props, c.exported, c.rootElements])).toEqual([
      ["Plain", ["onSave", "title"], false, ["div"]],
      ["Wrapped", ["a"], true, ["span"]],
    ]);
  });

  it("records a component root and a fragment", () => {
    const code = `export const A = () => <Card title="x" />;\nexport const B = () => <><p /></>;`;
    expect(inventoryFile(code, "a.tsx").map((c) => c.rootElements)).toEqual([["Card"], ["fragment"]]);
  });

  it("ignores lowercase functions and functions that don't return JSX", () => {
    expect(inventoryFile(`export function helper() { return <div />; }\nexport function Thing() { return 1; }`, "a.tsx")).toEqual([]);
  });
});

describe("collectComponents", () => {
  it("counts where each component is rendered and lists unparsable files", () => {
    const r = collectComponents([
      { path: "src/Button.tsx", content: BUTTON },
      { path: "src/Page.tsx", content: `export const Page = () => <div><Button /><Button variant="ghost" /></div>;` },
      { path: "src/Bad.tsx", content: "export const = <" },
      { path: "src/styles.css", content: ".a{}" },
    ]);
    expect(r.components.map((c) => [c.name, c.usages])).toEqual([["Button", 2], ["Page", 0]]);
    expect(r.skipped).toEqual([{ file: "src/Bad.tsx", reason: expect.any(String) }]);
    expect(r.filesScanned).toBe(3);
  });
});
