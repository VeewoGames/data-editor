import { useLayoutEffect, useRef, useState, type MutableRefObject, type PointerEvent as ReactPointerEvent } from "react";
import { createOneDimensionalDragSession } from "../drag/one-dimensional-dnd.mjs";
import { projectSidebarFileOrder } from "../drag/sidebar-file-dnd.mjs";

type UseSidebarFileDragReorderArgs = {
  fileButtonRefs: MutableRefObject<Record<string, HTMLButtonElement | null>>;
  fileOrder: string[];
  onCommitOrder: (fileOrder: string[]) => void;
};

export function useSidebarFileDragReorder({
  fileButtonRefs,
  fileOrder,
  onCommitOrder,
}: UseSidebarFileDragReorderArgs) {
  const [draggingFilePath, setDraggingFilePath] = useState<string | null>(null);
  const [previewFileOrder, setPreviewFileOrder] = useState<string[] | null>(null);
  const fileDragStateRef = useRef<null | { activePath: string; baseOrder: string[] }>(null);
  const fileDragSessionRef = useRef<ReturnType<typeof createOneDimensionalDragSession> | null>(null);
  const suppressNextFileClickRef = useRef(false);
  const previewFileOrderRef = useRef<string[] | null>(null);
  const renderedFileOrderRef = useRef<string[]>(fileOrder);
  const fileOrderKey = fileOrder.join("\n");

  renderedFileOrderRef.current = previewFileOrder ?? fileOrder;
  previewFileOrderRef.current = previewFileOrder;

  useLayoutEffect(() => {
    resetDragState(false);
  }, [fileOrderKey]);

  function previewFileDrag(clientY: number) {
    const dragState = fileDragStateRef.current;
    if (!dragState) return null;
    const currentRenderedOrder = renderedFileOrderRef.current;
    const items = currentRenderedOrder.map((path) => {
      const button = fileButtonRefs.current[path];
      if (!button) return null;
      const rect = button.getBoundingClientRect();
      return {
        id: path,
        start: rect.top,
        size: rect.height,
      };
    }).filter((item): item is { id: string; start: number; size: number } => item != null);
    const nextPreviewOrder = projectSidebarFileOrder({
      fullOrder: previewFileOrderRef.current ?? dragState.baseOrder,
      renderedOrder: currentRenderedOrder,
      activePath: dragState.activePath,
      pointerY: clientY,
      items,
    });
    if (!nextPreviewOrder) return null;
    previewFileOrderRef.current = nextPreviewOrder;
    setPreviewFileOrder((current) => current && sameOrder(current, nextPreviewOrder) ? current : nextPreviewOrder);
    return nextPreviewOrder;
  }

  function resetDragState(shouldSuppressClick: boolean) {
    fileDragStateRef.current = null;
    fileDragSessionRef.current = null;
    previewFileOrderRef.current = null;
    setPreviewFileOrder(null);
    setDraggingFilePath(null);
    if (shouldSuppressClick) {
      window.setTimeout(() => {
        suppressNextFileClickRef.current = false;
      }, 0);
    } else {
      suppressNextFileClickRef.current = false;
    }
  }

  function beginFileDrag(event: ReactPointerEvent<HTMLButtonElement>, sourcePath: string) {
    event.currentTarget.setPointerCapture(event.pointerId);
    fileDragStateRef.current = {
      activePath: sourcePath,
      baseOrder: fileOrder,
    };
    fileDragSessionRef.current = createOneDimensionalDragSession({
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      onStart: () => {
        suppressNextFileClickRef.current = true;
        setDraggingFilePath(sourcePath);
      },
      onPreview: ({ clientY }) => previewFileDrag(clientY),
      onCommit: (finalizedOrder) => {
        const baseOrder = fileDragStateRef.current?.baseOrder ?? fileOrder;
        if (sameOrder(baseOrder, finalizedOrder)) return;
        onCommitOrder(finalizedOrder);
      },
      onCancel: () => {
        previewFileOrderRef.current = null;
        setPreviewFileOrder(null);
        setDraggingFilePath(null);
      },
    });
  }

  function updateFileDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const dragSession = fileDragSessionRef.current;
    if (!dragSession || dragSession.pointerId !== event.pointerId) return;
    const result = dragSession.move({
      clientX: event.clientX,
      clientY: event.clientY,
    });
    if (result.started) event.preventDefault();
  }

  function endFileDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const dragSession = fileDragSessionRef.current;
    if (!dragSession || dragSession.pointerId !== event.pointerId) return;
    if (dragSession.started) event.preventDefault();
    const started = dragSession.started;
    dragSession.release();
    resetDragState(started);
  }

  function cancelFileDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const dragSession = fileDragSessionRef.current;
    if (!dragSession || dragSession.pointerId !== event.pointerId) return;
    const started = dragSession.started;
    dragSession.cancel();
    resetDragState(started);
  }

  return {
    beginFileDrag,
    cancelFileDrag,
    draggingFilePath,
    endFileDrag,
    previewFileOrder,
    suppressNextFileClickRef,
    updateFileDrag,
  };
}

function sameOrder(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
