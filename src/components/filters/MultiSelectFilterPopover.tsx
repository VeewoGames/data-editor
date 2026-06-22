import * as Select from "@radix-ui/react-select";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FilterGroup, FilterOperator, FilterRule } from "../../api/client";
import type { MultiSelectOptionView } from "../../model/viewConfig";
import { focusWithoutScroll } from "../../editing/focus-without-scroll.mjs";
import { chipStyleForValue } from "../../table/chipColors";
import { confirmNextSelectedValues, resolveDefaultCandidate, resolveEnterAction } from "../../table/discrete-value-picker.mjs";
import { removeNodeFromFilters, replaceNodeInFilters } from "../../view/filter-tree.mjs";
import { icons } from "../icons";
import { discreteOperatorOptions, filterOptions, mergeSelectedOptions, normalizeSelectedValues, optionForValue } from "./filter-rule-ui";
import { FilterActionMenu } from "./FilterActionMenu";

export type CreateFilterOptionInput = {
  field: string;
  fieldType: "Select" | "Multi-select";
  options: MultiSelectOptionView[];
  value: string;
};

type MultiSelectFilterPopoverProps = {
  filters: FilterGroup;
  rule: FilterRule;
  fieldType: "Select" | "Multi-select" | "Relation";
  options: MultiSelectOptionView[];
  mode?: "single" | "multi";
  cachedValues?: string[] | null;
  onCachedValuesChange?: (values: string[] | null) => void;
  onCreateFormalOption?: (input: CreateFilterOptionInput) => Promise<MultiSelectOptionView[]>;
  onMergeIntoAdvanced?: (() => void) | null;
  onChangeFilters: (filters: FilterGroup) => void;
};

export function MultiSelectFilterPopover({
  filters,
  rule,
  fieldType,
  options,
  mode = "multi",
  cachedValues = null,
  onCachedValuesChange,
  onCreateFormalOption,
  onMergeIntoAdvanced = null,
  onChangeFilters,
}: MultiSelectFilterPopoverProps) {
  const [search, setSearch] = useState("");
  const [localOptionsOverride, setLocalOptionsOverride] = useState<MultiSelectOptionView[] | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const activeOperator = discreteOperatorOptions.some((item) => item.value === rule.operator) ? rule.operator : "contains";
  const operatorConfig = discreteOperatorOptions.find((item) => item.value === activeOperator) ?? discreteOperatorOptions[0];
  const selectedValues = normalizeSelectedValues(rule.value);
  const baseOptions = localOptionsOverride ?? options;
  const visibleOptions = useMemo(() => mergeSelectedOptions(baseOptions, selectedValues), [baseOptions, selectedValues]);
  const filteredOptions = useMemo(() => filterOptions(visibleOptions, search), [search, visibleOptions]);
  const defaultCandidate = useMemo(
    () => resolveDefaultCandidate({ filteredOptions, selectedValues, mode }),
    [filteredOptions, mode, selectedValues],
  );

  useEffect(() => {
    setLocalOptionsOverride(null);
  }, [options, rule.field]);

  function focusSearchInput() {
    queueMicrotask(() => focusWithoutScroll(inputRef.current));
  }

  function updateRule(nextRule: FilterRule) {
    onChangeFilters(replaceRule(filters, nextRule));
  }

  function rememberValues(values: string[]) {
    onCachedValuesChange?.(values.length ? values : null);
  }

  function deleteRule() {
    onCachedValuesChange?.(null);
    onChangeFilters(removeRule(filters, rule.id));
  }

  function toggleValue(value: string) {
    const exists = selectedValues.includes(value);
    const nextValues = mode === "single"
      ? (exists ? [] : [value])
      : (exists ? selectedValues.filter((item) => item !== value) : [...selectedValues, value]);
    rememberValues(nextValues);
    updateRule({ ...rule, operator: activeOperator, value: nextValues });
  }

  function confirmValue(value: string) {
    const nextValues = confirmNextSelectedValues({
      mode,
      selectedValues,
      value,
    });
    rememberValues(nextValues);
    updateRule({ ...rule, operator: activeOperator, value: nextValues });
    setSearch("");
    focusSearchInput();
  }

  async function handleEnter() {
    const action = resolveEnterAction({
      search,
      defaultCandidate,
      allowCreate: fieldType === "Select" || fieldType === "Multi-select",
    });
    if (action.type === "select") {
      confirmValue(action.value);
      return;
    }
    if (action.type === "create" && onCreateFormalOption) {
      const nextOptions = await onCreateFormalOption({
        field: rule.field,
        fieldType,
        options: baseOptions,
        value: action.value,
      });
      setLocalOptionsOverride(nextOptions);
      confirmValue(action.value);
    }
  }

  function switchOperator(nextValue: string) {
    const operator = nextValue as FilterOperator;
    const nextConfig = discreteOperatorOptions.find((item) => item.value === operator) ?? discreteOperatorOptions[0];
    if (!nextConfig.needsValue) {
      rememberValues(selectedValues);
      updateRule({ kind: "rule", id: rule.id, field: rule.field, operator });
      return;
    }
    const restoredValues = cachedValues ?? selectedValues;
    updateRule({ ...rule, operator, value: restoredValues });
  }

  return (
    <div className="filter-popover filter-popover-shell">
      <div className="filter-popover-header">
        <strong>{rule.field}</strong>
        <FilterActionMenu onDelete={deleteRule} onMergeIntoAdvanced={onMergeIntoAdvanced} />
      </div>
      <div className="filter-popover-section">
        <label className="filter-field-label">
          <span>条件</span>
          <Select.Root value={activeOperator} onValueChange={switchOperator}>
            <Select.Trigger className="select-trigger filter-select-trigger" aria-label="筛选条件">
              <Select.Value />
              <Select.Icon asChild><icons.chevronDown size={16} /></Select.Icon>
            </Select.Trigger>
            <Select.Portal>
              <Select.Content className="menu-content select-content filter-select-content" position="popper" sideOffset={6}>
                <Select.Viewport>
                  {discreteOperatorOptions.map((operator) => (
                    <Select.Item className="menu-item" data-filter-operator={operator.value} key={operator.value} value={operator.value}>
                      <Select.ItemText>{operator.label}</Select.ItemText>
                    </Select.Item>
                  ))}
                </Select.Viewport>
              </Select.Content>
            </Select.Portal>
          </Select.Root>
        </label>
      </div>
      {operatorConfig.needsValue ? (
        <>
          <div className="filter-popover-section filter-option-value-area">
            <div className="filter-selected-chip-list" aria-label="已选值">
              {selectedValues.map((value) => {
                const option = optionForValue(visibleOptions, value);
                return (
                  <span className="selected-chip" key={value} style={chipStyleForValue(value, option?.color ?? null)}>
                    <span>{option?.label ?? value}</span>
                    <button
                      className="selected-chip-remove"
                      aria-label={`移除 ${option?.label ?? value}`}
                      onClick={() => toggleValue(value)}
                      type="button"
                    >
                      <icons.close aria-hidden="true" size={12} strokeWidth={2.4} />
                    </button>
                  </span>
                );
              })}
              <input
                className="multi-select-input filter-option-search-input"
                ref={inputRef}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  void handleEnter();
                }}
                placeholder="搜索选项"
              />
            </div>
          </div>
          <div className="filter-popover-section filter-popover-section-scroll">
            <div className="filter-option-list">
              {filteredOptions.length ? filteredOptions.map((option) => {
                const selected = selectedValues.includes(option.value);
                const defaultSelected = defaultCandidate?.value === option.value;
                return (
                  <label className={`filter-option-row${selected ? " selected" : ""}${defaultSelected ? " default-candidate" : ""}`} data-filter-option-value={option.value} key={option.value}>
                    <input
                      className="filter-option-checkbox"
                      type="checkbox"
                      checked={selected}
                      onChange={() => {
                        if (selected) {
                          toggleValue(option.value);
                          return;
                        }
                        confirmValue(option.value);
                      }}
                    />
                    <span className="chip filter-option-label" style={chipStyleForValue(option.value, option.color)}>
                      {option.label}
                    </span>
                  </label>
                );
              }) : <div className="filter-empty-hint">未找到匹配项</div>}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function replaceRule(filters: FilterGroup, nextRule: FilterRule): FilterGroup {
  return replaceNodeInFilters(filters, nextRule);
}

function removeRule(filters: FilterGroup, ruleId: string): FilterGroup {
  return removeNodeFromFilters(filters, ruleId);
}

