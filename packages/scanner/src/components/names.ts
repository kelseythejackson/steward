/** Common abbreviations in component names, expanded so `PrimaryBtn` and `Button` share a word. */
const ABBREVIATIONS: Readonly<Record<string, string>> = {
  btn: "button",
  dlg: "dialog",
  img: "image",
  txt: "text",
};

/** `CTAButton` → `["cta", "button"]`, `PrimaryBtn` → `["primary", "button"]`. */
export function nameWords(name: string): string[] {
  const words = name.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|\d+/g) ?? [name];
  return words.map((w) => w.toLowerCase()).map((w) => ABBREVIATIONS[w] ?? w);
}

/** The last word names what the thing is: `CTAButton` and `PrimaryBtn` are both a `button`. */
export function baseWord(name: string): string {
  const words = nameWords(name);
  return words[words.length - 1]!;
}
