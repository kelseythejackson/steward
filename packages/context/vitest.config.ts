import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "context",
    include: ["src/**/*.test.ts"],
  },
});
