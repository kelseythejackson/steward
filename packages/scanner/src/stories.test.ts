import { describe, expect, it } from "vitest";
import { describeScan } from "./report.js";
import { isStoryOrTest, scanFiles, summarizeScan } from "./scan.js";

const button = `export function Button({ children }: { children: string }) {
  return <button className="rounded px-4 py-2 text-[#111827] bg-white mt-4">{children}</button>;
}`;
const page = `import { Button } from "./Button";
export function Page() { return <div className="p-4 mt-8"><Button>Save</Button></div>; }`;
const story = `import { Button } from "./Button";
export const Primary = () => <div className="p-[7px] text-[#ff0000] bg-[#111827]"><Button>A</Button><Button>B</Button><Button>C</Button></div>;`;

const files = [
  { path: "src/Button.tsx", content: button },
  { path: "src/Page.tsx", content: page },
  { path: "src/Button.stories.tsx", content: story },
  { path: "src/__tests__/Page.tsx", content: `export function Fake() { return <p className="text-[#00ff00]">x</p>; }` },
];

describe("isStoryOrTest", () => {
  it("matches stories, tests, specs and their folders", () => {
    for (const p of ["src/Button.stories.tsx", "a/b.story.ts", "src/x.test.ts", "src/x.spec.tsx", "src/__tests__/a.tsx", ".storybook/preview.tsx", "src/__stories__/a.tsx"]) {
      expect(isStoryOrTest(p), p).toBe(true);
    }
    for (const p of ["src/Button.tsx", "src/latest.tsx", "src/contest/Entry.tsx", "src/Spec.tsx"]) expect(isStoryOrTest(p), p).toBe(false);
  });
});

describe("stories and tests stay out of the system", () => {
  const result = scanFiles(files);

  it("doesn't let them shape colors, the scale or components", () => {
    expect(result.files).toEqual(["src/Button.tsx", "src/Page.tsx"]);
    expect(result.colors.colors.map((c) => c.value)).not.toContain("#ff0000");
    expect(result.spacing.values.map((v) => v.px)).not.toContain(7);
    expect(result.components.components.map((c) => c.name)).toEqual(["Button", "Page"]);
  });

  it("doesn't count renders inside stories as usage", () => {
    expect(result.components.components.find((c) => c.name === "Button")?.usages).toBe(1);
  });

  it("still says what in them isn't in the system", () => {
    expect(result.storiesAndTests.files).toEqual(["src/Button.stories.tsx", "src/__tests__/Page.tsx"]);
    expect(result.storiesAndTests.offSystemColors).toEqual(["#00ff00", "#ff0000"]); // #111827 is a token, so it's fine
    expect(result.storiesAndTests.offScaleSpacing).toEqual([7]);
    expect(describeScan(summarizeScan(result))).toContain("Stories and tests: 2 files, kept out of your system; 2 colors and 1 spacing value in them aren't in it");
  });

  it("says when everything in them matches", () => {
    const clean = scanFiles([files[0]!, files[1]!, { path: "src/Button.stories.tsx", content: `export const S = () => <p className="text-[#111827]">x</p>;` }]);
    expect(describeScan(summarizeScan(clean))).toContain("Stories and tests: 1 file, kept out of your system; everything in them matches it");
  });
});
