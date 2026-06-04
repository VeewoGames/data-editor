import * as Popover from "@radix-ui/react-popover";
import { useState } from "react";
import type { CollectionView, FilterGroup, FilterRule, SortRule } from "../api/client";
import type { FieldConfig } from "../table/DataTable";
import type { FieldDisplayType } from "../model/fieldTypes";
import type { FieldViewConfig, MultiSelectOptionView } from "../model/viewConfig";
import { icons } from "./icons";
import { BooleanFilterPopover } from "./filters/BooleanFilterPopover";
import { MultiSelectFilterPopover } from "./filters/MultiSelectFilterPopover";
import { TextFilterPopover } from "./filters/TextFilterPopover";
import { SortPopover } from "./sort/SortPopover";

export type ViewFilterBarProps = {
  view: CollectionView | null;
  fields: string[];
  fieldConfig: FieldConfig;
  fieldViewConfigs: Record<string, FieldViewConfig>;
  fieldTypes?: Record<string, FieldDisplayType>;
  relationFilterOptions?: Record<string, MultiSelectOptionView[]>;
  dirty: boolean;
  viewOrderDirty: boolean;
  saving: boolean;
  onChangeFilters: (filters: FilterGroup) => void;
  onChangeSorts: (sorts: SortRule[]) => void;
  onResetView: () => void;
  onSaveForEveryone: () => void;
};

export function ViewFilterBar({
  view,
  fields,
  fieldConfig,
  fieldViewConfigs,
  fieldTypes = {},
  relationFilterOptions = {},
  dirty,
  viewOrderDirty,
  saving,
  onChangeFilters,
  onChangeSorts,
  onResetView,
  onSaveForEveryone,
}: ViewFilterBarProps) {
  const [addFilterOpen, setAddFilterOpen] = useState(false);

  if (!view) return null;

  const visibleFilterRules = view.filters?.rules ?? [];
  const sorts = view.sorts ?? [];
  const showSharedViewActions = !saving && (dirty || viewOrderDirty);

  function addFilter(field: string) {
    if (!view || !field) return;
    onChangeFilters(withRules(view.filters, [...visibleFilterRules, createDefaultFilterRule(field, resolveFieldType(field, fieldConfig, fieldViewConfigs, fieldTypes), visibleFilterRules)]));
    setAddFilterOpen(false);
  }

  return (
    <div className="view-filter-bar" aria-label="视图筛选">
      <Popover.Root>
        <Popover.Trigger asChild>
          <button className="ghost-button compact view-filter-sort-button" type="button">
            {sorts.length ? <icons.sortAscending size={15} /> : <icons.sortDescending size={15} />}
            排序
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content className="menu-content sort-popover-content" sideOffset={6} align="start">
            <SortPopover fields={fields} sorts={sorts} onChangeSorts={onChangeSorts} />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <Popover.Root open={addFilterOpen} onOpenChange={setAddFilterOpen}>
        <Popover.Trigger asChild>
          <button className="ghost-button compact" disabled={!fields.length} type="button">
            <icons.filter size={15} />
            + 筛选
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content className="menu-content add-filter-popover-content" sideOffset={6} align="start">
            <div className="add-filter-popover" role="menu" aria-label="选择筛选字段">
              {fields.map((field) => (
                <button className="add-filter-field-option" key={field} onClick={() => addFilter(field)} type="button" role="menuitem">
                  <span className="add-filter-field-icon">{fieldTypeIcon(resolveFieldType(field, fieldConfig, fieldViewConfigs, fieldTypes))}</span>
                  <span className="add-filter-field-name">{field}</span>
                </button>
              ))}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <div className="view-chip-list">
        {sorts.map((sort) => (
          <Popover.Root key={sort.id}>
            <Popover.Trigger asChild>
              <button className="view-filter-chip sort-chip" type="button" title={`${sort.field} ${sort.direction}`}>
                {sort.direction === "asc" ? "↑" : "↓"} {sort.field}
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content className="menu-content sort-popover-content" sideOffset={6} align="start">
                <SortPopover fields={fields} sorts={sorts} onChangeSorts={onChangeSorts} />
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        ))}
        {visibleFilterRules.map((rule) => (
          <Popover.Root key={rule.id}>
            <Popover.Trigger asChild>
              <button className="view-filter-chip filter-chip" type="button" title={filterChipTitle(rule, fieldConfig, fieldViewConfigs, fieldTypes, relationFilterOptions)}>
                <span className="filter-chip-label">{filterChipLabel(rule, fieldConfig, fieldViewConfigs, fieldTypes, relationFilterOptions)}</span>
                <icons.chevronDown className="filter-chip-chevron" size={14} />
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content className="menu-content filter-popover-content" sideOffset={6} align="start">
                {renderFilterPopover(rule, view.filters, fieldConfig, fieldViewConfigs, fieldTypes, relationFilterOptions, onChangeFilters)}
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        ))}
      </div>
      {showSharedViewActions ? (
        <div className="view-filter-actions">
          <button type="button" className="view-tab-action" onClick={onResetView}>
            重置
          </button>
          <button type="button" className="view-tab-action primary save-shared" onClick={onSaveForEveryone}>
            为所有人保存
          </button>
        </div>
      ) : null}
    </div>
  );
}

function renderFilterPopover(
  rule: FilterRule,
  filters: FilterGroup,
  fieldConfig: FieldConfig,
  fieldViewConfigs: Record<string, FieldViewConfig>,
  fieldTypes: Record<string, FieldDisplayType>,
  relationFilterOptions: Record<string, MultiSelectOptionView[]>,
  onChangeFilters: (filters: FilterGroup) => void,
) {
  const fieldType = resolveFieldType(rule.field, fieldConfig, fieldViewConfigs, fieldTypes);
  if (fieldType === "Checkbox") {
    return <BooleanFilterPopover filters={filters} rule={rule} onChangeFilters={onChangeFilters} />;
  }
  if (fieldType === "Multi-select" || fieldType === "Select" || fieldType === "Relation") {
    return (
      <MultiSelectFilterPopover
        filters={filters}
        rule={rule}
        options={optionsForField(rule.field, fieldType, fieldViewConfigs, relationFilterOptions)}
        onChangeFilters={onChangeFilters}
      />
    );
  }
  return <TextFilterPopover filters={filters} rule={rule} onChangeFilters={onChangeFilters} />;
}

function createDefaultFilterRule(field: string, fieldType: FieldDisplayType, rules: FilterRule[]): FilterRule {
  if (fieldType === "Checkbox") {
    return { id: createFilterId(field, rules), field, operator: "is" };
  }
  if (fieldType === "Multi-select" || fieldType === "Select" || fieldType === "Relation") {
    return { id: createFilterId(field, rules), field, operator: "contains", value: [] };
  }
  return { id: createFilterId(field, rules), field, operator: "contains", value: "" };
}

function withRules(filters: FilterGroup | null | undefined, rules: FilterRule[]): FilterGroup {
  return {
    op: "and",
    rules,
  };
}

function createFilterId(field: string, rules: FilterRule[]) {
  const safeField = field.replace(/\s+/g, "_");
  const baseId = `filter:${safeField}`;
  if (!rules.some((rule) => rule.id === baseId)) return baseId;
  let index = 2;
  while (rules.some((rule) => rule.id === `${baseId}:${index}`)) index += 1;
  return `${baseId}:${index}`;
}

function resolveFieldType(
  field: string,
  fieldConfig: FieldConfig,
  fieldViewConfigs: Record<string, FieldViewConfig>,
  fieldTypes: Record<string, FieldDisplayType>,
): FieldDisplayType {
  if (fieldTypes[field] === "Relation") return "Relation";
  return fieldConfig.displayTypes[field] ?? fieldTypes[field] ?? fieldViewConfigs[field]?.type ?? "Text";
}

function fieldTypeIcon(fieldType: FieldDisplayType) {
  if (fieldType === "Checkbox") return "✓";
  if (fieldType === "Multi-select" || fieldType === "Select") return "#";
  if (fieldType === "Relation") return "↗";
  return "T";
}

function optionsForField(
  field: string,
  fieldType: FieldDisplayType,
  fieldViewConfigs: Record<string, FieldViewConfig>,
  relationFilterOptions: Record<string, MultiSelectOptionView[]> = {},
): MultiSelectOptionView[] {
  if (fieldType === "Relation") {
    return relationFilterOptions[field] ?? [];
  }
  const config = fieldViewConfigs[field];
  const optionSource = fieldType === "Select" ? config?.selectOptions : config?.multiSelectOptions;
  const configuredOptions = Object.entries(optionSource ?? {}).map(([value, option]) => ({
    value,
    label: option.label,
    color: option.color,
  }));
  const optionByValue = new Map(configuredOptions.map((option) => [option.value, option]));
  for (const option of relationFilterOptions[field] ?? []) {
    if (!optionByValue.has(option.value)) optionByValue.set(option.value, option);
  }
  return [...optionByValue.values()];
}

function filterChipLabel(
  rule: FilterRule,
  fieldConfig: FieldConfig,
  fieldViewConfigs: Record<string, FieldViewConfig>,
  fieldTypes: Record<string, FieldDisplayType>,
  relationFilterOptions: Record<string, MultiSelectOptionView[]> = {},
) {
  const fieldType = resolveFieldType(rule.field, fieldConfig, fieldViewConfigs, fieldTypes);
  if (fieldType === "Checkbox") {
    const label = booleanLabel(rule);
    return label ? `${rule.field}: ${label}` : rule.field;
  }
  if (fieldType === "Multi-select" || fieldType === "Select" || fieldType === "Relation") {
    const labels = normalizeFilterValues(rule.value)
      .map((value) => optionLabel(rule.field, value, fieldType, fieldViewConfigs, relationFilterOptions));
    return labels.length ? `${rule.field}: ${truncateList(labels)}` : rule.field;
  }
  const value = textValue(rule.value);
  return value ? `${rule.field}: ${truncateText(value, 28)}` : rule.field;
}

function filterChipTitle(
  rule: FilterRule,
  fieldConfig: FieldConfig,
  fieldViewConfigs: Record<string, FieldViewConfig>,
  fieldTypes: Record<string, FieldDisplayType>,
  relationFilterOptions: Record<string, MultiSelectOptionView[]> = {},
) {
  const fieldType = resolveFieldType(rule.field, fieldConfig, fieldViewConfigs, fieldTypes);
  if (fieldType === "Checkbox") {
    const label = booleanLabel(rule);
    return label ? `${rule.field}: ${label}` : rule.field;
  }
  const values = normalizeFilterValues(rule.value);
  if (!values.length) return rule.field;
  const labels = values.map((value) => optionLabel(rule.field, value, fieldType, fieldViewConfigs, relationFilterOptions));
  return `${rule.field}: ${labels.join(", ")}`;
}

function booleanLabel(rule: FilterRule) {
  if (rule.value !== true && rule.value !== false && rule.operator !== "is_empty") return "";
  if (rule.operator === "is_empty") return "清除";
  return rule.value === false ? "未勾选" : "已勾选";
}

function normalizeFilterValues(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  if (value == null || value === "") return [];
  return [String(value)];
}

function optionLabel(
  field: string,
  value: string,
  fieldType: FieldDisplayType,
  fieldViewConfigs: Record<string, FieldViewConfig>,
  relationFilterOptions: Record<string, MultiSelectOptionView[]> = {},
) {
  return optionsForField(field, fieldType, fieldViewConfigs, relationFilterOptions).find((option) => option.value === value)?.label ?? value;
}

function truncateList(values: string[]) {
  return truncateText(values.join(", "), 24);
}

function truncateText(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function textValue(value: unknown) {
  if (value == null || Array.isArray(value) || typeof value === "object") return "";
  return String(value);
}
