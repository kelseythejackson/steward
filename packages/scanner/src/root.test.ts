import { describe, expect, it } from "vitest";
import { collectContrast } from "./contrast/index.js";
import { scanFiles } from "./scan.js";

/** A repo using the old `html { font-size: 62.5% }` trick, so 1rem is 10px. */
const files = [
  { path: "src/base.css", content: `html { font-size: 62.5%; }\n.card { padding: 1.2rem; }` },
  {
    path: "src/Card.tsx",
    content: `export function Card() {
  return <div className="p-4 mt-8 bg-white"><h2 className="p-4 mt-8 text-2xl text-[#767676]">Title</h2></div>;
}`,
  },
];

describe("a root font size other than 16px", () => {
  const result = scanFiles(files);

  it("measures Tailwind keys and rem against it", () => {
    // p-4 is 1rem = 10px, mt-8 is 2rem = 20px, 1.2rem is 12px.
    expect(result.spacing.rootPx).toBe(10);
    expect(result.spacing.values.map((v) => [v.px, v.uses])).toEqual([[10, 2], [12, 1], [20, 2]]);
  });

  it("still recognises Tailwind's values and names tokens with Tailwind's numbers", () => {
    expect(result.spacingSuggestions.scale).toEqual([10, 20]);
    expect(result.spacingSuggestions.tokens.map((t) => t.path)).toEqual(["spacing.4", "spacing.8"]);
  });

  it("doesn't treat text-2xl as large text when it renders at 15px", () => {
    // #767676 on white is 4.54:1: it passes as normal text either way, so check the use, not the verdict.
    const pair = collectContrast(files).pairs.find((p) => p.foreground === "#767676");
    expect(pair?.use).toBe("text");
    const at16 = collectContrast([files[1]!]).pairs.find((p) => p.foreground === "#767676");
    expect(at16?.use).toBe("large-text");
  });
});
