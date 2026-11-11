/** Appends to the list stored under `key`, creating it if needed. Mutates in place, so building a big map stays linear. */
export function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** True when `a` and `b` appear together in one keep-apart set. */
export function keptApart(keepApart: readonly (readonly string[])[]): (a: string, b: string) => boolean {
  const setsOf = new Map<string, Set<number>>();
  keepApart.forEach((set, i) => {
    for (const v of set) {
      const sets = setsOf.get(v) ?? new Set<number>();
      sets.add(i);
      setsOf.set(v, sets);
    }
  });
  return (a, b) => {
    const sa = setsOf.get(a);
    const sb = setsOf.get(b);
    if (!sa || !sb) return false;
    for (const i of sa) if (sb.has(i)) return true;
    return false;
  };
}
