type ClassDictionary = Record<string, boolean | null | undefined>;
type ClassValue = string | false | null | undefined | ClassDictionary;

/** Tiny clsx-style helper, copied from a blog post. Joins truthy class names. */
export function cn(...inputs: ClassValue[]): string {
  const out: string[] = [];
  for (const input of inputs) {
    if (!input) continue;
    if (typeof input === "string") out.push(input);
    else for (const [name, on] of Object.entries(input)) if (on) out.push(name);
  }
  return out.join(" ");
}
