import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type MutableRefObject, type PointerEvent as ReactPointerEvent } from "react";
import {
  createOneDimensionalDragSession,
  createVerticalProjection,
  mergeProjectedSubsetOrder,
  projectVerticalDrag,
} from "../drag/one-dimensional-dnd.mjs";

export type VerticalListDragPreview = {
  activeId: string;
  dropIndex: number;
  ghostHeight: number;
  ghostLeft: number;
  ghostTop: number;
  ghostWidth: number;
};

type UseVerticalListDragReorderArgs<TElement extends HTMLElement> = {
  fullOrder: string[];
  visibleOrder: string[];
  itemRefs: MutableRefObject<Record<string, TElement | null>>;
  onCommitOrder: (nextOrder: string[]) => void;
};

type DragState = {
  activeId: string;
  baseOrder: string[];
  ghostHeight: number;
  ghostLeft: number;
  ghostWidth: number;
  pointerOffsetY: number;
  visibleOrder: string[];
};

export function useVerticalListDragReorder<TElement extends HTMLElement>({
  fullOrder,
  visibleOrder,
  itemRefs,
  onCommitOrder,
}: UseVerticalListDragReorderArgs<TElement>) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<VerticalListDragPreview | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const dragSessionRef = useRef<ReturnType<typeof createOneDimensionalDragSession> | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const queuedPointerRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const pointerFrameRef = useRef<number | null>(null);
  const fullOrderRef = useRef(fullOrder);
  const visibleOrderRef = useRef(visibleOrder);
  const suppressNextClickRef = useRef(false);

  fullOrderRef.current = fullOrder;
  visibleOrderRef.current = visibleOrder;

  useEffect(() => () => {
    dragCleanupRef.current?.();
  }, []);

  function previewReorderByPointer(clientY: number) {
    const dragState = dragStateRef.current;
    if (!dragState) return null;
    const ghostTop = clientY - dragState.pointerOffsetY;
    const projectionItems = dragState.visibleOrder.map((id) => {
      if (id === dragState.activeId) {
        return {
          id,
          size: dragState.ghostHeight,
          start: ghostTop,
        };
      }
      const row = itemRefs.current[id];
      if (!row) return null;
      const rect = row.getBoundingClientRect();
      return {
        id,
        size: rect.height,
        start: rect.top,
      };
    }).filter((item): item is { id: string; size: number; start: number } => item != null);
    if (!dragState.visibleOrder.includes(dragState.activeId) || projectionItems.length !== dragState.visibleOrder.length) return null;

    const projectionResult = projectVerticalDrag({
      projection: createVerticalProjection({
        axis: "vertical",
        items: projectionItems,
      }),
      order: dragState.visibleOrder,
      activeId: dragState.activeId,
      pointer: clientY,
    });
    const nextPreviewOrder = mergeProjectedSubsetOrder({
      fullOrder: dragState.baseOrder,
      subsetOrder: dragState.visibleOrder,
      projectedSubsetOrder: projectionResult.projectedOrder,
    });
    setDragPreview({
      activeId: dragState.activeId,
      dropIndex: projectionResult.dropIndex,
      ghostHeight: dragState.ghostHeight,
      ghostLeft: dragState.ghostLeft,
      ghostTop,
      ghostWidth: dragState.ghostWidth,
    });
    return nextPreviewOrder;
  }

  function resetDragState(shouldSuppressClick: boolean) {
    dragStateRef.current = null;
    dragSessionRef.current = null;
    queuedPointerRef.current = null;
    if (pointerFrameRef.current != null) {
      window.cancelAnimationFrame(pointerFrameRef.current);
      pointerFrameRef.current = null;
    }
    setDraggingId(null);
    setDragPreview(null);
    if (shouldSuppressClick) {
      window.setTimeout(() => {
        suppressNextClickRef.current = false;
      }, 0);
    } else {
      suppressNextClickRef.current = false;
    }
  }

  function beginDrag(id: string, event: ReactPointerEvent<HTMLElement>) {
    if (!visibleOrderRef.current.includes(id)) return;
    const sourceRow = itemRefs.current[id];
    if (!sourceRow) return;
    const sourceRect = sourceRow.getBoundingClientRect();
    dragStateRef.current = {
      activeId: id,
      baseOrder: [...fullOrderRef.current],
      ghostHeight: sourceRect.height,
      ghostLeft: sourceRect.left,
      ghostWidth: sourceRect.width,
      pointerOffsetY: event.clientY - sourceRect.top,
      visibleOrder: [...visibleOrderRef.current],
    };
    dragSessionRef.current = createOneDimensionalDragSession({
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      onStart: () => {
        suppressNextClickRef.current = true;
        setDraggingId(id);
        setDragPreview({
          activeId: id,
          dropIndex: Math.max(0, dragStateRef.current?.visibleOrder.indexOf(id) ?? 0),
          ghostHeight: sourceRect.height,
          ghostLeft: sourceRect.left,
          ghostTop: sourceRect.top,
          ghostWidth: sourceRect.width,
        });
      },
      onPreview: ({ clientY }) => previewReorderByPointer(clientY),
      onCommit: (finalizedOrder) => {
        const baseOrder = dragStateRef.current?.baseOrder ?? fullOrderRef.current;
        if (sameOrder(baseOrder, finalizedOrder)) return;
        onCommitOrder(finalizedOrder);
      },
      onCancel: () => {
        setDraggingId(null);
        setDragPreview(null);
      },
    });
    dragCleanupRef.current?.();
    const onPointerMove = (nextEvent: PointerEvent) => {
      const dragSession = dragSessionRef.current;
      if (!dragSession || nextEvent.pointerId !== dragSession.pointerId) return;
      queuedPointerRef.current = { clientX: nextEvent.clientX, clientY: nextEvent.clientY };
      if (pointerFrameRef.current != null) return;
      pointerFrameRef.current = window.requestAnimationFrame(() => {
        pointerFrameRef.current = null;
        const nextPointer = queuedPointerRef.current;
        if (!nextPointer) return;
        dragSession.move(nextPointer);
      });
    };
    const finishDrag = (mode: "release" | "cancel") => {
      const dragSession = dragSessionRef.current;
      const started = dragSession?.started ?? false;
      if (mode === "release") dragSession?.release();
      else dragSession?.cancel();
      dragCleanupRef.current?.();
      dragCleanupRef.current = null;
      resetDragState(started);
    };
    const onPointerUp = () => finishDrag("release");
    const onPointerCancel = () => finishDrag("cancel");
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
    window.addEventListener("pointercancel", onPointerCancel, { once: true });
    dragCleanupRef.current = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
    };
  }

  function handleSuppressedClickCapture(event: ReactMouseEvent<HTMLElement>) {
    if (!suppressNextClickRef.current) return;
    event.preventDefault();
    event.stopPropagation();
  }

  return {
    beginDrag,
    dragPreview,
    draggingId,
    handleSuppressedClickCapture,
  };
}

function sameOrder(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
