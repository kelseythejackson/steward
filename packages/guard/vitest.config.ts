import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "guard",
    include: ["src/**/*.test.ts"],
  },
});
