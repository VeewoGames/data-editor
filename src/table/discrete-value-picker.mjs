export function resolveDefaultCandidate({ filteredOptions, selectedValues, mode }) {
  if (!filteredOptions.length) return null;
  if (mode !== "multi") return filteredOptions[0];
  const selected = new Set(selectedValues.map((item) => String(item)));
  return filteredOptions.find((option) => !selected.has(String(option.value))) ?? filteredOptions[0];
}

export function resolveEnterAction({ search, defaultCandidate, allowCreate }) {
  if (defaultCandidate) return { type: "select", value: String(defaultCandidate.value) };
  const trimmed = search.trim();
  if (!trimmed || !allowCreate) return { type: "noop" };
  return { type: "create", value: trimmed };
}

export function resetSearchStateAfterCommit() {
  return { search: "", highlightedValue: null };
}

export function confirmNextSelectedValues({ mode, selectedValues, value }) {
  const normalized = selectedValues.map((item) => String(item));
  if (mode === "single") return [value];
  if (normalized.includes(value)) return [...selectedValues];
  return [...selectedValues, value];
}
