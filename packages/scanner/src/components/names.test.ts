import { describe, expect, it } from "vitest";
import { baseWord, nameWords } from "./names.js";

describe("nameWords", () => {
  it.each([
    ["CTAButton", ["cta", "button"]],
    ["PrimaryBtn", ["primary", "button"]],
    ["TextField", ["text", "field"]],
    ["Navbar", ["navbar"]],
    ["ConfirmDlg", ["confirm", "dialog"]],
    ["UserAvatarImg", ["user", "avatar", "image"]],
  ])("%s → %j", (name, words) => {
    expect(nameWords(name)).toEqual(words);
  });
});

describe("baseWord", () => {
  it("is the last word, which names what the thing is", () => {
    expect(["Button", "PrimaryBtn", "CTAButton"].map(baseWord)).toEqual(["button", "button", "button"]);
    expect(baseWord("Card")).not.toBe(baseWord("Panel"));
  });
});
