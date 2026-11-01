/** Relation validation reads membership only; preserve an equivalent published index. */
export function reuseEquivalentRelationIndexes(previous, next) {
  if (previous === next) return previous;
  const keys = Object.keys(next);
  if (keys.length !== Object.keys(previous).length) return next;
  for (const key of keys) {
    if (!Object.hasOwn(previous, key)) return next;
    const a = previous[key], b = next[key];
    if (a === b) continue;
    if (!(a instanceof Set) || !(b instanceof Set) || a.size !== b.size) return next;
    for (const value of b) if (!a.has(value)) return next;
  }
  return previous;
}
