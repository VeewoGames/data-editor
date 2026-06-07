import * as Popover from "@radix-ui/react-popover";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { icons } from "../components/icons";
import type { MultiSelectOptionColor, MultiSelectOptionView } from "../model/viewConfig";
import { sortValuesByOptionOrder } from "../multiselect-config.mjs";
import { namedChipPalette, chipStyleForValue } from "./chipColors";

type OptionFieldEditorProps = {
  cellId: string;
  mode: "single" | "multi";
  surface?: "table" | "detail";
  value: Array<string | number>;
  options: MultiSelectOptionView[];
  wrapped?: boolean;
  placeholder?: string;
  onEdit: (value: Array<string | number>) => void;
  onRenameOption: (previousValue: string | number, nextValue: string) => void;
  onDeleteOption: (optionValue: string | number) => void;
  onSetOptionColor: (optionValue: string | number, color: MultiSelectOptionColor | null) => void;
  onReorderOptions: (orderedValues: string[]) => void;
};

type EditingState = {
  value: string;
  label: string;
};

let stickyOpenCellId: string | null = null;
const stickyValuesByCellId = new Map<string, Array<string | number>>();
const reorderTriggerRatioUp = 0.75;
const reorderTriggerRatioDown = 0.25;

const colorChoices: Array<{ value: MultiSelectOptionColor; label: string }> = [
  { value: "default", label: "默认" },
  { value: "gray", label: "灰色" },
  { value: "brown", label: "棕色" },
  { value: "orange", label: "橙色" },
  { value: "yellow", label: "黄色" },
  { value: "green", label: "绿色" },
  { value: "blue", label: "蓝色" },
  { value: "purple", label: "紫色" },
  { value: "pink", label: "粉色" },
  { value: "red", label: "红色" },
];

export function OptionFieldEditor({
  cellId,
  mode,
  surface = "table",
  value,
  options,
  wrapped = false,
  placeholder = "",
  onEdit,
  onRenameOption,
  onDeleteOption,
  onSetOptionColor,
  onReorderOptions,
}: OptionFieldEditorProps) {
  const [open, setOpen] = useState(() => stickyOpenCellId === cellId);
  const [draft, setDraft] = useState("");
  const [selectedValues, setSelectedValues] = useState<Array<string | number>>(() => stickyValuesByCellId.get(cellId) ?? value);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [localOptions, setLocalOptions] = useState<MultiSelectOptionView[]>(options);
  const [draggingValue, setDraggingValue] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const dragStartOptionsRef = useRef<MultiSelectOptionView[] | null>(null);
  const localOptionsRef = useRef<MultiSelectOptionView[]>(options);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const draggingValueRef = useRef<string | null>(null);
  const optionRowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const previousRowTopsRef = useRef<Record<string, number>>({});
  const filteredOptionValuesRef = useRef<string[]>([]);
  const queuedPointerYRef = useRef<number | null>(null);
  const pointerFrameRef = useRef<number | null>(null);
  const skipNextLayoutAnimationRef = useRef(false);

  useEffect(() => {
    if (sameOptionSnapshot(localOptionsRef.current, options)) return;
    setLocalOptions(options);
  }, [options]);

  useEffect(() => {
    localOptionsRef.current = localOptions;
  }, [localOptions]);

  useEffect(() => () => dragCleanupRef.current?.(), []);

  useEffect(() => {
    if (!open) {
      setDraft("");
      setEditing(null);
      setSelectedValues(value);
      stickyValuesByCellId.delete(cellId);
    }
  }, [cellId, open, value]);

  useEffect(() => {
    if (open && !editing) inputRef.current?.focus();
  }, [open, editing, selectedValues]);

  useEffect(() => {
    if (editing) renameInputRef.current?.focus();
  }, [editing]);

  const optionMap = useMemo(() => {
    const merged: Record<string, MultiSelectOptionView> = {};
    for (const option of localOptions) merged[option.value] = option;
    return merged;
  }, [localOptions]);

  const normalizedOptions = useMemo(() => {
    const unique = new Map<string, MultiSelectOptionView>();
    for (const option of localOptions) unique.set(option.value, option);
    for (const optionValue of [...selectedValues, ...value]) {
      const key = String(optionValue);
      if (!unique.has(key)) unique.set(key, { value: key, label: key, color: null });
    }
    return [...unique.values()];
  }, [localOptions, selectedValues, value]);

  const filteredOptions = useMemo(() => {
    const needle = draft.trim().toLowerCase();
    return normalizedOptions.filter((option) => option.label.toLowerCase().includes(needle) || option.value.toLowerCase().includes(needle));
  }, [draft, normalizedOptions]);

  useEffect(() => {
    filteredOptionValuesRef.current = filteredOptions.map((option) => option.value);
  }, [filteredOptions]);

  useLayoutEffect(() => {
    const nextRowTops: Record<string, number> = {};
    for (const option of filteredOptions) {
      const row = optionRowRefs.current[option.value];
      if (!row) continue;
      row.getAnimations().forEach((animation) => animation.cancel());
      row.style.transition = "";
      row.style.transform = "";
    }
    const shouldAnimate = !skipNextLayoutAnimationRef.current;
    skipNextLayoutAnimationRef.current = false;
    for (const option of filteredOptions) {
      const row = optionRowRefs.current[option.value];
      if (!row) continue;
      const nextTop = row.getBoundingClientRect().top;
      nextRowTops[option.value] = nextTop;
      if (!shouldAnimate) continue;
      const previousTop = previousRowTopsRef.current[option.value];
      if (previousTop == null) continue;
      const delta = previousTop - nextTop;
      if (Math.abs(delta) < 1) continue;
      row.animate(
        [
          { transform: `translateY(${delta}px)` },
          { transform: "translateY(0)" },
        ],
        {
          duration: 140,
          easing: "ease-out",
        },
      );
    }
    previousRowTopsRef.current = nextRowTops;
  }, [filteredOptions]);

  const canCreate = draft.trim().length > 0 && !normalizedOptions.some((option) => option.value.toLowerCase() === draft.trim().toLowerCase());
  const orderedOptionValues = useMemo(() => normalizedOptions.map((option) => option.value), [normalizedOptions]);
  const orderedSelectedValues = useMemo(
    () => sortValuesByOptionOrder(selectedValues, orderedOptionValues),
    [orderedOptionValues, selectedValues],
  );

  function commit(nextValues: Array<string | number>) {
    stickyOpenCellId = cellId;
    stickyValuesByCellId.set(cellId, nextValues);
    setSelectedValues(nextValues);
    onEdit(nextValues);
  }

  function toggleOption(optionValue: string | number) {
    const exists = selectedValues.some((selected) => String(selected) === String(optionValue));
    if (mode === "single") {
      commit(exists ? [] : [optionValue]);
      return;
    }
    commit(exists ? selectedValues.filter((selected) => String(selected) !== String(optionValue)) : [...selectedValues, optionValue]);
  }

  function createOption() {
    const nextValue = draft.trim();
    if (!nextValue) return;
    commit(mode === "single" ? [nextValue] : [...selectedValues, nextValue]);
    setDraft("");
  }

  function beginEdit(option: MultiSelectOptionView) {
    setEditing({ value: option.value, label: option.label });
  }

  function applyRename() {
    if (!editing) return;
    const nextValue = editing.label.trim();
    if (!nextValue || nextValue === editing.value) {
      setEditing(null);
      return;
    }
    onRenameOption(editing.value, nextValue);
    setLocalOptions((current) => current.map((option) => option.value === editing.value ? { ...option, value: nextValue, label: nextValue } : option));
    const nextSelected = selectedValues.map((item) => String(item) === editing.value ? castLike(item, nextValue) : item);
    stickyValuesByCellId.set(cellId, nextSelected);
    setSelectedValues(nextSelected);
    setEditing(null);
  }

  function removeOption(optionValue: string) {
    onDeleteOption(optionValue);
    setLocalOptions((current) => current.filter((option) => option.value !== optionValue));
    const nextSelected = selectedValues.filter((item) => String(item) !== optionValue);
    stickyValuesByCellId.set(cellId, nextSelected);
    setSelectedValues(nextSelected);
    setEditing(null);
  }

  function applyColor(optionValue: string, color: MultiSelectOptionColor) {
    onSetOptionColor(optionValue, color === "default" ? null : color);
    setLocalOptions((current) => current.map((option) => option.value === optionValue ? { ...option, color: color === "default" ? null : color } : option));
  }

  function previewReorderByPointer(clientY: number) {
    const currentDraggingValue = draggingValueRef.current;
    const allVisibleOptionValues = filteredOptionValuesRef.current;
    const visibleOptionValues = allVisibleOptionValues.filter((value) => value !== currentDraggingValue);
    if (!currentDraggingValue || visibleOptionValues.length === 0) return;
    const draggingIndex = allVisibleOptionValues.findIndex((value) => value === currentDraggingValue);
    let insertionIndex = visibleOptionValues.length;
    for (let index = 0; index < visibleOptionValues.length; index += 1) {
      const row = optionRowRefs.current[visibleOptionValues[index]];
      if (!row) continue;
      const rect = row.getBoundingClientRect();
      const movingUpward = draggingIndex >= 0 && index < draggingIndex;
      const triggerRatio = movingUpward ? reorderTriggerRatioUp : reorderTriggerRatioDown;
      if (clientY < rect.top + rect.height * triggerRatio) {
        insertionIndex = index;
        break;
      }
    }
    setLocalOptions((current) => {
      const nextOptions = reorderOptionsByInsertion(current, currentDraggingValue, visibleOptionValues, insertionIndex);
      if (sameOrder(
        current.map((option) => option.value),
        nextOptions.map((option) => option.value),
      )) {
        return current;
      }
      localOptionsRef.current = nextOptions;
      return nextOptions;
    });
  }

  function handleDragStart(optionValue: string) {
    dragStartOptionsRef.current = localOptionsRef.current;
    draggingValueRef.current = optionValue;
    setDraggingValue(optionValue);
    dragCleanupRef.current?.();
    const onPointerMove = (event: PointerEvent) => {
      queuedPointerYRef.current = event.clientY;
      if (pointerFrameRef.current != null) return;
      pointerFrameRef.current = window.requestAnimationFrame(() => {
        pointerFrameRef.current = null;
        const nextPointerY = queuedPointerYRef.current;
        if (nextPointerY == null) return;
        previewReorderByPointer(nextPointerY);
      });
    };
    const onPointerUp = () => {
      const startedOptions = dragStartOptionsRef.current;
      const finalizedOptions = localOptionsRef.current;
      if (startedOptions && !sameOrder(
        startedOptions.map((option) => option.value),
        finalizedOptions.map((option) => option.value),
      )) {
        skipNextLayoutAnimationRef.current = true;
        onReorderOptions(finalizedOptions.map((option) => option.value));
      }
      draggingValueRef.current = null;
      queuedPointerYRef.current = null;
      if (pointerFrameRef.current != null) {
        window.cancelAnimationFrame(pointerFrameRef.current);
        pointerFrameRef.current = null;
      }
      setDraggingValue(null);
      dragStartOptionsRef.current = null;
      dragCleanupRef.current?.();
      dragCleanupRef.current = null;
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
    dragCleanupRef.current = () => {
      queuedPointerYRef.current = null;
      if (pointerFrameRef.current != null) {
        window.cancelAnimationFrame(pointerFrameRef.current);
        pointerFrameRef.current = null;
      }
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(nextOpen) => {
        stickyOpenCellId = nextOpen ? cellId : null;
        setOpen(nextOpen);
      }}
    >
      <Popover.Trigger asChild>
        <button
          className={`multi-select-trigger option-field-trigger field-surface-${surface} ${surface === "table" ? "cell-token-trigger" : "detail-field-trigger"} ${wrapped && surface === "table" ? "cell-token-flow" : ""}`}
          data-cell-role={surface === "table" ? "token-trigger" : "detail-trigger"}
          data-wrap-mode={wrapped && surface === "table" ? "wrap" : "truncate"}
          onClick={(event) => event.stopPropagation()}
          type="button"
        >
          <div className="chips-cell">
            {selectedValues.length === 0 && placeholder ? <span className="select-placeholder">{placeholder}</span> : null}
            {orderedSelectedValues.map((item, index) => {
              const option = optionMap[String(item)];
              return (
                <span className="chip" key={`${item}-${index}`} style={chipStyleForValue(item, option?.color ?? null)}>
                  {option?.label ?? String(item)}
                </span>
              );
            })}
          </div>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="multi-select-popover option-field-popover-shell"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <div className="multi-select-selected option-field-popover-section option-field-selected-surface">
            {orderedSelectedValues.map((item, index) => {
              const option = optionMap[String(item)];
              return (
                <button
                  className="selected-chip"
                  key={`${item}-${index}`}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    toggleOption(item);
                  }}
                  type="button"
                  style={chipStyleForValue(item, option?.color ?? null)}
                >
                  <span>{option?.label ?? String(item)}</span>
                  <span className="selected-chip-remove">x</span>
                </button>
              );
            })}
            <input
              className="multi-select-input"
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (canCreate) createOption();
                }
              }}
              placeholder="选择或创建一个选项"
            />
          </div>
          <div className="multi-select-options option-field-popover-section option-field-popover-section-scroll">
            {filteredOptions.map((option) => {
              const selected = selectedValues.some((item) => String(item) === option.value);
              return (
                <div
                  className={`multi-select-option-row ${selected ? " selected" : ""}${draggingValue === option.value ? " is-dragging" : ""}`}
                  data-option-value={option.value}
                  key={option.value}
                  ref={(node) => {
                    optionRowRefs.current[option.value] = node;
                  }}
                >
                  <button
                    className="option-drag-handle"
                    onPointerDown={(event) => {
                      event.preventDefault();
                      handleDragStart(option.value);
                    }}
                    type="button"
                  >
                    <icons.dragHandle size={14} />
                  </button>
                  <button
                    className={`multi-select-option ${selected ? "selected" : ""}`}
                    onPointerDown={(event) => {
                      event.preventDefault();
                      toggleOption(option.value);
                    }}
                    type="button"
                  >
                    <span className="chip" style={chipStyleForValue(option.value, option.color)}>{option.label}</span>
                  </button>
                  <Popover.Root open={editing?.value === option.value} onOpenChange={(nextOpen) => setEditing(nextOpen ? { value: option.value, label: option.label } : null)}>
                    <Popover.Trigger asChild>
                      <button
                        className="option-menu-trigger"
                        onClick={(event) => {
                          event.stopPropagation();
                          beginEdit(option);
                        }}
                        title="编辑选项"
                        type="button"
                      >
                        <icons.more size={16} />
                      </button>
                    </Popover.Trigger>
                    <Popover.Portal>
                      <Popover.Content className="multi-select-option-editor" align="start" side="right" sideOffset={10} collisionPadding={12}>
                        <div className="multi-select-option-editor-header">
                          <input
                            className="multi-select-option-name-input"
                            ref={renameInputRef}
                            value={editing?.value === option.value ? editing.label : option.label}
                            onChange={(event) => setEditing({ value: option.value, label: event.target.value })}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                applyRename();
                              }
                            }}
                          />
                          <icons.info size={16} />
                        </div>
                        <button
                          className="multi-select-option-action danger"
                          onPointerDown={(event) => {
                            event.preventDefault();
                            removeOption(option.value);
                          }}
                          type="button"
                        >
                          <icons.delete size={16} />
                          <span>删除</span>
                        </button>
                        <div className="multi-select-option-divider" />
                        <div className="multi-select-option-section-title">颜色</div>
                        <div className="multi-select-color-list">
                          {colorChoices.map((choice) => {
                            const active = (option.color ?? "default") === choice.value;
                            const palette = namedChipPalette[choice.value];
                            return (
                              <button
                                className={`multi-select-color-item ${active ? "active" : ""}`}
                                key={choice.value}
                                onPointerDown={(event) => {
                                  event.preventDefault();
                                  applyColor(option.value, choice.value);
                                }}
                                type="button"
                              >
                                <span className="multi-select-color-swatch" style={{ background: palette.background }} />
                                <span>{choice.label}</span>
                                {active ? <icons.check size={16} /> : <span className="multi-select-color-check-placeholder" />}
                              </button>
                            );
                          })}
                        </div>
                      </Popover.Content>
                    </Popover.Portal>
                  </Popover.Root>
                </div>
              );
            })}
            {canCreate ? (
              <button
                className="multi-select-option create"
                onPointerDown={(event) => {
                  event.preventDefault();
                  createOption();
                }}
                type="button"
              >
                <icons.addField size={14} />
                <span>创建 “{draft.trim()}”</span>
              </button>
            ) : null}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function castLike(previousValue: string | number, nextValue: string) {
  if (typeof previousValue === "number" && /^-?\d+(\.\d+)?$/.test(nextValue)) return Number(nextValue);
  return nextValue;
}

function reorderOptionsByInsertion(
  options: MultiSelectOptionView[],
  draggingValue: string,
  visibleOptionValues: string[],
  insertionIndex: number,
) {
  const draggingOption = options.find((option) => option.value === draggingValue);
  if (!draggingOption) return options;
  const nextOptions = options.filter((option) => option.value !== draggingValue);
  const anchorValue = visibleOptionValues[insertionIndex];
  if (anchorValue) {
    const anchorIndex = nextOptions.findIndex((option) => option.value === anchorValue);
    if (anchorIndex >= 0) {
      nextOptions.splice(anchorIndex, 0, draggingOption);
      return nextOptions;
    }
  }
  const tailValue = visibleOptionValues[visibleOptionValues.length - 1];
  if (!tailValue) return options;
  const tailIndex = nextOptions.findIndex((option) => option.value === tailValue);
  if (tailIndex < 0) return options;
  nextOptions.splice(tailIndex + 1, 0, draggingOption);
  return nextOptions;
}

function sameOrder(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameOptionSnapshot(left: MultiSelectOptionView[], right: MultiSelectOptionView[]) {
  return left.length === right.length && left.every((option, index) => {
    const candidate = right[index];
    return candidate
      && option.value === candidate.value
      && option.label === candidate.label
      && option.color === candidate.color;
  });
}
