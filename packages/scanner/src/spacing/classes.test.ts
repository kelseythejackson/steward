import { describe, expect, it } from "vitest";
import { parseSpacingClass } from "./classes.js";

describe("parseSpacingClass", () => {
  it.each([
    ["p-4", "p", 16],
    ["mt-2.5", "mt", 10],
    ["gap-x-6", "gap-x", 24],
    ["space-y-2", "space-y", 8],
    ["p-[13px]", "p", 13],
    ["px-[18px]", "px", 18],
    ["p-[1rem]", "p", 16],
    ["mb-[0.5rem]", "mb", 8],
    ["-mt-2", "mt", 8],
    ["md:hover:py-[9px]", "py", 9],
    ["!p-3", "p", 12],
  ])("reads %s as %s %ipx of spacing", (cls, property, px) => {
    expect(parseSpacingClass(cls)).toEqual({ category: "spacing", property, px });
  });

  it.each([
    ["h-[42px]", "h", 42],
    ["w-4", "w", 16],
    ["min-h-[302px]", "min-h", 302],
    ["size-9", "size", 36],
  ])("reads %s as a size, not spacing", (cls, property, px) => {
    expect(parseSpacingClass(cls)).toEqual({ category: "size", property, px });
  });

  it.each([
    "p-0", "px-px", "m-auto", "w-1/2", "w-full", "h-screen", "p-[calc(1rem+2px)]", "p-[var(--gap)]",
    "w-[50%]", "p-13", "-p-4", "px-[1px]", "text-[13px]", "rounded-[4px]", "top-[7px]", "p-", "bg-[#3b82f6]",
  ])("ignores %s", (cls) => {
    expect(parseSpacingClass(cls)).toBeNull();
  });
});
