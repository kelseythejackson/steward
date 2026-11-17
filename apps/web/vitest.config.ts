import { defineConfig } from "vitest/config";
import { sourceResolution } from "../../vitest.shared.ts";

export default defineConfig({
  ...sourceResolution,
  test: {
    name: "web",
    include: ["lib/**/*.test.ts", "app/**/*.test.ts", "scripts/**/*.test.ts"],
  },
});
