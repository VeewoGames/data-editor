import { useEffect, useRef, useState, type Dispatch, type MutableRefObject, type PointerEvent as ReactPointerEvent, type SetStateAction } from "react";
import {
  createOneDimensionalDragSession,
  createVerticalProjection,
  mergeProjectedSubsetOrder,
  projectVerticalDrag,
} from "../drag/one-dimensional-dnd.mjs";
import type { MultiSelectOptionView } from "../model/viewConfig";

type DragPreviewState = {
  activeValue: string;
  dropIndex: number;
  ghostHeight: number;
  ghostLeft: number;
  ghostTop: number;
  ghostWidth: number;
};

type UseOptionFieldDragReorderArgs = {
  filteredOptions: MultiSelectOptionView[];
  localOptionsRef: MutableRefObject<MultiSelectOptionView[]>;
  onReorderOptions: (orderedValues: string[]) => void;
  optionRowRefs: MutableRefObject<Record<string, HTMLDivElement | null>>;
  setLocalOptions: Dispatch<SetStateAction<MultiSelectOptionView[]>>;
};

export function useOptionFieldDragReorder({
  filteredOptions,
  localOptionsRef,
  onReorderOptions,
  optionRowRefs,
  setLocalOptions,
}: UseOptionFieldDragReorderArgs) {
  const [draggingValue, setDraggingValue] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreviewState | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const dragSessionRef = useRef<ReturnType<typeof createOneDimensionalDragSession> | null>(null);
  const queuedPointerRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const pointerFrameRef = useRef<number | null>(null);
  const dragStateRef = useRef<null | {
    activeValue: string;
    baseOrder: string[];
    ghostHeight: number;
    ghostLeft: number;
    ghostWidth: number;
    pointerOffsetY: number;
    visibleOrder: string[];
  }>(null);

  useEffect(() => () => dragCleanupRef.current?.(), []);

  function previewReorderByPointer(clientY: number) {
    const dragState = dragStateRef.current;
    if (!dragState) return null;
    const ghostTop = clientY - dragState.pointerOffsetY;
    const projectionItems = dragState.visibleOrder.map((value) => {
      if (value === dragState.activeValue) {
        return {
          id: value,
          size: dragState.ghostHeight,
          start: ghostTop,
        };
      }
      const row = optionRowRefs.current[value];
      if (!row) return null;
      const rect = row.getBoundingClientRect();
      return {
        id: value,
        size: rect.height,
        start: rect.top,
      };
    }).filter((item): item is { id: string; size: number; start: number } => item != null);
    if (!dragState.visibleOrder.includes(dragState.activeValue) || projectionItems.length !== dragState.visibleOrder.length) return null;

    const projectionResult = projectVerticalDrag({
      projection: createVerticalProjection({
        axis: "vertical",
        items: projectionItems,
      }),
      order: dragState.visibleOrder,
      activeId: dragState.activeValue,
      pointer: clientY,
    });
    const nextPreviewOrder = mergeProjectedSubsetOrder({
      fullOrder: dragState.baseOrder,
      subsetOrder: dragState.visibleOrder,
      projectedSubsetOrder: projectionResult.projectedOrder,
    });
    setDragPreview({
      activeValue: dragState.activeValue,
      dropIndex: projectionResult.dropIndex,
      ghostHeight: dragState.ghostHeight,
      ghostLeft: dragState.ghostLeft,
      ghostTop,
      ghostWidth: dragState.ghostWidth,
    });
    return nextPreviewOrder;
  }

  function handleDragStart(optionValue: string, event: ReactPointerEvent<HTMLButtonElement>) {
    if (!filteredOptions.some((option) => option.value === optionValue)) return;
    const sourceRow = optionRowRefs.current[optionValue];
    if (!sourceRow) return;
    const sourceRect = sourceRow.getBoundingClientRect();
    dragStateRef.current = {
      activeValue: optionValue,
      baseOrder: localOptionsRef.current.map((option) => option.value),
      ghostHeight: sourceRect.height,
      ghostLeft: sourceRect.left,
      ghostWidth: sourceRect.width,
      pointerOffsetY: event.clientY - sourceRect.top,
      visibleOrder: filteredOptions.map((option) => option.value),
    };
    dragSessionRef.current = createOneDimensionalDragSession({
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      onStart: () => {
        setDraggingValue(optionValue);
        setDragPreview({
          activeValue: optionValue,
          dropIndex: Math.max(0, dragStateRef.current?.visibleOrder.indexOf(optionValue) ?? 0),
          ghostHeight: sourceRect.height,
          ghostLeft: sourceRect.left,
          ghostTop: sourceRect.top,
          ghostWidth: sourceRect.width,
        });
      },
      onPreview: ({ clientY }) => previewReorderByPointer(clientY),
      onCommit: (finalizedOrder) => {
        const baseOrder = dragStateRef.current?.baseOrder ?? localOptionsRef.current.map((option) => option.value);
        if (sameOrder(baseOrder, finalizedOrder)) return;
        const nextOptions = applyOptionOrder(localOptionsRef.current, finalizedOrder);
        localOptionsRef.current = nextOptions;
        setLocalOptions(nextOptions);
        onReorderOptions(finalizedOrder);
      },
      onCancel: () => {
        setDraggingValue(null);
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
      if (mode === "release") dragSession?.release();
      else dragSession?.cancel();
      dragStateRef.current = null;
      dragSessionRef.current = null;
      queuedPointerRef.current = null;
      if (pointerFrameRef.current != null) {
        window.cancelAnimationFrame(pointerFrameRef.current);
        pointerFrameRef.current = null;
      }
      setDraggingValue(null);
      setDragPreview(null);
      dragCleanupRef.current?.();
      dragCleanupRef.current = null;
    };
    const onPointerUp = () => finishDrag("release");
    const onPointerCancel = () => finishDrag("cancel");
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
    window.addEventListener("pointercancel", onPointerCancel, { once: true });
    dragCleanupRef.current = () => {
      dragStateRef.current = null;
      dragSessionRef.current = null;
      queuedPointerRef.current = null;
      if (pointerFrameRef.current != null) {
        window.cancelAnimationFrame(pointerFrameRef.current);
        pointerFrameRef.current = null;
      }
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
    };
  }

  return {
    dragPreview,
    draggingValue,
    handleDragStart,
  };
}

function applyOptionOrder(
  options: MultiSelectOptionView[],
  orderedValues: string[],
) {
  const optionByValue = new Map(options.map((option) => [option.value, option]));
  return orderedValues.map((value) => optionByValue.get(value)).filter((option): option is MultiSelectOptionView => option != null);
}

function sameOrder(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
