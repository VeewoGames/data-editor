import * as Select from "@radix-ui/react-select";
import type { FilterGroup, FilterOperator, FilterRule } from "../../api/client";
import type { MultiSelectOptionView } from "../../model/viewConfig";
import { FilterActionMenu } from "./FilterActionMenu";

type MultiSelectFilterPopoverProps = {
  filters: FilterGroup;
  rule: FilterRule;
  options: MultiSelectOptionView[];
  onChangeFilters: (filters: FilterGroup) => void;
};

const multiValueOperators: Array<{ value: FilterOperator; label: string; needsValue: boolean }> = [
  { value: "contains", label: "包含任一", needsValue: true },
  { value: "does_not_contain", label: "不包含", needsValue: true },
  { value: "is_empty", label: "为空", needsValue: false },
  { value: "is_not_empty", label: "不为空", needsValue: false },
];

export function MultiSelectFilterPopover({ filters, rule, options, onChangeFilters }: MultiSelectFilterPopoverProps) {
  const activeOperator = multiValueOperators.some((item) => item.value === rule.operator) ? rule.operator : "contains";
  const operatorConfig = multiValueOperators.find((item) => item.value === activeOperator) ?? multiValueOperators[0];
  const selectedValues = normalizeSelectedValues(rule.value);
  const visibleOptions = mergeSelectedOptions(options, selectedValues);

  function updateRule(nextRule: FilterRule) {
    onChangeFilters(replaceRule(filters, nextRule));
  }

  function deleteRule() {
    onChangeFilters(removeRule(filters, rule.id));
  }

  function toggleValue(value: string) {
    const nextValues = selectedValues.includes(value)
      ? selectedValues.filter((item) => item !== value)
      : [...selectedValues, value];
    updateRule({ ...rule, operator: activeOperator, value: nextValues });
  }

  return (
    <div className="filter-popover">
      <div className="filter-popover-header">
        <strong>{rule.field}</strong>
        <FilterActionMenu onDelete={deleteRule} />
      </div>
      <label className="filter-field-label">
        <span>条件</span>
        <Select.Root
          value={activeOperator}
          onValueChange={(value) => {
            const operator = value as FilterOperator;
            const nextConfig = multiValueOperators.find((item) => item.value === operator);
            updateRule(nextConfig?.needsValue ? { ...rule, operator, value: selectedValues } : { id: rule.id, field: rule.field, operator });
          }}
        >
          <Select.Trigger className="select-trigger filter-select-trigger" aria-label="筛选条件">
            <Select.Value />
            <Select.Icon />
          </Select.Trigger>
          <Select.Portal>
            <Select.Content className="menu-content select-content filter-select-content" position="popper" sideOffset={6}>
              <Select.Viewport>
                {multiValueOperators.map((operator) => (
                  <Select.Item className="menu-item" key={operator.value} value={operator.value}>
                    <Select.ItemText>{operator.label}</Select.ItemText>
                  </Select.Item>
                ))}
              </Select.Viewport>
            </Select.Content>
          </Select.Portal>
        </Select.Root>
      </label>
      {operatorConfig.needsValue ? (
        <>
          <div className="filter-selected-tags" aria-label="已选值">
            {selectedValues.length ? selectedValues.map((value) => (
              <span className="chip" key={value}>{labelForValue(visibleOptions, value)}</span>
            )) : <span className="filter-empty-hint">未选择</span>}
          </div>
          <div className="filter-checkbox-list">
            {visibleOptions.length ? visibleOptions.map((option) => (
              <label className="filter-checkbox-item" key={option.value}>
                <input
                  type="checkbox"
                  checked={selectedValues.includes(option.value)}
                  onChange={() => toggleValue(option.value)}
                />
                <span>{option.label}</span>
              </label>
            )) : <div className="filter-empty-hint">暂无可选值</div>}
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
  const knownValues = new Set(options.map((option) => option.value));
  return [
    ...options,
    ...selectedValues.filter((value) => !knownValues.has(value)).map((value) => ({ value, label: value, color: null })),
  ];
}

function labelForValue(options: MultiSelectOptionView[], value: string) {
  return options.find((option) => option.value === value)?.label ?? value;
}
