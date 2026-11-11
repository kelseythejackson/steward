import { defineConfig } from "vitest/config";
import { sourceResolution } from "../../vitest.shared.ts";

export default defineConfig({
  ...sourceResolution,
  test: {
    name: "cli",
    include: ["src/**/*.test.ts"],
  },
});
