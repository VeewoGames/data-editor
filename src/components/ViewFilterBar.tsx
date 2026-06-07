import * as Popover from "@radix-ui/react-popover";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CollectionView, FilterGroup, FilterRule, SortRule } from "../api/client";
import type { FieldConfig } from "../table/DataTable";
import type { FieldDisplayType } from "../model/fieldTypes";
import type { FieldViewConfig, MultiSelectOptionView } from "../model/viewConfig";
import { icons } from "./icons";
import { BooleanFilterPopover } from "./filters/BooleanFilterPopover";
import { MultiSelectFilterPopover } from "./filters/MultiSelectFilterPopover";
import { TextFilterPopover } from "./filters/TextFilterPopover";
import { SortPopover } from "./sort/SortPopover";
import { createDefaultFilterRule } from "../view/filter-rules.mjs";

export type ViewFilterBarProps = {
  collectionKey?: string | null;
  view: CollectionView | null;
  fields: string[];
  fieldConfig: FieldConfig;
  fieldViewConfigs: Record<string, FieldViewConfig>;
  fieldTypes?: Record<string, FieldDisplayType>;
  relationFilterOptions?: Record<string, MultiSelectOptionView[]>;
  dirty: boolean;
  viewOrderDirty: boolean;
  saving: boolean;
  autoOpenRuleId: string | null;
  onChangeFilters: (filters: FilterGroup) => void;
  onChangeSorts: (sorts: SortRule[]) => void;
  onAddFilter: (field: string, fieldType: FieldDisplayType) => void;
  onAutoOpenRuleHandled: () => void;
  onResetView: () => void;
  onSaveForEveryone: () => void;
};

export function ViewFilterBar({
  collectionKey = null,
  view,
  fields,
  fieldConfig,
  fieldViewConfigs,
  fieldTypes = {},
  relationFilterOptions = {},
  dirty,
  viewOrderDirty,
  saving,
  autoOpenRuleId,
  onChangeFilters,
  onChangeSorts,
  onAddFilter,
  onAutoOpenRuleHandled,
  onResetView,
  onSaveForEveryone,
}: ViewFilterBarProps) {
  const [addFilterOpen, setAddFilterOpen] = useState(false);
  const [openRuleId, setOpenRuleId] = useState<string | null>(null);
  const [openRuleRect, setOpenRuleRect] = useState<{ left: number; top: number } | null>(null);
  const handledAutoOpenRuleIdRef = useRef<string | null>(null);
  const suppressCloseRuleIdRef = useRef<string | null>(null);
  const filterChipWrapRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const recentValueCacheRef = useRef(new Map<string, string[]>());

  if (!view) return null;

  const visibleFilterRules = view.filters?.rules ?? [];
  const availableFilterFields = fields.filter((field) => !visibleFilterRules.some((rule) => rule.field === field));
  const sorts = view.sorts ?? [];
  const showSharedViewActions = !saving && (dirty || viewOrderDirty);
  const currentScopeKey = `${collectionKey ?? "__unknown_collection__"}::${view.id}`;

  useEffect(() => {
    if (!autoOpenRuleId) return;
    if (handledAutoOpenRuleIdRef.current === autoOpenRuleId) return;
    if (!visibleFilterRules.some((rule) => rule.id === autoOpenRuleId)) return;
    setAddFilterOpen(false);
    handledAutoOpenRuleIdRef.current = autoOpenRuleId;
    suppressCloseRuleIdRef.current = autoOpenRuleId;
    setOpenRuleId(autoOpenRuleId);
    window.setTimeout(() => {
      if (suppressCloseRuleIdRef.current === autoOpenRuleId) suppressCloseRuleIdRef.current = null;
    }, 0);
    onAutoOpenRuleHandled();
  }, [autoOpenRuleId, onAutoOpenRuleHandled, visibleFilterRules]);

  useEffect(() => {
    if (!openRuleId) return;
    const updateRect = () => {
      const anchor = filterChipWrapRefs.current[openRuleId];
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      setOpenRuleRect({ left: rect.left, top: rect.bottom + 6 });
    };
    updateRect();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (filterChipWrapRefs.current[openRuleId]?.contains(target)) return;
      if (target.closest(".filter-popover-content, .filter-select-content, .filter-action-menu, .add-filter-popover-content, .column-menu-popup")) return;
      setOpenRuleId(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenRuleId(null);
    };
    window.addEventListener("resize", updateRect);
    window.addEventListener("scroll", updateRect, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("resize", updateRect);
      window.removeEventListener("scroll", updateRect, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [openRuleId]);

  useEffect(() => {
    if (openRuleId) return;
    setOpenRuleRect(null);
  }, [openRuleId]);

  useEffect(() => {
    const liveRuleKeys = new Set(visibleFilterRules.map((rule) => scopedRecentValueKey(currentScopeKey, rule.id)));
    for (const key of [...recentValueCacheRef.current.keys()]) {
      if (key.startsWith(`${currentScopeKey}::`) && !liveRuleKeys.has(key)) {
        recentValueCacheRef.current.delete(key);
      }
    }
  }, [currentScopeKey, visibleFilterRules]);

  function addFilter(field: string) {
    if (!view || !field) return;
    if (visibleFilterRules.some((rule) => rule.field === field)) {
      setAddFilterOpen(false);
      return;
    }
    const fieldType = resolveFieldType(field, fieldConfig, fieldViewConfigs, fieldTypes);
    const nextRule = createDefaultFilterRule(field, fieldType, visibleFilterRules);
    suppressCloseRuleIdRef.current = nextRule.id;
    setOpenRuleId(nextRule.id);
    window.setTimeout(() => {
      if (suppressCloseRuleIdRef.current === nextRule.id) suppressCloseRuleIdRef.current = null;
    }, 0);
    onAddFilter(field, fieldType);
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
          <button className="ghost-button compact" disabled={!availableFilterFields.length} type="button">
            <icons.filter size={15} />
            + 筛选
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content className="menu-content add-filter-popover-content" sideOffset={6} align="start">
            <div className="add-filter-popover" role="menu" aria-label="选择筛选字段">
              {availableFilterFields.map((field) => (
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
          <div className="filter-chip-wrap" key={rule.id} ref={(node) => { filterChipWrapRefs.current[rule.id] = node; }}>
            <button
              className="view-filter-chip filter-chip"
              type="button"
              title={filterChipTitle(rule, fieldConfig, fieldViewConfigs, fieldTypes, relationFilterOptions)}
              onClick={() => {
                if (suppressCloseRuleIdRef.current === rule.id) return;
                setOpenRuleId((current) => current === rule.id ? null : rule.id);
              }}
            >
              <span className="filter-chip-label">{filterChipLabel(rule, fieldConfig, fieldViewConfigs, fieldTypes, relationFilterOptions)}</span>
              <icons.chevronDown className="filter-chip-chevron" size={14} />
            </button>
            {openRuleId === rule.id && openRuleRect && typeof document !== "undefined"
              ? createPortal(
                <div
                  className="menu-content filter-popover-content filter-popover-inline"
                  style={{ left: `${openRuleRect.left}px`, top: `${openRuleRect.top}px` }}
                >
                  {renderFilterPopover(
                    rule,
                    view.filters,
                    fieldConfig,
                    fieldViewConfigs,
                    fieldTypes,
                    relationFilterOptions,
                    recentValueCacheRef.current.get(scopedRecentValueKey(currentScopeKey, rule.id)) ?? null,
                    (values) => {
                      const key = scopedRecentValueKey(currentScopeKey, rule.id);
                      if (!values?.length) recentValueCacheRef.current.delete(key);
                      else recentValueCacheRef.current.set(key, values);
                    },
                    onChangeFilters,
                  )}
                </div>,
                document.body,
              )
              : null}
          </div>
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
  cachedValues: string[] | null,
  onCachedValuesChange: (values: string[] | null) => void,
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
        mode={fieldType === "Multi-select" || fieldType === "Relation" ? "multi" : "single"}
        options={optionsForField(rule.field, fieldType, fieldViewConfigs, relationFilterOptions)}
        cachedValues={cachedValues}
        onCachedValuesChange={onCachedValuesChange}
        onChangeFilters={onChangeFilters}
      />
    );
  }
  return <TextFilterPopover filters={filters} rule={rule} onChangeFilters={onChangeFilters} />;
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
    const operator = valueOperatorLabel(rule.operator);
    if (!labels.length) return `${rule.field} ${operator}`;
    return `${rule.field} ${operator} ${truncateList(labels)}`;
  }
  const textOperator = textOperatorLabel(rule.operator);
  const value = textValue(rule.value);
  if (!value) return `${rule.field} ${textOperator}`;
  return `${rule.field} ${textOperator} ${truncateText(value, 28)}`;
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
  if (fieldType === "Multi-select" || fieldType === "Select" || fieldType === "Relation") {
    const operator = valueOperatorLabel(rule.operator);
    const values = normalizeFilterValues(rule.value);
    if (!values.length) return `${rule.field} ${operator}`;
    const labels = values.map((value) => optionLabel(rule.field, value, fieldType, fieldViewConfigs, relationFilterOptions));
    return `${rule.field} ${operator} ${labels.join(", ")}`;
  }
  const operator = textOperatorLabel(rule.operator);
  const values = normalizeFilterValues(rule.value);
  if (!values.length) return `${rule.field} ${operator}`;
  return `${rule.field} ${operator} ${values.join(", ")}`;
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

function scopedRecentValueKey(scopeKey: string, ruleId: string) {
  return `${scopeKey}::${ruleId}`;
}

function valueOperatorLabel(operator: FilterRule["operator"]) {
  if (operator === "does_not_contain") return "不包含";
  if (operator === "is_empty") return "为空";
  if (operator === "is_not_empty") return "不为空";
  return "包含任一";
}

function textOperatorLabel(operator: FilterRule["operator"]) {
  if (operator === "does_not_contain") return "不包含";
  if (operator === "is") return "等于";
  if (operator === "is_not") return "不等于";
  if (operator === "is_empty") return "为空";
  if (operator === "is_not_empty") return "不为空";
  return "包含";
}
