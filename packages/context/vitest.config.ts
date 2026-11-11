import { defineConfig } from "vitest/config";
import { sourceResolution } from "../../vitest.shared.ts";

export default defineConfig({
  ...sourceResolution,
  test: {
    name: "context",
    include: ["src/**/*.test.ts"],
  },
});
