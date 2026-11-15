import { defineConfig } from "vitest/config";
import { sourceResolution } from "../vitest.shared.ts";

export default defineConfig({
  ...sourceResolution,
  test: {
    name: "eval",
    include: ["src/**/*.test.ts"],
  },
});
