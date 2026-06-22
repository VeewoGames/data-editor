export function buildSelectionRect(anchor, focus) {
  return {
    rowStart: Math.min(anchor.visibleRowIndex, focus.visibleRowIndex),
    rowEnd: Math.max(anchor.visibleRowIndex, focus.visibleRowIndex),
    columnStart: Math.min(anchor.visibleColumnIndex, focus.visibleColumnIndex),
    columnEnd: Math.max(anchor.visibleColumnIndex, focus.visibleColumnIndex),
  };
}

export function isCellInsideRect(rect, coord) {
  return coord.visibleRowIndex >= rect.rowStart &&
    coord.visibleRowIndex <= rect.rowEnd &&
    coord.visibleColumnIndex >= rect.columnStart &&
    coord.visibleColumnIndex <= rect.columnEnd;
}

export function resolveClearValueByDisplayType(displayType) {
  if (displayType === "Text" || displayType === "Number") return "";
  if (displayType === "Checkbox") return false;
  if (displayType === "Select") return null;
  if (displayType === "Multi-select") return [];
  return undefined;
}

export function buildOptionFieldClearPatch({ options, selectedValues }) {
  return {
    createdOptionValues: [],
    deletedOptionValues: [],
    nextOptionOrder: options.map((option) => option.value),
    nextOptions: options,
    nextSelectedValues: [],
    optionsChanged: false,
    orderChanged: false,
    renamedOptions: [],
    valueChanged: selectedValues.length > 0,
  };
}
