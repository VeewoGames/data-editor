import * as Popover from "@radix-ui/react-popover";
import { useEffect, useMemo, useRef, useState } from "react";
import { icons } from "../components/icons";
import type { RelationOption } from "../model/relations";
import type { RelationMode } from "../model/viewConfig";
import { getRelationOptionLabel } from "../model/relations";
import { focusWithoutScroll } from "../editing/focus-without-scroll.mjs";
import { chipStyleForValue } from "./chipColors";
import { confirmNextSelectedValues, resolveDefaultCandidate, resolveEnterAction } from "./discrete-value-picker.mjs";
import { isListboxNavigationKey, resolveListboxNavigationIndex } from "../components/listbox-keyboard-navigation.mjs";
import { useListboxPointerNavigation } from "../components/useListboxPointerNavigation";

type RelationCellEditorProps = {
  cellId: string;
  value: string | number | null | Array<string | number>;
  options: RelationOption[];
  configured: boolean;
  mode?: RelationMode;
  surface?: "table" | "detail";
  wrapped?: boolean;
  onEdit: (value: unknown) => void;
  onOpenTarget?: (value: string | number) => void;
};

let stickyOpenCellId: string | null = null;
const stickyValuesByCellId = new Map<string, Array<string | number>>();

export function RelationCellEditor({ cellId, value, options, configured, mode, surface = "table", wrapped = false, onEdit, onOpenTarget }: RelationCellEditorProps) {
  const multiple = mode ? mode === "multi" : Array.isArray(value);
  const normalizedValue = useMemo(() => normalizeValue(value), [value]);
  const [open, setOpen] = useState(() => stickyOpenCellId === cellId);
  const [draft, setDraft] = useState("");
  const [selectedValues, setSelectedValues] = useState<Array<string | number>>(() => stickyValuesByCellId.get(cellId) ?? normalizedValue);
  const [activeOptionIndex, setActiveOptionIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const handleOptionPointerMove = useListboxPointerNavigation({
    itemSelector: "[data-picker-option-row]",
    setActiveIndex: setActiveOptionIndex,
  });

  function restoreInputFocus() {
    queueMicrotask(() => focusWithoutScroll(inputRef.current));
  }

  const filteredOptions = useMemo(() => {
    const needle = draft.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) => {
      return option.label.toLowerCase().includes(needle) || option.description.toLowerCase().includes(needle) || option.value.toLowerCase().includes(needle);
    });
  }, [draft, options]);
  const defaultCandidate = useMemo(
    () => resolveDefaultCandidate({ filteredOptions, selectedValues, mode: multiple ? "multi" : "single" }),
    [filteredOptions, multiple, selectedValues],
  );

  useEffect(() => {
    const preferredIndex = filteredOptions.findIndex((option) => option.value === defaultCandidate?.value);
    setActiveOptionIndex(preferredIndex >= 0 ? preferredIndex : (filteredOptions.length ? 0 : -1));
  }, [defaultCandidate?.value, draft, filteredOptions, open]);

  useEffect(() => {
    optionRefs.current[activeOptionIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeOptionIndex]);

  useEffect(() => {
    if (!open) {
      setDraft("");
      setSelectedValues(normalizedValue);
      stickyValuesByCellId.delete(cellId);
    }
  }, [cellId, open, normalizedValue]);

  useEffect(() => {
    if (open) focusWithoutScroll(inputRef.current);
  }, [open]);

  function commit(nextValues: Array<string | number>) {
    stickyOpenCellId = cellId;
    stickyValuesByCellId.set(cellId, nextValues);
    setSelectedValues(nextValues);
    onEdit(multiple ? nextValues : (nextValues[0] ?? null));
    restoreInputFocus();
  }

  function toggleOption(option: RelationOption) {
    const exists = selectedValues.some((selected) => String(selected) === String(option.value));
    if (multiple) {
      commit(exists ? selectedValues.filter((selected) => String(selected) !== String(option.value)) : [...selectedValues, option.value]);
      return;
    }
    commit(exists ? [] : [option.value]);
    stickyOpenCellId = null;
    setOpen(false);
  }

  function clearValue(optionValue: string | number) {
    commit(selectedValues.filter((selected) => String(selected) !== String(optionValue)));
  }

  function confirmRelationOption(optionValue: string) {
    const nextValues = confirmNextSelectedValues({
      mode: multiple ? "multi" : "single",
      selectedValues,
      value: optionValue,
    });
    commit(nextValues);
    setDraft("");
    if (!multiple) {
      stickyOpenCellId = null;
      setOpen(false);
      return;
    }
    restoreInputFocus();
  }

  const triggerLabel = selectedValues.length === 0 ? (configured ? "未设置关联" : "未配置关联") : "";

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
          className={`multi-select-trigger relation-trigger field-surface-${surface} ${surface === "table" ? "cell-token-trigger" : "detail-field-trigger"} ${wrapped && surface === "table" ? "cell-token-flow" : ""}`}
          data-cell-role={surface === "table" ? "token-trigger" : "detail-trigger"}
          data-wrap-mode={wrapped && surface === "table" ? "wrap" : "truncate"}
          onClick={(event) => event.stopPropagation()}
          type="button"
        >
          <div className="chips-cell relation-chips-cell">
            {selectedValues.length === 0 ? <span className="relation-placeholder">{triggerLabel}</span> : null}
            {selectedValues.map((item, index) => (
              <span className="chip relation-chip" key={`${item}-${index}`} style={chipStyleForValue(item, "gray")}>
                {getRelationOptionLabel(item, options)}
              </span>
            ))}
          </div>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="multi-select-popover relation-popover" align="start" sideOffset={6} collisionPadding={12} onOpenAutoFocus={(event) => event.preventDefault()}>
          <div className="multi-select-selected relation-selected">
            {selectedValues.map((item, index) => (
              <button
                className="selected-chip"
                key={`${item}-${index}`}
                onPointerDown={(event) => {
                  event.preventDefault();
                  clearValue(item);
                }}
                type="button"
                style={chipStyleForValue(item, "gray")}
              >
                <span>{getRelationOptionLabel(item, options)}</span>
                {onOpenTarget ? (
                  <span
                    className="relation-open-target"
                    onPointerDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onOpenTarget(item);
                    }}
                    title="打开目标记录"
                  >
                    <icons.openDetail size={13} />
                  </span>
                ) : null}
                <span aria-hidden="true" className="selected-chip-remove"><icons.close size={12} strokeWidth={2.4} /></span>
              </button>
            ))}
            {configured ? (
              <input
                className="multi-select-input"
                ref={inputRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (isListboxNavigationKey(event.key)) {
                    event.preventDefault();
                    setActiveOptionIndex(resolveListboxNavigationIndex({ currentIndex: activeOptionIndex, itemCount: filteredOptions.length, key: event.key }));
                    return;
                  }
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  const activeOption = filteredOptions[activeOptionIndex];
                  if (activeOption) {
                    if (selectedValues.some((item) => String(item) === activeOption.value)) toggleOption(activeOption);
                    else confirmRelationOption(activeOption.value);
                    return;
                  }
                  const action = resolveEnterAction({
                    search: draft,
                    defaultCandidate,
                    allowCreate: false,
                  });
                  if (action.type === "select") confirmRelationOption(action.value);
                }}
                placeholder="搜索关联记录"
                role="combobox"
                aria-controls={`relation-list-${cellId.replace(/[^a-zA-Z0-9_-]/g, "-")}`}
                aria-expanded={open}
                aria-activedescendant={activeOptionIndex >= 0 ? `relation-option-${cellId.replace(/[^a-zA-Z0-9_-]/g, "-")}-${activeOptionIndex}` : undefined}
              />
            ) : null}
          </div>
          {!configured ? (
            <div className="relation-empty">当前字段未配置 relation 目标</div>
          ) : (
            <div className="multi-select-options" id={`relation-list-${cellId.replace(/[^a-zA-Z0-9_-]/g, "-")}`} role="listbox" aria-multiselectable={multiple} onPointerMove={handleOptionPointerMove}>
              {filteredOptions.map((option, index) => {
                const selected = selectedValues.some((item) => String(item) === option.value);
                return (
                  <button
                    className={`multi-select-option relation-option${selected ? " is-selected" : ""}${activeOptionIndex === index ? " is-active-target" : ""}`}
                    data-relation-value={String(option.value)}
                    data-picker-option-row
                    key={option.value}
                    id={`relation-option-${cellId.replace(/[^a-zA-Z0-9_-]/g, "-")}-${index}`}
                    role="option"
                    aria-selected={selected}
                    ref={(node) => { optionRefs.current[index] = node; }}
                    onPointerDown={(event) => {
                      event.preventDefault();
                      if (selected) {
                        toggleOption(option);
                        return;
                      }
                      confirmRelationOption(option.value);
                    }}
                    type="button"
                  >
                    <span className="chip" style={chipStyleForValue(option.value, "gray")}>{option.label}</span>
                    {option.description ? <small>{option.description}</small> : null}
                    {selected ? <span className="picker-option-selected-check" aria-hidden="true"><icons.check size={14} /></span> : null}
                    {onOpenTarget ? (
                      <span
                        className="relation-open-target"
                        onPointerDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          onOpenTarget(option.value);
                        }}
                        title="打开目标记录"
                      >
                        <icons.openDetail size={14} />
                      </span>
                    ) : null}
                  </button>
                );
              })}
              {filteredOptions.length === 0 ? <div className="relation-empty">没有匹配的记录</div> : null}
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function normalizeValue(value: string | number | null | Array<string | number>) {
  if (Array.isArray(value)) return value.filter((item) => item != null && item !== "");
  return value == null || value === "" ? [] : [value];
}
