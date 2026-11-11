import { defineConfig } from "vitest/config";
import { sourceResolution } from "../../vitest.shared.ts";

export default defineConfig({
  ...sourceResolution,
  test: {
    name: "model",
    include: ["src/**/*.test.ts"],
  },
});
