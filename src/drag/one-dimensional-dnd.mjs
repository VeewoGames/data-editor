export const ONE_DIMENSIONAL_DRAG_THRESHOLD = 4;
export const ONE_DIMENSIONAL_FORWARD_TRIGGER_RATIO = 0.25;
export const ONE_DIMENSIONAL_BACKWARD_TRIGGER_RATIO = 0.75;

/**
 * @param {{ startX: number; startY: number; currentX: number; currentY: number; threshold?: number }} input
 */
export function shouldStartOneDimensionalDrag({
  startX,
  startY,
  currentX,
  currentY,
  threshold = ONE_DIMENSIONAL_DRAG_THRESHOLD,
}) {
  return Math.abs(currentX - startX) > threshold || Math.abs(currentY - startY) > threshold;
}

/**
 * @param {{
 *   pointerId: number;
 *   startX: number;
 *   startY: number;
 *   threshold?: number;
 *   onStart?: () => void;
 *   onPreview?: (input: { clientX: number; clientY: number; previewOrder: string[] | null }) => string[] | null | void;
 *   onCommit?: (previewOrder: string[]) => void;
 *   onCancel?: () => void;
 * }} input
 */
export function createOneDimensionalDragSession({
  pointerId,
  startX,
  startY,
  threshold = ONE_DIMENSIONAL_DRAG_THRESHOLD,
  onStart,
  onPreview,
  onCommit,
  onCancel,
}) {
  let started = false;
  /** @type {string[] | null} */
  let previewOrder = null;

  return {
    pointerId,
    get started() {
      return started;
    },
    move({ clientX, clientY }) {
      if (!started) {
        if (!shouldStartOneDimensionalDrag({
          startX,
          startY,
          currentX: clientX,
          currentY: clientY,
          threshold,
        })) {
          return { started: false, previewOrder };
        }
        started = true;
        onStart?.();
      }
      const nextPreviewOrder = onPreview?.({ clientX, clientY, previewOrder });
      if (Array.isArray(nextPreviewOrder)) previewOrder = nextPreviewOrder;
      return { started: true, previewOrder };
    },
    release() {
      if (started && previewOrder) onCommit?.(previewOrder);
      const committedOrder = previewOrder;
      previewOrder = null;
      started = false;
      return committedOrder;
    },
    cancel() {
      previewOrder = null;
      started = false;
      onCancel?.();
    },
  };
}

/**
 * @param {string[]} order
 * @param {string} activeId
 * @param {number} targetIndex
 */
export function arrayMove(order, activeId, targetIndex) {
  const currentIndex = order.indexOf(activeId);
  if (currentIndex < 0) return [...order];
  const next = order.filter((id) => id !== activeId);
  const clampedIndex = Math.max(0, Math.min(next.length, targetIndex));
  next.splice(clampedIndex, 0, activeId);
  return next;
}

/**
 * @param {{
 *   axis: "vertical";
 *   itemSize?: number;
 *   forwardTriggerRatio?: number;
 *   backwardTriggerRatio?: number;
 *   items: Array<{ id: string; start: number; size?: number }>
 * }} input
 */
export function createVerticalProjection({
  axis,
  itemSize = 0,
  forwardTriggerRatio = ONE_DIMENSIONAL_FORWARD_TRIGGER_RATIO,
  backwardTriggerRatio = ONE_DIMENSIONAL_BACKWARD_TRIGGER_RATIO,
  items,
}) {
  if (axis !== "vertical") throw new Error(`Unsupported axis: ${axis}`);
  const normalizedItems = items.map((item, index) => ({
    id: item.id,
    index,
    start: item.start,
    size: item.size ?? itemSize,
    center: item.start + (item.size ?? itemSize) / 2,
  }));
  return {
    axis,
    forwardTriggerRatio,
    backwardTriggerRatio,
    items: normalizedItems,
  };
}

/**
 * @param {{
 *   projection: {
 *     axis: "vertical";
 *     forwardTriggerRatio: number;
 *     backwardTriggerRatio: number;
 *     items: Array<{ id: string; index: number; start: number; size: number; center: number }>;
 *   };
 *   order: string[];
 *   activeId: string;
 *   pointer: number | null;
 * }} input
 */
export function projectVerticalDrag({ projection, order, activeId, pointer }) {
  const activeItem = projection.items.find((item) => item.id === activeId);
  if (!activeItem) {
    return {
      dropIndex: order.indexOf(activeId),
      projectedOrder: [...order],
      direction: null,
    };
  }
  const pointerPosition = pointer ?? activeItem.center;
  const siblings = projection.items.filter((item) => item.id !== activeId);
  let dropIndex = siblings.length;
  for (let index = 0; index < siblings.length; index += 1) {
    const sibling = siblings[index];
    const triggerRatio = sibling.index < activeItem.index
      ? projection.backwardTriggerRatio
      : projection.forwardTriggerRatio;
    const triggerLine = sibling.start + sibling.size * triggerRatio;
    if (pointerPosition < triggerLine) {
      dropIndex = index;
      break;
    }
  }
  const projectedOrder = arrayMove(order, activeId, dropIndex);
  const startIndex = order.indexOf(activeId);
  return {
    dropIndex,
    projectedOrder,
    direction: dropIndex < startIndex ? "backward" : dropIndex > startIndex ? "forward" : null,
  };
}

/**
 * @param {{ fullOrder: string[]; subsetOrder: string[]; projectedSubsetOrder: string[] }} input
 */
export function mergeProjectedSubsetOrder({ fullOrder, subsetOrder, projectedSubsetOrder }) {
  if (subsetOrder.length === 0) return [...fullOrder];
  const subsetSet = new Set(subsetOrder);
  const strippedOrder = fullOrder.filter((id) => !subsetSet.has(id));
  const firstSubsetIndex = fullOrder.findIndex((id) => subsetSet.has(id));
  if (firstSubsetIndex < 0) return [...fullOrder];
  strippedOrder.splice(firstSubsetIndex, 0, ...projectedSubsetOrder);
  return strippedOrder;
}
