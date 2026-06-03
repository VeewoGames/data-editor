const dragThreshold = 4;
const autoScrollEdgeThreshold = 56;
const autoScrollStep = 18;

export function shouldStartColumnDrag(deltaX, deltaY) {
  return Math.abs(deltaX) > dragThreshold || Math.abs(deltaY) > dragThreshold;
}

export function getPointerXInScrollSpace(scrollContainer, clientX) {
  if (!scrollContainer) return clientX;
  const rect = scrollContainer.getBoundingClientRect();
  return scrollContainer.scrollLeft + (clientX - rect.left);
}

export function resolveAutoScrollDirection(scrollContainer, clientX, threshold = autoScrollEdgeThreshold) {
  if (!scrollContainer) return 0;
  if (scrollContainer.scrollWidth <= scrollContainer.clientWidth) return 0;
  const rect = scrollContainer.getBoundingClientRect();
  if (clientX < rect.left + threshold) return scrollContainer.scrollLeft > 0 ? -1 : 0;
  if (clientX > rect.right - threshold) {
    return scrollContainer.scrollLeft < scrollContainer.scrollWidth - scrollContainer.clientWidth ? 1 : 0;
  }
  return 0;
}

export function collectColumnSlots(scrollContainer, draggingField) {
  if (!scrollContainer) return [];
  const containerRect = scrollContainer.getBoundingClientRect();
  const scrollLeft = scrollContainer.scrollLeft;
  return [...scrollContainer.querySelectorAll("th[data-column-field]")]
    .map((cell, index) => {
      const element = cell;
      const fieldName = element.dataset.columnField || "";
      const rect = element.getBoundingClientRect();
      return {
        fieldName,
        index,
        left: rect.left - containerRect.left + scrollLeft,
        right: rect.right - containerRect.left + scrollLeft,
        center: (rect.left + rect.right) / 2 - containerRect.left + scrollLeft,
      };
    })
    .filter((slot) => slot.fieldName && slot.fieldName !== draggingField);
}

export function resolveDropTarget(slots, pointerXInScrollSpace) {
  const orderedSlots = [...slots].sort((left, right) => left.left - right.left || left.index - right.index);
  for (const slot of orderedSlots) {
    if (pointerXInScrollSpace <= slot.center) {
      return { targetField: slot.fieldName, placement: "before" };
    }
  }
  const lastSlot = orderedSlots.at(-1);
  if (!lastSlot) return null;
  return { targetField: lastSlot.fieldName, placement: "after" };
}

export function buildPreviewOrderFromTarget(order, draggingField, targetField, placement = "before") {
  const otherFields = order.filter((field) => field !== draggingField);
  if (!targetField) return order;
  const targetIndex = otherFields.indexOf(targetField);
  if (targetIndex < 0) return [...otherFields, draggingField];
  const next = [...otherFields];
  next.splice(placement === "after" ? targetIndex + 1 : targetIndex, 0, draggingField);
  return next;
}

export function buildPreviewOrderFromSlots(order, draggingField, slots, pointerXInScrollSpace) {
  const target = resolveDropTarget(slots, pointerXInScrollSpace);
  if (!target) return order;
  return buildPreviewOrderFromTarget(order, draggingField, target.targetField, target.placement);
}

export function scrollColumnContainer(scrollContainer, direction) {
  if (!scrollContainer || direction === 0) return false;
  const maxScrollLeft = Math.max(0, scrollContainer.scrollWidth - scrollContainer.clientWidth);
  const nextScrollLeft = Math.max(0, Math.min(maxScrollLeft, scrollContainer.scrollLeft + direction * autoScrollStep));
  if (nextScrollLeft === scrollContainer.scrollLeft) return false;
  scrollContainer.scrollLeft = nextScrollLeft;
  return true;
}
