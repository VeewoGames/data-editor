import {
  createVerticalProjection,
  mergeProjectedSubsetOrder,
  projectVerticalDrag,
} from "./one-dimensional-dnd.mjs";

/**
 * @param {{
 *   fullOrder: string[];
 *   renderedOrder: string[];
 *   activePath: string;
 *   pointerY: number | null;
 *   items: Array<{ id: string; start: number; size: number }>;
 * }} input
 */
export function projectSidebarFileOrder({
  fullOrder,
  renderedOrder,
  activePath,
  pointerY,
  items,
}) {
  if (!renderedOrder.includes(activePath) || items.length !== renderedOrder.length) return null;
  const projectedRenderedOrder = projectVerticalDrag({
    projection: createVerticalProjection({
      axis: "vertical",
      items,
    }),
    order: renderedOrder,
    activeId: activePath,
    pointer: pointerY,
  }).projectedOrder;
  return mergeProjectedSubsetOrder({
    fullOrder,
    subsetOrder: renderedOrder,
    projectedSubsetOrder: projectedRenderedOrder,
  });
}
