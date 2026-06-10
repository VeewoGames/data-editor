import * as Popover from "@radix-ui/react-popover";
import { useEffect, useMemo, useRef, useState } from "react";
import { icons } from "../components/icons";
import type { RelationOption } from "../model/relations";
import type { RelationMode } from "../model/viewConfig";
import { getRelationOptionLabel } from "../model/relations";
import { chipStyleForValue } from "./chipColors";

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
  const inputRef = useRef<HTMLInputElement | null>(null);

  const filteredOptions = useMemo(() => {
    const needle = draft.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) => {
      return option.label.toLowerCase().includes(needle) || option.description.toLowerCase().includes(needle) || option.value.toLowerCase().includes(needle);
    });
  }, [draft, options]);

  useEffect(() => {
    if (!open) {
      setDraft("");
      setSelectedValues(normalizedValue);
      stickyValuesByCellId.delete(cellId);
    }
  }, [cellId, open, normalizedValue]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open, selectedValues]);

  function commit(nextValues: Array<string | number>) {
    stickyOpenCellId = cellId;
    stickyValuesByCellId.set(cellId, nextValues);
    setSelectedValues(nextValues);
    onEdit(multiple ? nextValues : (nextValues[0] ?? null));
  }

  function toggleOption(option: RelationOption) {
    const exists = selectedValues.some((selected) => String(selected) === String(option.value));
    if (multiple) {
      commit(exists ? selectedValues.filter((selected) => String(selected) !== String(option.value)) : [...selectedValues, option.value]);
      return;
    }
    commit(exists ? [] : [option.value]);
  }

  function clearValue(optionValue: string | number) {
    commit(selectedValues.filter((selected) => String(selected) !== String(optionValue)));
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
                <span className="selected-chip-remove">x</span>
              </button>
            ))}
            {configured ? (
              <input
                className="multi-select-input"
                ref={inputRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="搜索关联记录"
              />
            ) : null}
          </div>
          {!configured ? (
            <div className="relation-empty">当前字段未配置 relation 目标</div>
          ) : (
            <div className="multi-select-options">
              {filteredOptions.map((option) => {
                const selected = selectedValues.some((item) => String(item) === option.value);
                return (
                  <button
                    className={`multi-select-option relation-option ${selected ? "selected" : ""}`}
                    data-relation-value={String(option.value)}
                    key={option.value}
                    onPointerDown={(event) => {
                      event.preventDefault();
                      toggleOption(option);
                    }}
                    type="button"
                  >
                    <span className="chip" style={chipStyleForValue(option.value, "gray")}>{option.label}</span>
                    {option.description ? <small>{option.description}</small> : null}
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
