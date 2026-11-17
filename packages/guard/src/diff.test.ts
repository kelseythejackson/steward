import { describe, expect, it } from "vitest";
import { diffPath, parseAddedLines } from "./diff.js";

describe("diffPath", () => {
  it("reads plain, tab-ended and C-quoted paths as git writes them", () => {
    expect(diffPath("b/src/A.tsx")).toBe("b/src/A.tsx");
    expect(diffPath("b/src/Pricing Card.tsx\t")).toBe("b/src/Pricing Card.tsx");
    expect(diffPath('"b/src/Say \\"Hi\\".tsx"')).toBe('b/src/Say "Hi".tsx');
    expect(diffPath('"b/src/back\\\\slash.tsx"')).toBe("b/src/back\\slash.tsx");
    // Octal escapes are UTF-8 bytes (when core.quotePath is on): 🎉 is F0 9F 8E 89.
    expect(diffPath('"b/src/Party \\360\\237\\216\\211.tsx"')).toBe("b/src/Party 🎉.tsx");
  });
});

describe("parseAddedLines", () => {
  it("uses the unquoted path for quoted and tab-ended names", () => {
    const diff = ['diff --git "a/Say \\"Hi\\".tsx" "b/Say \\"Hi\\".tsx"', "--- /dev/null", '+++ "b/Say \\"Hi\\".tsx"', "@@ -0,0 +1,2 @@", "+a", "+b", "+++ b/Pricing Card.tsx\t", "@@ -0,0 +1 @@", "+c"].join("\n");
    expect([...parseAddedLines(diff)].map(([p, l]) => [p, [...l]])).toEqual([
      ['Say "Hi".tsx', [1, 2]],
      ["Pricing Card.tsx", [1]],
    ]);
  });
});
