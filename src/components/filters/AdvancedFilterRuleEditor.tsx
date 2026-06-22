import * as Popover from "@radix-ui/react-popover";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FilterGroup, FilterOperator, FilterRule } from "../../api/client";
import type { FieldDisplayType } from "../../model/fieldTypes";
import type { FieldViewConfig, MultiSelectOptionView } from "../../model/viewConfig";
import { focusWithoutScroll } from "../../editing/focus-without-scroll.mjs";
import { chipStyleForValue } from "../../table/chipColors";
import { confirmNextSelectedValues, resolveDefaultCandidate, resolveEnterAction } from "../../table/discrete-value-picker.mjs";
import { duplicateNodeInAdvancedRoot, replaceNodeInFilters, removeNodeFromFilters, convertRuleToGroup } from "../../view/filter-tree.mjs";
import { icons } from "../icons";
import { AdvancedFilterNodeMenu } from "./AdvancedFilterNodeMenu";
import { AdvancedFilterSelect } from "./AdvancedFilterSelect";
import type { CreateFilterOptionInput } from "./MultiSelectFilterPopover";
import {
  checkboxOperatorOptions,
  discreteOperatorOptions,
  filterOptions,
  mergeSelectedOptions,
  normalizeSelectedValues,
  optionForValue,
  optionsForField,
  resolveFieldType,
  textOperatorOptions,
} from "./filter-rule-ui";

type AdvancedFilterRuleEditorProps = {
  filters: FilterGroup;
  rule: FilterRule;
  fields: string[];
  displayTypes: Record<string, FieldDisplayType>;
  fieldViewConfigs: Record<string, FieldViewConfig>;
  fieldTypes: Record<string, FieldDisplayType>;
  relationFilterOptions: Record<string, MultiSelectOptionView[]>;
  onCreateFormalOption?: (input: CreateFilterOptionInput) => Promise<MultiSelectOptionView[]>;
  onChangeFilters: (filters: FilterGroup) => void;
};

export function AdvancedFilterRuleEditor({
  filters,
  rule,
  fields,
  displayTypes,
  fieldViewConfigs,
  fieldTypes,
  relationFilterOptions,
  onCreateFormalOption,
  onChangeFilters,
}: AdvancedFilterRuleEditorProps) {
  const [search, setSearch] = useState("");
  const [localOptionsOverride, setLocalOptionsOverride] = useState<MultiSelectOptionView[] | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const fieldType = resolveFieldType(rule.field, displayTypes, fieldViewConfigs, fieldTypes);
  const operatorOptions = operatorsForFieldType(fieldType);
  const fieldOptions = fields.map((field) => ({
    value: field,
    label: field,
    fieldType: resolveFieldType(field, displayTypes, fieldViewConfigs, fieldTypes),
  }));
  const normalizedOperatorOptions = operatorOptions.map((option) => ({
    value: option.value,
    label: option.label,
  }));
  const supportsDiscreteValues = fieldType === "Multi-select" || fieldType === "Select" || fieldType === "Relation";
  const supportsBooleanValue = fieldType === "Checkbox";
  const valueless = rule.operator === "is_empty" || rule.operator === "is_not_empty";
  const selectedValues = normalizeSelectedValues(rule.value);
  const sourceOptions = useMemo(
    () => optionsForField(rule.field, fieldType, fieldViewConfigs, relationFilterOptions),
    [fieldType, fieldViewConfigs, relationFilterOptions, rule.field],
  );
  const baseOptions = localOptionsOverride ?? sourceOptions;
  const visibleOptions = useMemo(
    () => mergeSelectedOptions(baseOptions, selectedValues),
    [baseOptions, selectedValues],
  );
  const filteredOptions = useMemo(() => filterOptions(visibleOptions, search), [visibleOptions, search]);
  const defaultCandidate = useMemo(
    () => resolveDefaultCandidate({ filteredOptions, selectedValues, mode: "multi" }),
    [filteredOptions, selectedValues],
  );

  useEffect(() => {
    setLocalOptionsOverride(null);
  }, [fieldType, rule.field, sourceOptions]);

  function focusSearchInput() {
    queueMicrotask(() => focusWithoutScroll(inputRef.current));
  }

  function updateRule(nextRule: FilterRule) {
    onChangeFilters(replaceNodeInFilters(filters, nextRule));
  }

  function handleFieldChange(nextField: string) {
    const nextFieldType = resolveFieldType(nextField, displayTypes, fieldViewConfigs, fieldTypes);
    updateRule(defaultRuleForField(rule.id, nextField, nextFieldType));
  }

  function handleOperatorChange(nextOperator: string) {
    const operator = nextOperator as FilterOperator;
    if (operator === "is_empty" || operator === "is_not_empty") {
      updateRule({ kind: "rule", id: rule.id, field: rule.field, operator });
      return;
    }
    if (supportsBooleanValue) {
      updateRule({ ...rule, operator, value: typeof rule.value === "boolean" ? rule.value : true });
      return;
    }
    if (supportsDiscreteValues) {
      updateRule({ ...rule, operator, value: selectedValues });
      return;
    }
    updateRule({ ...rule, operator, value: stringValue(rule.value) });
  }

  function toggleValue(value: string) {
    const exists = selectedValues.includes(value);
    const nextValues = exists
      ? selectedValues.filter((item) => item !== value)
      : [...selectedValues, value];
    updateRule({ ...rule, operator: discreteOperator(rule.operator), value: nextValues });
  }

  function confirmValue(value: string) {
    const nextValues = confirmNextSelectedValues({
      mode: "multi",
      selectedValues,
      value,
    });
    updateRule({ ...rule, operator: discreteOperator(rule.operator), value: nextValues });
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
    if (action.type === "create" && onCreateFormalOption && (fieldType === "Select" || fieldType === "Multi-select")) {
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

  return (
    <div className="advanced-filter-rule">
      <div className="advanced-filter-rule-main">
        <AdvancedFilterSelect
          ariaLabel="高级筛选字段"
          className="advanced-filter-control advanced-filter-field-trigger"
          contentClassName="advanced-filter-field-content"
          options={fieldOptions}
          value={rule.field}
          onValueChange={handleFieldChange}
        />
        <AdvancedFilterSelect
          ariaLabel="高级筛选条件"
          className="advanced-filter-control advanced-filter-operator-trigger"
          contentClassName="advanced-filter-operator-content"
          options={normalizedOperatorOptions}
          value={rule.operator}
          onValueChange={handleOperatorChange}
        />
        {valueless ? (
          <div className="advanced-filter-value-placeholder">无需值</div>
        ) : supportsBooleanValue ? (
          <AdvancedFilterSelect
            ariaLabel="高级筛选布尔值"
            className="advanced-filter-control advanced-filter-value-trigger"
            contentClassName="advanced-filter-boolean-content"
            options={[
              { value: "true", label: "已勾选" },
              { value: "false", label: "未勾选" },
            ]}
            value={rule.value === false ? "false" : "true"}
            onValueChange={(value) => updateRule({ ...rule, value: value === "true" })}
          />
        ) : supportsDiscreteValues ? (
          <Popover.Root>
            <Popover.Trigger asChild>
              <div className="filter-text-input advanced-filter-control advanced-filter-value-trigger" role="button" tabIndex={0}>
                <div className="advanced-filter-value-trigger-content">
                  {selectedValues.length ? (
                    selectedValues.map((value) => {
                      const option = optionForValue(visibleOptions, value);
                      return (
                        <span className="selected-chip" key={value} style={chipStyleForValue(value, option?.color ?? null)}>
                          <span>{option?.label ?? value}</span>
                          <button
                            className="selected-chip-remove"
                            aria-label={`移除 ${option?.label ?? value}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleValue(value);
                            }}
                            type="button"
                          >
                            <icons.close aria-hidden="true" size={12} strokeWidth={2.4} />
                          </button>
                        </span>
                      );
                    })
                  ) : (
                    <span className="advanced-filter-value-placeholder-inline">选择选项</span>
                  )}
                </div>
                <icons.chevronDown size={16} />
              </div>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content className="menu-content advanced-filter-value-popover" sideOffset={6} align="start">
                <div className="advanced-filter-discrete-value">
                  <div className="filter-selected-chip-list advanced-filter-selected-chip-list" aria-label="高级筛选已选值">
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
                      className="multi-select-input filter-option-search-input advanced-filter-value"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter") return;
                        event.preventDefault();
                        void handleEnter();
                      }}
                      placeholder="搜索选项"
                      ref={inputRef}
                    />
                  </div>
                  <div className="filter-option-list advanced-filter-option-list">
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
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        ) : (
          <input
            className="filter-text-input advanced-filter-control advanced-filter-value"
            value={stringValue(rule.value)}
            onChange={(event) => updateRule({ ...rule, value: event.target.value })}
            placeholder="输入筛选值"
          />
        )}
      </div>
      <div className="advanced-filter-node-actions">
        <AdvancedFilterNodeMenu
          onDelete={() => onChangeFilters(removeNodeFromFilters(filters, rule.id))}
          onDuplicate={() => onChangeFilters(duplicateNodeInAdvancedRoot(filters, rule.id))}
          onConvertToGroup={() => onChangeFilters(convertRuleToGroup(filters, rule.id))}
        />
      </div>
    </div>
  );
}

function operatorsForFieldType(fieldType: FieldDisplayType) {
  if (fieldType === "Checkbox") return checkboxOperatorOptions;
  if (fieldType === "Multi-select" || fieldType === "Select" || fieldType === "Relation") return discreteOperatorOptions;
  return textOperatorOptions;
}

function defaultRuleForField(id: string, field: string, fieldType: FieldDisplayType): FilterRule {
  if (fieldType === "Checkbox") return { kind: "rule", id, field, operator: "is", value: true };
  if (fieldType === "Multi-select" || fieldType === "Select" || fieldType === "Relation") {
    return { kind: "rule", id, field, operator: "contains", value: [] };
  }
  return { kind: "rule", id, field, operator: "contains", value: "" };
}

function stringValue(value: unknown): string {
  if (value == null || Array.isArray(value) || typeof value === "object") return "";
  return String(value);
}

function discreteOperator(operator: FilterOperator): FilterOperator {
  if (operator === "is_empty" || operator === "is_not_empty") return "contains";
  return operator;
}
