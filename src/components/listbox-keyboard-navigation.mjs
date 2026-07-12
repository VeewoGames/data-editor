export function resolveListboxNavigationIndex({ currentIndex, itemCount, key }) {
  if (itemCount <= 0) return -1;
  if (key === "Home") return 0;
  if (key === "End") return itemCount - 1;
  if (key === "ArrowDown") return currentIndex < 0 ? 0 : (currentIndex + 1) % itemCount;
  if (key === "ArrowUp") return currentIndex < 0 ? itemCount - 1 : (currentIndex - 1 + itemCount) % itemCount;
  return Math.min(Math.max(currentIndex, 0), itemCount - 1);
}

export function isListboxNavigationKey(key) {
  return key === "ArrowDown" || key === "ArrowUp" || key === "Home" || key === "End";
}
