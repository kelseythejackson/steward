import { describe, expect, it } from "vitest";
import { extractScriptSpacing } from "./script.js";

describe("extractScriptSpacing", () => {
  it("finds classes in className, cn() calls and class maps, at their own line", () => {
    const code = `const sizes = {
  sm: "px-3 py-[9px]",
  lg: "px-[18px]",
};
export function A({ size, on }: { size: "sm" | "lg"; on: boolean }) {
  return <div className={cn("p-4 gap-[10px]", on && "mt-[7px]", sizes[size])} />;
}`;
    expect(extractScriptSpacing(code, "a.tsx").map((f) => [f.line, f.raw, f.px])).toEqual([
      [2, "px-3", 12],
      [2, "py-[9px]", 9],
      [3, "px-[18px]", 18],
      [6, "p-4", 16],
      [6, "gap-[10px]", 10],
      [6, "mt-[7px]", 7],
    ]);
  });

  it("finds static inline styles: numbers are px", () => {
    const code = `export const A = () => <div style={{ padding: 13, marginTop: "0.5rem", width: "302px", gap: \`\${n}px\` }} />;`;
    expect(extractScriptSpacing(code, "a.tsx").map((f) => [f.raw, f.px, f.category, f.source])).toEqual([
      ["padding: 13", 13, "spacing", "inline-style"],
      ["marginTop: 0.5rem", 8, "spacing", "inline-style"],
      ["width: 302px", 302, "size", "inline-style"],
    ]);
  });

  it("skips dynamic widths like the Billing usage bar", () => {
    const code = "export const Bar = ({ pct }: { pct: number }) => <div style={{ width: `${pct}%` }} />;";
    expect(extractScriptSpacing(code, "a.tsx")).toEqual([]);
  });

  it("ignores partial classes in templates and words that only look like classes", () => {
    const code = "const a = `p-${n} mt-[7px]`; const b = 'Step p-4: done';";
    expect(extractScriptSpacing(code, "a.ts").map((f) => f.raw)).toEqual(["mt-[7px]"]);
  });

  it("reads nothing from a Tailwind config", () => {
    expect(extractScriptSpacing(`export default { theme: { extend: { spacing: { 13: "13px" } } }, safelist: ["p-4"] };`, "tailwind.config.ts")).toEqual([]);
  });
});
