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

/** A small binary min-heap. `before(a, b)` is true when `a` should come out first. */
export class MinHeap<T> {
  private items: T[] = [];
  constructor(private readonly before: (a: T, b: T) => boolean) {}

  get size(): number {
    return this.items.length;
  }

  push(item: T): void {
    const xs = this.items;
    xs.push(item);
    let i = xs.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.before(xs[i]!, xs[parent]!)) break;
      [xs[i], xs[parent]] = [xs[parent]!, xs[i]!];
      i = parent;
    }
  }

  pop(): T | undefined {
    const xs = this.items;
    if (xs.length === 0) return undefined;
    const top = xs[0]!;
    const last = xs.pop()!;
    if (xs.length > 0) {
      xs[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let best = i;
        if (l < xs.length && this.before(xs[l]!, xs[best]!)) best = l;
        if (r < xs.length && this.before(xs[r]!, xs[best]!)) best = r;
        if (best === i) break;
        [xs[i], xs[best]] = [xs[best]!, xs[i]!];
        i = best;
      }
    }
    return top;
  }
}
