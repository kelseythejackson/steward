import { describe, expect, it } from "vitest";
import { collectColors } from "./colors/collect.js";
import { colorFamily } from "./colors/naming.js";
import { findColors } from "./colors/normalize.js";
import { parseClassList } from "./contrast/classes.js";
import { collectContrast } from "./contrast/index.js";
import { TAILWIND_V4_PALETTE } from "./contrast/palette-v4.js";
import { collectSpacing } from "./spacing/collect.js";
import { parseSpacingClass } from "./spacing/classes.js";
import { cssVariableDeclarations, resolveCssColor, tailwindSetup, tailwindVersion } from "./tailwind.js";

/** shadcn/ui on Tailwind 3: bare HSL channels in CSS, `hsl(var(--x))` in the config. */
const shadcnV3 = [
  {
    path: "src/globals.css",
    content: `@tailwind base;
@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    --primary: 222.2 47.4% 11.2%;
    --muted-foreground: 215.4 16.3% 46.9%;
  }
  .dark {
    --background: 222.2 84% 4.9%;
    --foreground: 210 40% 98%;
  }
}`,
  },
  {
    path: "tailwind.config.ts",
    content: `export default { theme: { extend: { colors: {
  background: "hsl(var(--background))",
  foreground: "hsl(var(--foreground))",
  primary: { DEFAULT: "hsl(var(--primary))" },
  muted: { foreground: "hsl(var(--muted-foreground) / <alpha-value>)" },
} } } };`,
  },
  { path: "src/Card.tsx", content: `export function Card() { return <div className="bg-background text-muted-foreground">Hi</div>; }` },
];

/** shadcn/ui on Tailwind 4: OKLCH variables, mapped to theme names in `@theme inline`. */
const shadcnV4 = [
  {
    path: "src/app.css",
    content: `@import "tailwindcss";
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-brand: oklch(0.62 0.19 259);
}
:root {
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
}
.dark {
  --background: oklch(0.145 0 0);
}`,
  },
  { path: "src/Hero.tsx", content: `export function Hero() { return <p className="bg-background text-foreground p-13 mt-4.5">Hi <span className="text-gray-400 bg-brand">x</span></p>; }` },
];

describe("tailwindVersion", () => {
  it("is 4 when a stylesheet imports tailwindcss or uses @theme, otherwise 3", () => {
    expect(tailwindVersion(shadcnV4)).toBe(4);
    expect(tailwindVersion(shadcnV3)).toBe(3);
    expect(tailwindVersion([{ path: "a.css", content: `/* @import "tailwindcss"; */ body {}` }])).toBe(3);
  });
});

describe("resolveCssColor", () => {
  const vars = { "--primary": "222.2 47.4% 11.2%", "--brand": "oklch(0.62 0.19 259)", "--alias": "var(--brand)", "--loop": "var(--loop)" };

  it("reads bare HSL channels, var() chains, fallbacks and <alpha-value>", () => {
    expect(resolveCssColor("hsl(var(--primary))", vars)).toBe("#0f172a");
    expect(resolveCssColor("var(--primary)", vars)).toBe("#0f172a");
    expect(resolveCssColor("hsl(var(--primary) / 0.5)", vars)).toBe("#0f172a80");
    expect(resolveCssColor("hsl(var(--primary) / <alpha-value>)", vars)).toBe("#0f172a");
    expect(resolveCssColor("var(--alias)", vars)).toBe(resolveCssColor("oklch(0.62 0.19 259)", {}));
    expect(resolveCssColor("var(--missing, #fff)", vars)).toBe("#ffffff");
  });

  it("returns null for missing variables, cycles and non-colors", () => {
    expect(resolveCssColor("var(--missing)", vars)).toBeNull();
    expect(resolveCssColor("var(--loop)", vars)).toBeNull();
    expect(resolveCssColor("1px solid", vars)).toBeNull();
  });
});

describe("cssVariableDeclarations", () => {
  it("keeps light values and skips dark-mode overrides", () => {
    const vars = cssVariableDeclarations(shadcnV3[0]!.content);
    expect(vars["--background"]).toBe("0 0% 100%");
    expect(vars["--foreground"]).toBe("222.2 84% 4.9%");
  });
});

describe("tailwindSetup", () => {
  it("resolves shadcn/ui theme names on Tailwind 3", () => {
    const { version, theme } = tailwindSetup(shadcnV3);
    expect(version).toBe(3);
    expect(theme).toMatchObject({ background: "#ffffff", foreground: "#020817", primary: "#0f172a", "muted-foreground": "#64748b" });
  });

  it("resolves @theme names and uses the v4 palette on Tailwind 4", () => {
    const { version, theme } = tailwindSetup(shadcnV4);
    expect(version).toBe(4);
    expect(theme).toMatchObject({ background: "#ffffff", foreground: "#0a0a0a", "gray-400": TAILWIND_V4_PALETTE["gray-400"] });
    expect(theme.brand).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("shadcn/ui and Tailwind 4 end to end", () => {
  it("counts theme-name classes as uses and CSS variables as definitions", () => {
    const r = collectColors(shadcnV3);
    const by = Object.fromEntries(r.colors.map((c) => [c.value, c]));
    expect(by["#ffffff"]).toMatchObject({ uses: 1 }); // bg-background
    expect(by["#64748b"]).toMatchObject({ uses: 1 }); // text-muted-foreground
    expect(by["#0f172a"]?.definitions.map((d) => d.source)).toEqual(["css-variable"]);
    expect(by["#0f172a"]?.uses).toBe(0);
  });

  it("checks contrast for shadcn names instead of skipping them", () => {
    const r = collectContrast(shadcnV3);
    expect(r.pairs.map((p) => `${p.foreground} on ${p.background}`)).toEqual(["#64748b on #ffffff"]);
    expect(r.skipped).toEqual([]);
  });

  it("reads v4 palette colors, @theme names and v4 spacing keys", () => {
    const colors = collectColors(shadcnV4).colors.filter((c) => c.uses > 0).map((c) => c.value);
    expect(colors).toContain(TAILWIND_V4_PALETTE["gray-400"]);
    expect(colors).not.toContain("#9ca3af"); // the v3 gray-400
    expect(collectSpacing(shadcnV4).values.map((v) => v.px)).toEqual([18, 52]);
  });
});

describe("Tailwind 4 details", () => {
  it("finds modern color functions in CSS values and arbitrary classes", () => {
    expect(findColors("color: oklch(0.62 0.19 259); background: lab(50% 40 59); border-color: hwb(200 10% 20%)").map((c) => c.raw)).toEqual([
      "oklch(0.62 0.19 259)",
      "lab(50% 40 59)",
      "hwb(200 10% 20%)",
    ]);
  });

  it("reads any multiple of 0.25 as a spacing key on v4 only", () => {
    expect(parseSpacingClass("p-13", 4)).toMatchObject({ px: 52 });
    expect(parseSpacingClass("mt-4.5", 4)).toMatchObject({ px: 18 });
    expect(parseSpacingClass("p-13", 3)).toBeNull();
    expect(parseSpacingClass("p-4.3", 4)).toBeNull();
  });

  it("treats outline-hidden as removing the focus outline", () => {
    expect(parseClassList("outline-hidden")).toMatchObject({ removesOutline: true, outlineClass: "outline-hidden" });
  });

  it("puts every v4 palette color in the right family", () => {
    const grayFamilies = new Set(["slate", "gray", "zinc", "neutral", "stone"]);
    const wrong = Object.entries(TAILWIND_V4_PALETTE)
      .filter(([name]) => /^[a-z]+-\d+$/.test(name))
      .filter(([name, hex]) => grayFamilies.has(name.split("-")[0]!) !== (colorFamily(hex) === "gray"))
      .map(([name]) => name);
    expect(wrong).toEqual([]);
  });
});
