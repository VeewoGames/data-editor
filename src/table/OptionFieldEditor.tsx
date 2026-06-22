import * as Popover from "@radix-ui/react-popover";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { icons } from "../components/icons";
import type { MultiSelectOptionColor, MultiSelectOptionView } from "../model/viewConfig";
import { sortValuesByOptionOrder } from "../multiselect-config.mjs";
import { focusWithoutScroll } from "../editing/focus-without-scroll.mjs";
import { namedChipPalette, chipStyleForValue } from "./chipColors";
import { useOptionFieldDragReorder } from "./useOptionFieldDragReorder";

export type OptionFieldDraftCommit = {
  createdOptionValues: string[];
  deletedOptionValues: string[];
  nextOptionOrder: string[];
  nextOptions: MultiSelectOptionView[];
  nextSelectedValues: Array<string | number>;
  optionsChanged: boolean;
  orderChanged: boolean;
  renamedOptions: Array<{ previousValue: string; nextValue: string }>;
  valueChanged: boolean;
};

export function forwardOptionFieldSurfaceClick(event: ReactMouseEvent<HTMLElement>) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (target.closest('[data-cell-role="token-trigger"], [data-cell-role="detail-trigger"], input, textarea, [data-radix-popper-content-wrapper]')) return;
  const trigger = event.currentTarget.querySelector<HTMLButtonElement>('[data-cell-role="token-trigger"], [data-cell-role="detail-trigger"]');
  if (!trigger) return;
  event.stopPropagation();
  trigger.click();
}

type OptionFieldEditorProps = {
  cellId: string;
  mode: "single" | "multi";
  surface?: "table" | "detail";
  value: Array<string | number>;
  options: MultiSelectOptionView[];
  wrapped?: boolean;
  placeholder?: string;
  onCommitDraft: (patch: OptionFieldDraftCommit) => void;
};

type EditingState = {
  label: string;
  value: string;
};

type DraftOptionView = MultiSelectOptionView & {
  originValue: string | null;
};

type DraftSessionSnapshot = {
  options: DraftOptionView[];
  selectedValues: Array<string | number>;
};

type ColorChoice = { value: MultiSelectOptionColor; label: string };

const defaultColorChoice: ColorChoice = { value: "default", label: "默认" };

const lightColorChoices: ColorChoice[] = [
  { value: "gray", label: "灰色" },
  { value: "brown", label: "棕色" },
  { value: "orange", label: "橙色" },
  { value: "yellow", label: "黄色" },
  { value: "green", label: "绿色" },
  { value: "blue", label: "蓝色" },
  { value: "teal", label: "青绿" },
  { value: "cyan", label: "青色" },
  { value: "lime", label: "黄绿" },
  { value: "indigo", label: "靛蓝" },
  { value: "rose", label: "玫瑰" },
  { value: "amber", label: "琥珀" },
  { value: "purple", label: "紫色" },
  { value: "pink", label: "粉色" },
  { value: "red", label: "红色" },
];

const darkColorChoices: ColorChoice[] = [
  { value: "dark_gray", label: "深灰" },
  { value: "dark_brown", label: "深棕" },
  { value: "dark_orange", label: "深橙" },
  { value: "dark_yellow", label: "深黄" },
  { value: "dark_green", label: "深绿" },
  { value: "dark_blue", label: "深蓝" },
  { value: "dark_teal", label: "深青绿" },
  { value: "dark_cyan", label: "深青色" },
  { value: "dark_lime", label: "深黄绿" },
  { value: "dark_indigo", label: "深靛蓝" },
  { value: "dark_rose", label: "深玫瑰" },
  { value: "dark_amber", label: "深琥珀" },
  { value: "dark_purple", label: "深紫" },
  { value: "dark_pink", label: "深粉" },
  { value: "dark_red", label: "深红" },
];

const colorChoiceGroups = [
  { key: "light", label: "浅色", choices: lightColorChoices },
  { key: "dark", label: "深色", choices: darkColorChoices },
] as const;

export function OptionFieldEditor({
  cellId,
  mode,
  surface = "table",
  value,
  options,
  wrapped = false,
  placeholder = "",
  onCommitDraft,
}: OptionFieldEditorProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [selectedValues, setSelectedValues] = useState<Array<string | number>>(() => buildDraftSession(value, options).selectedValues);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [localOptions, setLocalOptions] = useState<DraftOptionView[]>(() => buildDraftSession(value, options).options);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const selectedValuesRef = useRef<Array<string | number>>(selectedValues);
  const localOptionsRef = useRef<DraftOptionView[]>(localOptions);
  const optionRowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const previousRowTopsRef = useRef<Record<string, number>>({});
  const popoverContentRef = useRef<HTMLDivElement | null>(null);
  const closeIntentRef = useRef<"commit" | "cancel">("commit");
  const initialSessionRef = useRef<DraftSessionSnapshot>(buildDraftSession(value, options));
  const openRef = useRef(false);
  const sessionCommitRef = useRef(onCommitDraft);
  const settledCloseRef = useRef(false);

  function focusSearchInputOnOpen() {
    queueMicrotask(() => {
      if (editing) return;
      focusWithoutScroll(inputRef.current);
    });
  }

  function restoreInputFocus() {
    queueMicrotask(() => focusWithoutScroll(inputRef.current));
  }

  useEffect(() => {
    localOptionsRef.current = localOptions;
  }, [localOptions]);

  useEffect(() => {
    selectedValuesRef.current = selectedValues;
  }, [selectedValues]);

  useEffect(() => {
    if (!openRef.current) sessionCommitRef.current = onCommitDraft;
  }, [onCommitDraft]);

  const sessionDirty = useMemo(
    () => !sameSelectedValues(selectedValues, initialSessionRef.current.selectedValues)
      || !sameDraftOptionSnapshot(localOptions, initialSessionRef.current.options),
    [localOptions, selectedValues],
  );
  const sessionDirtyRef = useRef(sessionDirty);
  useEffect(() => {
    sessionDirtyRef.current = sessionDirty;
  }, [sessionDirty]);

  useEffect(() => {
    const nextSession = buildDraftSession(value, options);
    if (open && sessionDirtyRef.current) return;
    initialSessionRef.current = nextSession;
    setSelectedValues(nextSession.selectedValues);
    setLocalOptions(nextSession.options);
    setDraft("");
    setEditing(null);
  }, [cellId, open, options, value]);

  useEffect(() => {
    if (open && !editing) focusWithoutScroll(inputRef.current);
  }, [open, editing]);

  useEffect(() => {
    if (editing) focusWithoutScroll(renameInputRef.current);
  }, [editing]);

  const optionMap = useMemo(() => {
    const merged: Record<string, DraftOptionView> = {};
    for (const option of localOptions) merged[option.value] = option;
    return merged;
  }, [localOptions]);

  const filteredOptions = useMemo(() => {
    const needle = draft.trim().toLowerCase();
    return localOptions.filter((option) => option.label.toLowerCase().includes(needle) || option.value.toLowerCase().includes(needle));
  }, [draft, localOptions]);
  const {
    dragPreview,
    draggingValue,
    handleDragStart,
  } = useOptionFieldDragReorder({
    filteredOptions,
    localOptionsRef,
    optionRowRefs,
    setLocalOptions,
  });
  const renderedOptions = useMemo(
    () => filteredOptions.filter((option) => option.value !== dragPreview?.activeId),
    [dragPreview?.activeId, filteredOptions],
  );

  useLayoutEffect(() => {
    const nextRowTops: Record<string, number> = {};
    for (const option of renderedOptions) {
      const row = optionRowRefs.current[option.value];
      if (!row) continue;
      row.getAnimations().forEach((animation) => animation.cancel());
      row.style.transition = "";
      row.style.transform = "";
    }
    for (const option of renderedOptions) {
      const row = optionRowRefs.current[option.value];
      if (!row) continue;
      const nextTop = row.getBoundingClientRect().top;
      nextRowTops[option.value] = nextTop;
      if (draggingValue === option.value) continue;
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
  }, [draggingValue, renderedOptions]);

  const canCreate = draft.trim().length > 0 && !localOptions.some((option) => option.value.toLowerCase() === draft.trim().toLowerCase());
  const orderedOptionValues = useMemo(() => localOptions.map((option) => option.value), [localOptions]);
  const orderedSelectedValues = useMemo(
    () => sortValuesByOptionOrder(selectedValues, orderedOptionValues),
    [orderedOptionValues, selectedValues],
  );

  function resetSession(nextSession: DraftSessionSnapshot) {
    initialSessionRef.current = nextSession;
    selectedValuesRef.current = nextSession.selectedValues;
    localOptionsRef.current = nextSession.options;
    setSelectedValues(nextSession.selectedValues);
    setLocalOptions(nextSession.options);
    setDraft("");
    setEditing(null);
  }

  function syncFromCommittedProps() {
    resetSession(buildDraftSession(value, options));
  }

  function toggleOption(optionValue: string | number) {
    const exists = selectedValues.some((selected) => String(selected) === String(optionValue));
    if (mode === "single") {
      const nextSelectedValues = exists ? [] : [optionValue];
      selectedValuesRef.current = nextSelectedValues;
      setSelectedValues(nextSelectedValues);
      restoreInputFocus();
      return;
    }
    const nextSelectedValues = exists
      ? selectedValues.filter((selected) => String(selected) !== String(optionValue))
      : [...selectedValues, optionValue];
    selectedValuesRef.current = nextSelectedValues;
    setSelectedValues(nextSelectedValues);
    restoreInputFocus();
  }

  function createOption() {
    const nextValue = draft.trim();
    if (!nextValue) return;
    const nextOptions = [
      ...localOptionsRef.current,
      { value: nextValue, label: nextValue, color: null, originValue: null },
    ];
    localOptionsRef.current = nextOptions;
    setLocalOptions(nextOptions);
    const nextSelectedValues = mode === "single" ? [nextValue] : [...selectedValuesRef.current, nextValue];
    selectedValuesRef.current = nextSelectedValues;
    setSelectedValues(nextSelectedValues);
    setDraft("");
    restoreInputFocus();
  }

  function beginEdit(option: DraftOptionView) {
    setEditing({ value: option.value, label: option.label });
  }

  function applyRename() {
    if (!editing) return;
    const nextValue = editing.label.trim();
    if (!nextValue || nextValue === editing.value || localOptions.some((option) => option.value === nextValue && option.value !== editing.value)) {
      setEditing(null);
      return;
    }
    const nextOptions = localOptionsRef.current.map((option) => option.value === editing.value ? { ...option, value: nextValue, label: nextValue } : option);
    localOptionsRef.current = nextOptions;
    setLocalOptions(nextOptions);
    const nextSelectedValues = selectedValuesRef.current.map((item) => String(item) === editing.value ? castLike(item, nextValue) : item);
    selectedValuesRef.current = nextSelectedValues;
    setSelectedValues(nextSelectedValues);
    setEditing(null);
    restoreInputFocus();
  }

  function removeOption(optionValue: string) {
    const nextOptions = localOptionsRef.current.filter((option) => option.value !== optionValue);
    localOptionsRef.current = nextOptions;
    setLocalOptions(nextOptions);
    const nextSelectedValues = selectedValuesRef.current.filter((item) => String(item) !== optionValue);
    selectedValuesRef.current = nextSelectedValues;
    setSelectedValues(nextSelectedValues);
    setEditing(null);
  }

  function applyColor(optionValue: string, color: MultiSelectOptionColor) {
    const nextOptions = localOptionsRef.current.map((option) => option.value === optionValue ? { ...option, color: color === "default" ? null : color } : option);
    localOptionsRef.current = nextOptions;
    setLocalOptions(nextOptions);
  }

  function commitDraftAndClose() {
    const patch = buildDraftCommit(initialSessionRef.current, localOptionsRef.current, selectedValuesRef.current);
    openRef.current = false;
    settledCloseRef.current = true;
    setOpen(false);
    setDraft("");
    setEditing(null);
    if (patch.valueChanged || patch.optionsChanged || patch.orderChanged) {
      const committedSession = buildDraftSession(patch.nextSelectedValues, patch.nextOptions);
      initialSessionRef.current = committedSession;
      sessionCommitRef.current(patch);
      return;
    }
    syncFromCommittedProps();
  }

  function cancelDraftAndClose() {
    openRef.current = false;
    settledCloseRef.current = true;
    setOpen(false);
    syncFromCommittedProps();
  }

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      closeIntentRef.current = "commit";
      openRef.current = true;
      settledCloseRef.current = false;
      sessionCommitRef.current = onCommitDraft;
      resetSession(buildDraftSession(value, options));
      setOpen(true);
      return;
    }
    const nextIntent = closeIntentRef.current;
    closeIntentRef.current = "commit";
      if (nextIntent === "cancel") {
      cancelDraftAndClose();
      return;
    }
    commitDraftAndClose();
  }

  useEffect(() => () => {
    if (!openRef.current || settledCloseRef.current || closeIntentRef.current === "cancel" || !sessionDirtyRef.current) return;
    const patch = buildDraftCommit(initialSessionRef.current, localOptionsRef.current, selectedValuesRef.current);
    if (!patch.valueChanged && !patch.optionsChanged && !patch.orderChanged) return;
    sessionCommitRef.current(patch);
  }, []);

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
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
            {selectedValues.length === 0 && !placeholder ? <span aria-hidden="true" className="select-empty-hitbox" /> : null}
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
          collisionPadding={12}
          onEscapeKeyDown={() => {
            closeIntentRef.current = "cancel";
          }}
          onInteractOutside={(event) => {
            const target = event.target;
            if (target instanceof HTMLElement && target.closest(".multi-select-option-editor")) event.preventDefault();
          }}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            focusSearchInputOnOpen();
          }}
          ref={popoverContentRef}
          sideOffset={6}
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
                  <span aria-hidden="true" className="selected-chip-remove"><icons.close size={12} strokeWidth={2.4} /></span>
                </button>
              );
            })}
            <input
              className="multi-select-input"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (canCreate) createOption();
                }
              }}
              placeholder="选择或创建一个选项"
              ref={inputRef}
              value={draft}
            />
          </div>
          <div className="multi-select-options option-field-popover-section option-field-popover-section-scroll">
            {renderedOptions.map((option, index) => {
              const selected = selectedValues.some((item) => String(item) === option.value);
              const row = (
                <div
                  className={`multi-select-option-row ${selected ? " selected" : ""}`}
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
                      handleDragStart(option.value, event);
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
                      <Popover.Content className="multi-select-option-editor" align="start" collisionPadding={12} side="right" sideOffset={10}>
                        <div className="multi-select-option-editor-header">
                          <input
                            className="multi-select-option-name-input"
                            onChange={(event) => setEditing({ value: option.value, label: event.target.value })}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                applyRename();
                              }
                            }}
                            ref={renameInputRef}
                            value={editing?.value === option.value ? editing.label : option.label}
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
                          {(() => {
                            const active = (option.color ?? "default") === defaultColorChoice.value;
                            const palette = namedChipPalette[defaultColorChoice.value];
                            return (
                              <button
                                className={`multi-select-color-item ${active ? "active" : ""}`}
                                data-color-choice={defaultColorChoice.value}
                                key={defaultColorChoice.value}
                                onPointerDown={(event) => {
                                  event.preventDefault();
                                  applyColor(option.value, defaultColorChoice.value);
                                }}
                                type="button"
                              >
                                <span className="multi-select-color-swatch" style={{ background: palette.background, borderColor: palette.swatchBorder ?? "transparent" }} />
                                <span>{defaultColorChoice.label}</span>
                                {active ? <icons.check size={16} /> : <span className="multi-select-color-check-placeholder" />}
                              </button>
                            );
                          })()}
                        </div>
                        <div className="multi-select-color-columns">
                          {colorChoiceGroups.map((group) => (
                            <div className="multi-select-color-group" data-color-group={group.key} key={group.key}>
                              <div className="multi-select-color-group-title">{group.label}</div>
                              <div className="multi-select-color-list">
                                {group.choices.map((choice) => {
                                  const active = (option.color ?? "default") === choice.value;
                                  const palette = namedChipPalette[choice.value];
                                  return (
                                    <button
                                      className={`multi-select-color-item ${active ? "active" : ""}`}
                                      data-color-choice={choice.value}
                                      key={choice.value}
                                      onPointerDown={(event) => {
                                        event.preventDefault();
                                        applyColor(option.value, choice.value);
                                      }}
                                      type="button"
                                    >
                                      <span className="multi-select-color-swatch" style={{ background: palette.background, borderColor: palette.swatchBorder ?? "transparent" }} />
                                      <span>{choice.label}</span>
                                      {active ? <icons.check size={16} /> : <span className="multi-select-color-check-placeholder" />}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      </Popover.Content>
                    </Popover.Portal>
                  </Popover.Root>
                </div>
              );
              if (dragPreview?.dropIndex === index) {
                return (
                  <Fragment key={`placeholder-before-${option.value}`}>
                    <div className="option-field-drag-placeholder" style={{ minHeight: dragPreview.ghostHeight }} />
                    {row}
                  </Fragment>
                );
              }
              return row;
            })}
            {dragPreview?.dropIndex === renderedOptions.length ? (
              <div className="option-field-drag-placeholder" style={{ minHeight: dragPreview.ghostHeight }} />
            ) : null}
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
          {dragPreview && draggingValue ? (
            <div
              className="option-field-drag-ghost"
              style={{
                left: dragPreview.ghostLeft - (popoverContentRef.current?.getBoundingClientRect().left ?? 0),
                minHeight: dragPreview.ghostHeight,
                top: dragPreview.ghostTop - (popoverContentRef.current?.getBoundingClientRect().top ?? 0),
                width: dragPreview.ghostWidth,
              }}
            >
              {(() => {
                const option = localOptions.find((candidate) => candidate.value === draggingValue);
                const selected = selectedValues.some((item) => String(item) === draggingValue);
                if (!option) return null;
                return (
                  <>
                    <span className="option-field-drag-ghost-handle"><icons.dragHandle size={14} /></span>
                    <span className={`multi-select-option ${selected ? "selected" : ""}`}>
                      <span className="chip" style={chipStyleForValue(option.value, option.color)}>{option.label}</span>
                    </span>
                    <span className="option-field-drag-ghost-menu"><icons.more size={16} /></span>
                  </>
                );
              })()}
            </div>
          ) : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function buildDraftSession(value: Array<string | number>, options: MultiSelectOptionView[]): DraftSessionSnapshot {
  const normalizedOptions = buildDraftOptions(value, options);
  return {
    options: normalizedOptions,
    selectedValues: sortValuesByOptionOrder(value, normalizedOptions.map((option) => option.value)),
  };
}

function buildDraftOptions(value: Array<string | number>, options: MultiSelectOptionView[]) {
  const unique = new Map<string, DraftOptionView>();
  for (const option of options) {
    unique.set(option.value, { ...option, originValue: option.value });
  }
  for (const optionValue of value) {
    const key = String(optionValue);
    if (!unique.has(key)) unique.set(key, { value: key, label: key, color: null, originValue: key });
  }
  return [...unique.values()];
}

function buildDraftCommit(
  initialSession: DraftSessionSnapshot,
  currentOptions: DraftOptionView[],
  currentSelectedValues: Array<string | number>,
): OptionFieldDraftCommit {
  const nextOptions = currentOptions.map(({ originValue: _originValue, ...option }) => option);
  const nextOptionOrder = nextOptions.map((option) => option.value);
  const nextSelectedValues = sortValuesByOptionOrder(currentSelectedValues, nextOptionOrder);
  const createdOptionValues = currentOptions
    .filter((option) => option.originValue == null)
    .map((option) => option.value);
  const remainingOrigins = new Set(currentOptions.flatMap((option) => option.originValue == null ? [] : [option.originValue]));
  const deletedOptionValues = initialSession.options
    .map((option) => option.originValue ?? option.value)
    .filter((originValue, index, values) => values.indexOf(originValue) === index && !remainingOrigins.has(originValue));
  const renamedOptions = currentOptions
    .filter((option) => option.originValue != null && option.originValue !== option.value)
    .map((option) => ({ previousValue: option.originValue!, nextValue: option.value }));
  const initialOptionOrder = initialSession.options.map((option) => option.value);
  return {
    createdOptionValues,
    deletedOptionValues,
    nextOptionOrder,
    nextOptions,
    nextSelectedValues,
    optionsChanged: !sameOptionMetaSnapshot(nextOptions, initialSession.options),
    orderChanged: !sameStringArray(nextOptionOrder, initialOptionOrder),
    renamedOptions,
    valueChanged: !sameSelectedValues(nextSelectedValues, initialSession.selectedValues),
  };
}

function castLike(previousValue: string | number, nextValue: string) {
  if (typeof previousValue === "number" && /^-?\d+(\.\d+)?$/.test(nextValue)) return Number(nextValue);
  return nextValue;
}

function sameOptionMetaSnapshot(left: MultiSelectOptionView[], right: Array<MultiSelectOptionView | DraftOptionView>) {
  return left.length === right.length && left.every((option, index) => {
    const candidate = right[index];
    return candidate
      && option.value === candidate.value
      && option.label === candidate.label
      && option.color === candidate.color;
  });
}

function sameDraftOptionSnapshot(left: DraftOptionView[], right: DraftOptionView[]) {
  return left.length === right.length && left.every((option, index) => {
    const candidate = right[index];
    return candidate
      && option.originValue === candidate.originValue
      && option.value === candidate.value
      && option.label === candidate.label
      && option.color === candidate.color;
  });
}

function sameSelectedValues(left: Array<string | number>, right: Array<string | number>) {
  return left.length === right.length && left.every((value, index) => String(value) === String(right[index]));
}

function sameStringArray(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
