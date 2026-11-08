import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "model",
    include: ["src/**/*.test.ts"],
  },
});
