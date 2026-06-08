import { type Dispatch, type MutableRefObject, type PointerEvent as ReactPointerEvent, type SetStateAction } from "react";
import { useVerticalListDragReorder } from "../components/useVerticalListDragReorder";

type OptionLike = {
  value: string;
};

type UseOptionFieldDragReorderArgs<TOption extends OptionLike> = {
  filteredOptions: TOption[];
  localOptionsRef: MutableRefObject<TOption[]>;
  optionRowRefs: MutableRefObject<Record<string, HTMLDivElement | null>>;
  setLocalOptions: Dispatch<SetStateAction<TOption[]>>;
};

export function useOptionFieldDragReorder<TOption extends OptionLike>({
  filteredOptions,
  localOptionsRef,
  optionRowRefs,
  setLocalOptions,
}: UseOptionFieldDragReorderArgs<TOption>) {
  const {
    beginDrag,
    dragPreview,
    draggingId,
  } = useVerticalListDragReorder({
    fullOrder: localOptionsRef.current.map((option) => option.value),
    visibleOrder: filteredOptions.map((option) => option.value),
    itemRefs: optionRowRefs,
    onCommitOrder: (finalizedOrder) => {
      const nextOptions = applyOptionOrder(localOptionsRef.current, finalizedOrder);
      localOptionsRef.current = nextOptions;
      setLocalOptions(nextOptions);
    },
  });

  return {
    dragPreview,
    draggingValue: draggingId,
    handleDragStart: (optionValue: string, event: ReactPointerEvent<HTMLButtonElement>) => beginDrag(optionValue, event),
  };
}

function applyOptionOrder<TOption extends OptionLike>(
  options: TOption[],
  orderedValues: string[],
) {
  const optionByValue = new Map(options.map((option) => [option.value, option]));
  return orderedValues.map((value) => optionByValue.get(value)).filter((option): option is TOption => option != null);
}

