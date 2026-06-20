import * as Select from "@radix-ui/react-select";
import type { FilterGroup, FilterOperator, FilterRule } from "../../api/client";
import { removeNodeFromFilters, replaceNodeInFilters } from "../../view/filter-tree.mjs";
import { icons } from "../icons";
import { textOperatorOptions } from "./filter-rule-ui";
import { FilterActionMenu } from "./FilterActionMenu";

type TextFilterPopoverProps = {
  filters: FilterGroup;
  rule: FilterRule;
  onMergeIntoAdvanced?: (() => void) | null;
  onChangeFilters: (filters: FilterGroup) => void;
};

export function TextFilterPopover({ filters, rule, onMergeIntoAdvanced = null, onChangeFilters }: TextFilterPopoverProps) {
  const activeOperator = textOperatorOptions.some((item) => item.value === rule.operator) ? rule.operator : "contains";
  const operatorConfig = textOperatorOptions.find((item) => item.value === activeOperator) ?? textOperatorOptions[0];

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
        <FilterActionMenu onDelete={deleteRule} onMergeIntoAdvanced={onMergeIntoAdvanced} />
      </div>
      <div className="filter-popover-section">
        <label className="filter-field-label">
          <span>条件</span>
          <Select.Root
            value={activeOperator}
            onValueChange={(value) => {
              const operator = value as FilterOperator;
              const nextConfig = textOperatorOptions.find((item) => item.value === operator);
              updateRule(nextConfig?.needsValue ? { ...rule, operator, value: stringValue(rule.value) } : { kind: "rule", id: rule.id, field: rule.field, operator });
            }}
          >
            <Select.Trigger className="select-trigger filter-select-trigger" aria-label="筛选条件">
              <Select.Value />
              <Select.Icon asChild><icons.chevronDown size={16} /></Select.Icon>
            </Select.Trigger>
            <Select.Portal>
              <Select.Content className="menu-content select-content filter-select-content" position="popper" sideOffset={6}>
                <Select.Viewport>
                  {textOperatorOptions.map((operator) => (
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
  return replaceNodeInFilters(filters, nextRule);
}

function removeRule(filters: FilterGroup, ruleId: string): FilterGroup {
  return removeNodeFromFilters(filters, ruleId);
}

function stringValue(value: unknown) {
  if (value == null || Array.isArray(value) || typeof value === "object") return "";
  return String(value);
}
