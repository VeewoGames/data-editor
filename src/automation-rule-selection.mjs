export function normalizeAutomationRuleSelection(selectedIndex, ruleCount) {
  if (!Number.isInteger(ruleCount) || ruleCount < 0) {
    throw new TypeError("ruleCount must be a non-negative integer");
  }
  if (ruleCount === 0) return null;
  if (Number.isInteger(selectedIndex) && selectedIndex >= 0 && selectedIndex < ruleCount) {
    return selectedIndex;
  }
  return 0;
}

export function normalizeVisibleAutomationRuleSelection(selectedIndex, visibleIndexes, searchActive) {
  if (!Array.isArray(visibleIndexes) || visibleIndexes.some((index) => !Number.isInteger(index) || index < 0)) {
    throw new TypeError("visibleIndexes must contain non-negative integers");
  }
  if (visibleIndexes.length === 0) return searchActive ? null : selectedIndex;
  if (selectedIndex !== null && visibleIndexes.includes(selectedIndex)) return selectedIndex;
  return visibleIndexes[0];
}

export function automationRuleSelectionAfterRemoval(selectedIndex, removedIndex, ruleCount) {
  if (!Number.isInteger(removedIndex) || removedIndex < 0 || removedIndex >= ruleCount) {
    throw new TypeError("removedIndex must reference an existing rule");
  }
  if (!Number.isInteger(ruleCount) || ruleCount < 1) {
    throw new TypeError("ruleCount must be a positive integer");
  }
  if (ruleCount === 1) return null;
  if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= ruleCount) return 0;
  if (selectedIndex < removedIndex) return selectedIndex;
  if (selectedIndex > removedIndex) return selectedIndex - 1;
  return Math.min(removedIndex, ruleCount - 2);
}
