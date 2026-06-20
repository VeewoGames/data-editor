/**
 * @param {{
 *   rows: Array<Record<string, unknown>>;
  *   fieldName: string;
  *   value: unknown;
  *   excludeRowIndex?: number | null;
 * }} input
 */
export function resolveAutoSuffixedPrimaryKeyValue({
  rows,
  fieldName,
  value,
  excludeRowIndex = null,
}) {
  if (!fieldName) {
    return { value, adjusted: false };
  }
  const originalValue =
    typeof excludeRowIndex === "number" && excludeRowIndex >= 0
      ? rows[excludeRowIndex]?.[fieldName]
      : undefined;
  if (originalValue === value) {
    return { value, adjusted: false };
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const taken = new Set(
      rows.flatMap((row) => {
        const candidate = row?.[fieldName];
        return typeof candidate === "number" && Number.isFinite(candidate) ? [candidate] : [];
      }),
    );
    if (!taken.has(value)) {
      return { value, adjusted: false };
    }
    let nextValue = value + 1;
    while (taken.has(nextValue)) nextValue += 1;
    return { value: nextValue, adjusted: true };
  }
  if (typeof value !== "string" || value === "") {
    return { value, adjusted: false };
  }
  const taken = new Set(
    rows.flatMap((row, rowIndex) => {
      if (rowIndex === excludeRowIndex) return [];
      const candidate = row?.[fieldName];
      return typeof candidate === "string" && candidate !== "" ? [candidate] : [];
    }),
  );
  if (!taken.has(value)) {
    return { value, adjusted: false };
  }
  let suffix = 1;
  let nextValue = `${value}_${suffix}`;
  while (taken.has(nextValue)) {
    suffix += 1;
    nextValue = `${value}_${suffix}`;
  }
  return { value: nextValue, adjusted: true };
}
