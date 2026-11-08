import { describe, expect, it } from "vitest";
import { PACKAGE_NAME } from "./index.js";

describe("@steward/context", () => {
  it("exports its package name", () => {
    expect(PACKAGE_NAME).toBe("@steward/context");
  });
});
