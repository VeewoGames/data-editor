import { useLayoutEffect, useRef, useState, type MutableRefObject, type PointerEvent as ReactPointerEvent } from "react";
import { createOneDimensionalDragSession, createVerticalProjection, projectVerticalDrag } from "../drag/one-dimensional-dnd.mjs";

type SidebarTreeNode = {
  id: string;
  kind: "source" | "folder" | "file";
  parentId: string | null;
  filePath?: string;
  children?: SidebarTreeNode[];
};

type UseSidebarTreeDragReorderArgs = {
  nodeButtonRefs: MutableRefObject<Record<string, HTMLButtonElement | null>>;
  tree: SidebarTreeNode[];
  childOrderByParent: Record<string, string[]>;
  onCommitOrder: (childOrderByParent: Record<string, string[]>) => void;
};

export function useSidebarTreeDragReorder({
  childOrderByParent,
  nodeButtonRefs,
  tree,
  onCommitOrder,
}: UseSidebarTreeDragReorderArgs) {
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [previewChildOrderByParent, setPreviewChildOrderByParent] = useState<Record<string, string[]> | null>(null);
  const nodeDragStateRef = useRef<null | {
    activeNodeId: string;
    parentId: string;
    baseChildOrderByParent: Record<string, string[]>;
    baseOrderedChildIds: string[];
    baseItems: Array<{ id: string; start: number; size: number }>;
  }>(null);
  const nodeDragSessionRef = useRef<ReturnType<typeof createOneDimensionalDragSession> | null>(null);
  const suppressNextNodeClickRef = useRef(false);
  const previewChildOrderByParentRef = useRef<Record<string, string[]> | null>(null);
  const childOrderKey = JSON.stringify(childOrderByParent);

  useLayoutEffect(() => {
    resetDragState(false);
  }, [childOrderKey]);

  function previewNodeDrag(clientX: number, clientY: number) {
    const dragState = nodeDragStateRef.current;
    if (!dragState?.parentId) return clearPreviewState();
    const parentNode = findNodeById(tree, dragState.parentId);
    if (!parentNode?.children?.length) return clearPreviewState();
    const {
      baseChildOrderByParent,
      baseItems,
      baseOrderedChildIds,
    } = dragState;
    if (!baseOrderedChildIds.includes(dragState.activeNodeId) || baseOrderedChildIds.length < 2) return clearPreviewState();

    const hoveredNodeId = resolveHoveredSidebarNodeId(clientX, clientY);
    if (!hoveredNodeId) return clearPreviewState();
    const hoveredNode = findNodeById(tree, hoveredNodeId);
    if (!hoveredNode || hoveredNode.parentId !== dragState.parentId) {
      if (hoveredNodeId !== dragState.activeNodeId) return clearPreviewState();
    }

    const minTop = baseItems[0]?.start ?? 0;
    const maxBottom = (baseItems.at(-1)?.start ?? 0) + (baseItems.at(-1)?.size ?? 0);
    if (clientY < minTop || clientY > maxBottom) return clearPreviewState();

    const projectedOrder = projectVerticalDrag({
      projection: createVerticalProjection({
        axis: "vertical",
        items: baseItems,
      }),
      order: baseOrderedChildIds,
      activeId: dragState.activeNodeId,
      pointer: clientY,
    });
    const nextParentOrder = projectedOrder.projectedOrder;
    if (sameOrder(nextParentOrder, baseOrderedChildIds)) return clearPreviewState();

    const nextPreview = {
      ...baseChildOrderByParent,
      [parentNode.id]: nextParentOrder,
    };
    previewChildOrderByParentRef.current = nextPreview;
    setPreviewChildOrderByParent((current) => sameChildOrder(current, nextPreview) ? current : nextPreview);
    return nextParentOrder;
  }

  function clearPreviewState() {
    previewChildOrderByParentRef.current = null;
    setPreviewChildOrderByParent((current) => current == null ? current : null);
    return null;
  }

  function resetDragState(shouldSuppressClick: boolean) {
    nodeDragStateRef.current = null;
    nodeDragSessionRef.current = null;
    previewChildOrderByParentRef.current = null;
    setPreviewChildOrderByParent(null);
    setDraggingNodeId(null);
    if (shouldSuppressClick) {
      window.setTimeout(() => {
        suppressNextNodeClickRef.current = false;
      }, 0);
    } else {
      suppressNextNodeClickRef.current = false;
    }
  }

  function beginNodeDrag(event: ReactPointerEvent<HTMLButtonElement>, sourceNodeId: string) {
    const activeNode = findNodeById(tree, sourceNodeId);
    if (!activeNode?.parentId) return;
    const parentNode = findNodeById(tree, activeNode.parentId);
    if (!parentNode?.children?.length) return;
    const baseChildOrderByParent = cloneChildOrderByParent(childOrderByParent);
    const baseOrderedChildIds = orderChildIds(parentNode.children, baseChildOrderByParent[parentNode.id]);
    const baseItems = baseOrderedChildIds.map((nodeId) => {
      const button = nodeButtonRefs.current[nodeId];
      if (!button) return null;
      const rect = button.getBoundingClientRect();
      return {
        id: nodeId,
        start: rect.top,
        size: rect.height,
      };
    }).filter((item): item is { id: string; start: number; size: number } => item != null);
    if (baseOrderedChildIds.length < 2 || baseItems.length !== baseOrderedChildIds.length) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    nodeDragStateRef.current = {
      activeNodeId: sourceNodeId,
      parentId: activeNode.parentId,
      baseChildOrderByParent,
      baseOrderedChildIds,
      baseItems,
    };
    nodeDragSessionRef.current = createOneDimensionalDragSession({
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      onStart: () => {
        suppressNextNodeClickRef.current = true;
        setDraggingNodeId(sourceNodeId);
      },
      onPreview: ({ clientX, clientY }) => previewNodeDrag(clientX, clientY),
      onCommit: () => {
        const nextChildOrderByParent = previewChildOrderByParentRef.current;
        if (!nextChildOrderByParent || sameChildOrder(childOrderByParent, nextChildOrderByParent)) return;
        onCommitOrder(nextChildOrderByParent);
      },
      onCancel: () => {
        previewChildOrderByParentRef.current = null;
        setPreviewChildOrderByParent(null);
        setDraggingNodeId(null);
      },
    });
  }

  function updateNodeDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const dragSession = nodeDragSessionRef.current;
    if (!dragSession || dragSession.pointerId !== event.pointerId) return;
    const result = dragSession.move({
      clientX: event.clientX,
      clientY: event.clientY,
    });
    if (result.started) event.preventDefault();
  }

  function endNodeDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const dragSession = nodeDragSessionRef.current;
    if (!dragSession || dragSession.pointerId !== event.pointerId) return;
    if (dragSession.started) previewNodeDrag(event.clientX, event.clientY);
    if (dragSession.started) event.preventDefault();
    const started = dragSession.started;
    dragSession.release();
    resetDragState(started);
  }

  function cancelNodeDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const dragSession = nodeDragSessionRef.current;
    if (!dragSession || dragSession.pointerId !== event.pointerId) return;
    const started = dragSession.started;
    dragSession.cancel();
    resetDragState(started);
  }

  return {
    beginNodeDrag,
    cancelNodeDrag,
    draggingNodeId,
    endNodeDrag,
    previewChildOrderByParent,
    suppressNextNodeClickRef,
    updateNodeDrag,
  };
}

function cloneChildOrderByParent(value: Record<string, string[]>) {
  return Object.fromEntries(
    Object.entries(value).map(([parentId, order]) => [parentId, [...order]]),
  ) as Record<string, string[]>;
}

function findNodeById(nodes: SidebarTreeNode[], nodeId: string): SidebarTreeNode | null {
  for (const node of nodes) {
    if (node.id === nodeId) return node;
    if (!node.children?.length) continue;
    const nested = findNodeById(node.children, nodeId);
    if (nested) return nested;
  }
  return null;
}

function findChildById(nodes: SidebarTreeNode[], nodeId: string) {
  return nodes.find((node) => node.id === nodeId) ?? null;
}

function orderChildIds(children: SidebarTreeNode[], preferredOrder?: string[]) {
  const seen = new Set<string>();
  const childMap = new Map(children.map((child) => [child.id, child]));
  const orderedIds: string[] = [];
  for (const childId of preferredOrder ?? []) {
    if (!childMap.has(childId) || seen.has(childId)) continue;
    seen.add(childId);
    orderedIds.push(childId);
  }
  for (const child of children) {
    if (seen.has(child.id)) continue;
    seen.add(child.id);
    orderedIds.push(child.id);
  }
  return orderedIds;
}

function sameChildOrder(left: Record<string, string[]> | null, right: Record<string, string[]>) {
  if (!left) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key, index) => (
    key === rightKeys[index]
    && left[key]!.length === right[key]!.length
    && left[key]!.every((value, itemIndex) => value === right[key]![itemIndex])
  ));
}

function sameOrder(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function resolveHoveredSidebarNodeId(clientX: number, clientY: number) {
  const element = document.elementFromPoint(clientX, clientY);
  const sidebarRow = element?.closest?.(".sidebar-tree-row") as HTMLElement | null;
  return sidebarRow?.dataset.sidebarNodeId ?? null;
}
