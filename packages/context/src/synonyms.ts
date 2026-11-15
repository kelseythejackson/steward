/**
 * Everyday words people (and AI tools) use for UI pieces, mapped to the words
 * that tend to appear in component names. `find_component` uses these to
 * widen a description like "primary call to action" to "button".
 *
 * Plain keyword matching, no AI. Add a line here to teach it a new word;
 * phrases match whole words only.
 */
export interface Synonym {
  /** Words or phrases someone might write. */
  when: readonly string[];
  /** What they usually mean in a component name. */
  means: readonly string[];
}

export const SYNONYMS: readonly Synonym[] = [
  { when: ["cta", "call to action", "action", "click", "submit", "btn", "press"], means: ["button"] },
  { when: ["popup", "pop up", "overlay", "lightbox", "confirm", "confirmation", "alert", "prompt"], means: ["dialog", "modal"] },
  { when: ["dialog", "dialogue"], means: ["modal"] },
  { when: ["modal"], means: ["dialog"] },
  { when: ["card", "box", "container", "section", "tile", "surface", "wrapper"], means: ["panel", "card"] },
  { when: ["input", "field", "text box", "textbox", "form", "entry", "type in"], means: ["textfield", "field", "input"] },
  { when: ["nav", "navigation", "menu", "header", "top bar", "topbar", "app bar"], means: ["navbar", "nav", "header"] },
];

/** Words too common to tell components apart. */
export const STOPWORDS: ReadonlySet<string> = new Set(
  "a an and any are as at be for from give i in is it me my need of on or our show some that the this to use want we with".split(" "),
);
