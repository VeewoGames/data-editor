import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";

type UseListboxPointerNavigationOptions = {
  itemSelector: string;
  setActiveIndex: (index: number) => void;
};

export function useListboxPointerNavigation({ itemSelector, setActiveIndex }: UseListboxPointerNavigationOptions) {
  const lastPointerPointRef = useRef<{ x: number; y: number } | null>(null);

  return useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType === "touch") return;
    const previousPoint = lastPointerPointRef.current;
    if (previousPoint?.x === event.clientX && previousPoint.y === event.clientY) return;
    lastPointerPointRef.current = { x: event.clientX, y: event.clientY };

    const target = event.target;
    if (!(target instanceof Element)) return;
    const item = target.closest<HTMLElement>(itemSelector);
    if (!item || !event.currentTarget.contains(item)) return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(itemSelector));
    const nextIndex = items.indexOf(item);
    if (nextIndex >= 0) setActiveIndex(nextIndex);
  }, [itemSelector, setActiveIndex]);
}
