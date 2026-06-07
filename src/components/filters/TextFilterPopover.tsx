import * as Select from "@radix-ui/react-select";
import type { FilterGroup, FilterOperator, FilterRule } from "../../api/client";
import { icons } from "../icons";
import { FilterActionMenu } from "./FilterActionMenu";

type TextFilterPopoverProps = {
  filters: FilterGroup;
  rule: FilterRule;
  onChangeFilters: (filters: FilterGroup) => void;
};

const textOperators: Array<{ value: FilterOperator; label: string; needsValue: boolean }> = [
  { value: "contains", label: "包含", needsValue: true },
  { value: "does_not_contain", label: "不包含", needsValue: true },
  { value: "is", label: "等于", needsValue: true },
  { value: "is_not", label: "不等于", needsValue: true },
  { value: "is_empty", label: "为空", needsValue: false },
  { value: "is_not_empty", label: "不为空", needsValue: false },
];

export function TextFilterPopover({ filters, rule, onChangeFilters }: TextFilterPopoverProps) {
  const activeOperator = textOperators.some((item) => item.value === rule.operator) ? rule.operator : "contains";
  const operatorConfig = textOperators.find((item) => item.value === activeOperator) ?? textOperators[0];

  function updateRule(nextRule: FilterRule) {
    onChangeFilters(replaceRule(filters, nextRule));
  }

  function deleteRule() {
    onChangeFilters(removeRule(filters, rule.id));
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
          <Select.Root
            value={activeOperator}
            onValueChange={(value) => {
              const operator = value as FilterOperator;
              const nextConfig = textOperators.find((item) => item.value === operator);
              updateRule(nextConfig?.needsValue ? { ...rule, operator, value: stringValue(rule.value) } : { id: rule.id, field: rule.field, operator });
            }}
          >
            <Select.Trigger className="select-trigger filter-select-trigger" aria-label="筛选条件">
              <Select.Value />
              <Select.Icon asChild><icons.chevronDown size={16} /></Select.Icon>
            </Select.Trigger>
            <Select.Portal>
              <Select.Content className="menu-content select-content filter-select-content" position="popper" sideOffset={6}>
                <Select.Viewport>
                  {textOperators.map((operator) => (
                    <Select.Item className="menu-item" key={operator.value} value={operator.value}>
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
        <div className="filter-popover-section">
          <label className="filter-field-label">
            <span>文本</span>
            <input
              className="filter-text-input"
              value={stringValue(rule.value)}
              onChange={(event) => updateRule({ ...rule, operator: activeOperator, value: event.target.value })}
              placeholder="输入筛选文本"
            />
          </label>
        </div>
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

function stringValue(value: unknown) {
  if (value == null || Array.isArray(value) || typeof value === "object") return "";
  return String(value);
}
