import * as Select from "@radix-ui/react-select";
import { useMemo, useState } from "react";
import type { FilterGroup, FilterOperator, FilterRule } from "../../api/client";
import type { MultiSelectOptionView } from "../../model/viewConfig";
import { chipStyleForValue } from "../../table/chipColors";
import { icons } from "../icons";
import { FilterActionMenu } from "./FilterActionMenu";

type MultiSelectFilterPopoverProps = {
  filters: FilterGroup;
  rule: FilterRule;
  options: MultiSelectOptionView[];
  mode?: "single" | "multi";
  cachedValues?: string[] | null;
  onCachedValuesChange?: (values: string[] | null) => void;
  onChangeFilters: (filters: FilterGroup) => void;
};

const multiValueOperators: Array<{ value: FilterOperator; label: string; needsValue: boolean }> = [
  { value: "contains", label: "包含", needsValue: true },
  { value: "does_not_contain", label: "不包含", needsValue: true },
  { value: "is_empty", label: "为空", needsValue: false },
  { value: "is_not_empty", label: "不为空", needsValue: false },
];

export function MultiSelectFilterPopover({
  filters,
  rule,
  options,
  mode = "multi",
  cachedValues = null,
  onCachedValuesChange,
  onChangeFilters,
}: MultiSelectFilterPopoverProps) {
  const [search, setSearch] = useState("");
  const activeOperator = multiValueOperators.some((item) => item.value === rule.operator) ? rule.operator : "contains";
  const operatorConfig = multiValueOperators.find((item) => item.value === activeOperator) ?? multiValueOperators[0];
  const selectedValues = normalizeSelectedValues(rule.value);
  const visibleOptions = useMemo(() => mergeSelectedOptions(options, selectedValues), [options, selectedValues]);
  const filteredOptions = useMemo(() => filterOptions(visibleOptions, search), [search, visibleOptions]);

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

  function switchOperator(nextValue: string) {
    const operator = nextValue as FilterOperator;
    const nextConfig = multiValueOperators.find((item) => item.value === operator) ?? multiValueOperators[0];
    if (!nextConfig.needsValue) {
      rememberValues(selectedValues);
      updateRule({ id: rule.id, field: rule.field, operator });
      return;
    }
    const restoredValues = cachedValues ?? selectedValues;
    updateRule({ ...rule, operator, value: restoredValues });
  }

  return (
    <div className="filter-popover filter-popover-shell">
      <div className="filter-popover-header">
        <strong>{rule.field}</strong>
        <FilterActionMenu onDelete={deleteRule} />
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
                  {multiValueOperators.map((operator) => (
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
                      x
                    </button>
                  </span>
                );
              })}
              <input
                className="multi-select-input filter-option-search-input"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索选项"
              />
            </div>
          </div>
          <div className="filter-popover-section filter-popover-section-scroll">
            <div className="filter-option-list">
              {filteredOptions.length ? filteredOptions.map((option) => {
                const selected = selectedValues.includes(option.value);
                return (
                  <label className={`filter-option-row${selected ? " selected" : ""}`} data-filter-option-value={option.value} key={option.value}>
                    <input
                      className="filter-option-checkbox"
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleValue(option.value)}
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
  return {
    op: "and",
    rules: filters.rules.map((item) => item.id === nextRule.id ? nextRule : item),
  };
}

function removeRule(filters: FilterGroup, ruleId: string): FilterGroup {
  return {
    op: "and",
    rules: filters.rules.filter((item) => item.id !== ruleId),
  };
}

function normalizeSelectedValues(value: unknown) {
  if (!Array.isArray(value)) return value == null || value === "" ? [] : [String(value)];
  return value.map((item) => String(item));
}

function mergeSelectedOptions(options: MultiSelectOptionView[], selectedValues: string[]) {
  const optionByValue = new Map(options.map((option) => [option.value, option]));
  for (const value of selectedValues) {
    if (!optionByValue.has(value)) optionByValue.set(value, { value, label: value, color: null });
  }
  return [...optionByValue.values()];
}

function filterOptions(options: MultiSelectOptionView[], search: string) {
  const needle = search.trim().toLowerCase();
  if (!needle) return options;
  return options.filter((option) => option.label.toLowerCase().includes(needle) || option.value.toLowerCase().includes(needle));
}

function optionForValue(options: MultiSelectOptionView[], value: string) {
  return options.find((option) => option.value === value);
}
