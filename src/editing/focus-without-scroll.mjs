/**
 * Keep focus changes from nudging the nearest scroll container.
 * Older browsers may not support the options object, so fall back to plain focus.
 *
 * @param {HTMLElement | null | undefined} element
 */
export function focusWithoutScroll(element) {
  if (!element || typeof element.focus !== "function") return;
  try {
    element.focus({ preventScroll: true });
  } catch {
    element.focus();
  }
}
