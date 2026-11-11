import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scanRepo, summarizeScan } from "../scan.js";
import { listFiles, readRepoFiles } from "./walk.js";

describe("reading a repo", () => {
  let root: string;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "steward-walk-"));
    const put = async (path: string, content: string) => {
      await mkdir(join(root, path, ".."), { recursive: true });
      await writeFile(join(root, path), content);
    };
    await put("src/App.tsx", `export function App() { return <p className="text-[#111827]">hi</p>; }`);
    await put("src/vendor.min.css", `a{color:#ff0000}`);
    await put("storybook-static/main.css", `a { color: #00ff00; }`);
    await put(".vercel/output/x.css", `a { color: #0000ff; }`);
    await put("src/generated/huge.ts", `export const big = "${"x".repeat(1024 * 1024)}";`);
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("skips build output, caches and minified files", async () => {
    expect(await listFiles(root, () => true)).toEqual(["src/App.tsx", "src/generated/huge.ts"]);
  });

  it("skips files over the size limit and says why", async () => {
    const r = await readRepoFiles(root, ["src/App.tsx", "src/generated/huge.ts"]);
    expect(r.files.map((f) => f.path)).toEqual(["src/App.tsx"]);
    expect(r.skipped).toEqual([{ file: "src/generated/huge.ts", reason: expect.stringMatching(/^larger than 1 MB \(1\.0 MB\), so probably generated$/) }]);
  });

  it("reports skipped big files in the scan summary", async () => {
    const s = summarizeScan(await scanRepo(root));
    expect(s.tooLarge).toEqual(["src/generated/huge.ts"]);
    expect(s.filesScanned).toBe(1);
  });

  it("reads many files without opening them all at once", async () => {
    const paths = Array.from({ length: 500 }, () => "src/App.tsx");
    expect((await readRepoFiles(root, paths)).files).toHaveLength(500);
  });
});

describe("symlinks", () => {
  let root: string;
  let elsewhere: string;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "steward-links-"));
    elsewhere = await mkdtemp(join(tmpdir(), "steward-outside-"));
    await mkdir(join(root, "src/ui"), { recursive: true });
    await writeFile(join(root, "src/ui/Button.tsx"), `export function Button() { return <button className="text-[#111827]" />; }`);
    await writeFile(join(elsewhere, "Other.tsx"), `export function Other() { return <p className="text-[#ff0000]" />; }`);
    await symlink(join(root, "src/ui"), join(root, "src/components")); // inside the repo: same files, listed once
    await symlink(root, join(root, "src/loop")); // an ancestor: must not loop
    await symlink(elsewhere, join(root, "shared")); // outside the repo: not followed
    await symlink(join(root, "nope.tsx"), join(root, "src/broken.tsx")); // broken
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(elsewhere, { recursive: true, force: true });
  });

  it("follows links inside the repo without listing a file twice or looping", async () => {
    expect(await listFiles(root, () => true)).toEqual(["src/ui/Button.tsx"]);
  });

  it("lists links it didn't follow, and the scan reports them", async () => {
    const outside: string[] = [];
    await listFiles(root, () => true, outside);
    expect(outside).toEqual(["shared", "src/broken.tsx"]);
    const s = summarizeScan(await scanRepo(root));
    expect(s.linksOutside).toEqual(["shared", "src/broken.tsx"]);
    expect(s.colors.found).toBe(1); // #ff0000 from outside the repo isn't scanned
  });
});
