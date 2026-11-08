import { describe, expect, it } from "vitest";
import { extractScriptColors } from "./script.js";

const found = (code: string, file = "src/App.tsx") =>
  extractScriptColors(code, file).map((c) => `${c.line} ${c.source} ${c.value} ${c.snippet}`);

describe("extractScriptColors", () => {
  it("finds plain className strings", () => {
    expect(found(`export const A = () => <div className="p-4 bg-[#f9fafb]" />;`)).toEqual([
      "1 tailwind-class #f9fafb bg-[#f9fafb]",
    ]);
  });

  it("finds colors in template literals, with the right line", () => {
    const code = [
      "export const A = ({ on }: { on: boolean }) => (",
      "  <div",
      "    className={`rounded ${on ? 'x' : ''}",
      "      text-[#374151]`}",
      "  />",
      ");",
    ].join("\n");
    expect(found(code)).toEqual(["4 tailwind-class #374151 text-[#374151]"]);
  });

  it("finds colors in clsx/cn calls: strings, ternaries, arrays and object keys", () => {
    const code = `
      import { cn } from "./cn";
      export const A = ({ on }: { on: boolean }) => (
        <a className={cn("a", on ? "text-[#111827]" : "text-[#6b7280]", ["bg-[#fff]"], { "ring-[#3b82f6]": on })} />
      );`;
    expect(found(code).map((s) => s.split(" ")[2])).toEqual(["#111827", "#6b7280", "#ffffff", "#3b82f6"]);
  });

  it("finds colors in class maps and variables, like Tailwind's own scanner", () => {
    const code = `const variants = { primary: "bg-[#3b82f6] hover:bg-[#2563eb]" };`;
    expect(found(code, "src/Button.ts").map((s) => s.split(" ")[2])).toEqual(["#3b82f6", "#2563eb"]);
  });

  it("finds colors in inline style objects", () => {
    const code = `export const A = () => <div style={{ color: "#9CA3AF", "border-color": \`rgb(229 231 235)\`, width: 10 }} />;`;
    expect(found(code)).toEqual([
      '1 inline-style #9ca3af color: "#9CA3AF"',
      "1 inline-style #e5e7eb border-color: `rgb(229 231 235)`",
    ]);
  });

  it("ignores bare color strings that aren't classes or inline styles", () => {
    expect(found(`const brand = "#3b82f6"; const s = { color: "#fff" };`, "src/theme.ts")).toEqual([]);
  });

  it("records Tailwind config colors as definitions", () => {
    const code = `export default { content: ["./src/**/*.{ts,tsx}"], theme: { extend: { colors: { brand: "#2563eb" } } } };`;
    expect(found(code, "tailwind.config.ts")).toEqual(['1 tailwind-config #2563eb "#2563eb"'.replace(/"/g, "")]);
  });

  it("throws on files it can't parse", () => {
    expect(() => extractScriptColors("const = ;", "src/broken.ts")).toThrow();
  });
});
