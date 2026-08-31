import * as Popover from "@radix-ui/react-popover";
import { useEffect, useRef, useState } from "react";
import type { CollectionView, FilterGroup, FilterRule, SortRule } from "../api/client";
import type { FieldDisplayType } from "../model/fieldTypes";
import type { FieldViewConfig, MultiSelectOptionView } from "../model/viewConfig";
import { mergeTopLevelRuleIntoAdvancedRoot } from "../view/filter-tree.mjs";
import { FieldTypeIcon } from "./FieldTypeIcon";
import { isListboxNavigationKey, resolveListboxNavigationIndex } from "./listbox-keyboard-navigation.mjs";
import { icons } from "./icons";
import { AdvancedFilterPanel } from "./filters/AdvancedFilterPanel";
import { BooleanFilterPopover } from "./filters/BooleanFilterPopover";
import { fieldLabel, optionsForField, resolveFieldType } from "./filters/filter-rule-ui";
import { MultiSelectFilterPopover, type CreateFilterOptionInput } from "./filters/MultiSelectFilterPopover";
import { TextFilterPopover } from "./filters/TextFilterPopover";
import { SortPopover } from "./sort/SortPopover";
import { createDefaultFilterRule } from "../view/filter-rules.mjs";
import { useListboxPointerNavigation } from "./useListboxPointerNavigation";

export type ViewFilterBarProps = {
  snapshot: ViewFilterBarSnapshot;
  onChangeFilters: (filters: FilterGroup) => void;
  onChangeSorts: (sorts: SortRule[]) => void;
  onAddFilter: (field: string, fieldType: FieldDisplayType) => void;
  onAutoOpenRuleHandled: () => void;
  onResetView: () => void;
  onCreateFormalOption?: (input: CreateFilterOptionInput) => Promise<MultiSelectOptionView[]>;
};

export type ViewFilterBarSnapshot = {
  collectionKey?: string | null;
  view: CollectionView | null;
  fields: string[];
  displayTypes: Record<string, FieldDisplayType>;
  fieldViewConfigs: Record<string, FieldViewConfig>;
  fieldTypes?: Record<string, FieldDisplayType>;
  relationFilterOptions?: Record<string, MultiSelectOptionView[]>;
  dirty: boolean;
  viewOrderDirty: boolean;
  commandSaving: boolean;
  autoOpenRuleId: string | null;
};

export function ViewFilterBar({
  snapshot,
  onChangeFilters,
  onChangeSorts,
  onAddFilter,
  onAutoOpenRuleHandled,
  onResetView,
  onCreateFormalOption,
}: ViewFilterBarProps) {
  const {
    collectionKey = null,
    view,
    fields,
    displayTypes,
    fieldViewConfigs,
    fieldTypes = {},
    relationFilterOptions = {},
    dirty,
    viewOrderDirty,
    commandSaving,
    autoOpenRuleId,
  } = snapshot;
  const [addFilterOpen, setAddFilterOpen] = useState(false);
  const [addFilterActiveIndex, setAddFilterActiveIndex] = useState(-1);
  const [openRuleId, setOpenRuleId] = useState<string | null>(null);
  const [advancedPanelOpen, setAdvancedPanelOpen] = useState(false);
  const handledAutoOpenRuleIdRef = useRef<string | null>(null);
  const recentValueCacheRef = useRef(new Map<string, string[]>());
  const handleAddFilterPointerMove = useListboxPointerNavigation({
    itemSelector: '[role="menuitem"]:not(:disabled)',
    setActiveIndex: setAddFilterActiveIndex,
  });

  if (!view) return null;

  const activeFilters = view.filters ?? { topLevelRules: [], advancedRoot: null };
  const visibleFilterRules = activeFilters.topLevelRules ?? [];
  const advancedRoot = activeFilters.advancedRoot ?? null;
  const availableFilterFields = fields;
  const sorts = view.sorts ?? [];
  const showSharedViewActions = !commandSaving && (dirty || viewOrderDirty);
  const currentScopeKey = `${collectionKey ?? "__unknown_collection__"}::${view.id}`;

  useEffect(() => {
    if (!autoOpenRuleId) return;
    const autoOpenRequestKey = `${currentScopeKey}::${autoOpenRuleId}`;
    if (handledAutoOpenRuleIdRef.current === autoOpenRequestKey) return;
    if (!visibleFilterRules.some((rule) => rule.id === autoOpenRuleId)) return;
    if (openRuleId === autoOpenRuleId) {
      handledAutoOpenRuleIdRef.current = autoOpenRequestKey;
      onAutoOpenRuleHandled();
      return;
    }
    setAddFilterOpen(false);
    const frameId = window.requestAnimationFrame(() => {
      handledAutoOpenRuleIdRef.current = autoOpenRequestKey;
      setOpenRuleId(autoOpenRuleId);
      onAutoOpenRuleHandled();
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [autoOpenRuleId, currentScopeKey, onAutoOpenRuleHandled, openRuleId, visibleFilterRules]);

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
    const fieldType = resolveFieldType(field, displayTypes, fieldViewConfigs, fieldTypes);
    const existingRule = visibleFilterRules.find((rule) => rule.field === field);
    if (existingRule) setOpenRuleId(existingRule.id);
    else {
      const nextRule = createDefaultFilterRule(field, fieldType, visibleFilterRules);
      setOpenRuleId(nextRule.id);
    }
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
            <SortPopover fields={fields} fieldViewConfigs={fieldViewConfigs} sorts={sorts} onChangeSorts={onChangeSorts} />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <Popover.Root
        open={addFilterOpen}
        onOpenChange={(open) => {
          setAddFilterOpen(open);
          setAddFilterActiveIndex(open && availableFilterFields.length ? 0 : -1);
        }}
      >
        <Popover.Trigger asChild>
          <button className="ghost-button compact" disabled={!availableFilterFields.length} type="button">
            <icons.filter size={15} />
            + 筛选
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content className="menu-content add-filter-popover-content" sideOffset={6} align="start">
            <div
              className="add-filter-popover"
              role="menu"
              aria-label="选择筛选字段"
              onPointerMove={handleAddFilterPointerMove}
              onKeyDown={(event) => {
                if (!isListboxNavigationKey(event.key)) return;
                const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'));
                const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
                const nextIndex = resolveListboxNavigationIndex({ currentIndex, itemCount: items.length, key: event.key });
                if (nextIndex < 0) return;
                event.preventDefault();
                setAddFilterActiveIndex(nextIndex);
                items[nextIndex].focus();
              }}
            >
              {availableFilterFields.map((field, index) => (
                <button className={`add-filter-field-option${addFilterActiveIndex === index ? " is-active-target" : ""}`} key={field} onClick={() => addFilter(field)} type="button" role="menuitem">
                  <span className="add-filter-field-icon" data-field-icon={resolveFieldType(field, displayTypes, fieldViewConfigs, fieldTypes)}>
                    <FieldTypeIcon fieldType={resolveFieldType(field, displayTypes, fieldViewConfigs, fieldTypes)} size={14} strokeWidth={2.2} />
                  </span>
                  <span className="add-filter-field-name">{fieldLabel(field, fieldViewConfigs)}</span>
                </button>
              ))}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <div className="view-chip-list">
        {sorts.length ? (
          <Popover.Root>
            <Popover.Trigger asChild>
              <button className="view-filter-chip filter-chip sort-chip" type="button" title={sortChipTitle(sorts, fieldViewConfigs)}>
                <span className="filter-chip-label">{sortChipLabel(sorts, fieldViewConfigs)}</span>
                <icons.chevronDown className="filter-chip-chevron" size={14} />
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content className="menu-content sort-popover-content" sideOffset={6} align="start">
                <SortPopover fields={fields} fieldViewConfigs={fieldViewConfigs} sorts={sorts} onChangeSorts={onChangeSorts} />
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        ) : null}
        {visibleFilterRules.map((rule) => (
          <Popover.Root
            key={rule.id}
            open={openRuleId === rule.id}
            onOpenChange={(open) => {
              setOpenRuleId((current) => {
                if (open) return rule.id;
                return current === rule.id ? null : current;
              });
            }}
          >
            <div className="filter-chip-wrap">
              <Popover.Trigger asChild>
                <button
                  className="view-filter-chip filter-chip"
                  type="button"
                  title={filterChipTitle(rule, displayTypes, fieldViewConfigs, fieldTypes, relationFilterOptions)}
                >
                  <span className="filter-chip-label">{filterChipLabel(rule, displayTypes, fieldViewConfigs, fieldTypes, relationFilterOptions)}</span>
                  <icons.chevronDown className="filter-chip-chevron" size={14} />
                </button>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content
                  className="menu-content filter-popover-content filter-popover-inline"
                  sideOffset={6}
                  align="start"
                  onInteractOutside={(event) => {
                    const target = event.target as HTMLElement | null;
                    if (target?.closest(".filter-select-content") || target?.closest(".filter-action-menu") || target?.closest(".column-menu-popup")) {
                      event.preventDefault();
                    }
                  }}
                >
                  {renderFilterPopover(
                    rule,
                    view.filters,
                    displayTypes,
                    fieldViewConfigs,
                    fieldTypes,
                    relationFilterOptions,
                    recentValueCacheRef.current.get(scopedRecentValueKey(currentScopeKey, rule.id)) ?? null,
                    (values) => {
                      const key = scopedRecentValueKey(currentScopeKey, rule.id);
                      if (!values?.length) recentValueCacheRef.current.delete(key);
                      else recentValueCacheRef.current.set(key, values);
                    },
                    () => {
                      setOpenRuleId(null);
                      setAdvancedPanelOpen(true);
                      onChangeFilters(mergeTopLevelRuleIntoAdvancedRoot(activeFilters, rule.id));
                    },
                    onChangeFilters,
                    onCreateFormalOption,
                  )}
                </Popover.Content>
              </Popover.Portal>
            </div>
          </Popover.Root>
        ))}
        {advancedRoot ? (
          <AdvancedFilterPanel
            filters={activeFilters}
            advancedRoot={advancedRoot}
            fields={fields}
            displayTypes={displayTypes}
            fieldViewConfigs={fieldViewConfigs}
            fieldTypes={fieldTypes}
            relationFilterOptions={relationFilterOptions}
            onCreateFormalOption={onCreateFormalOption}
            onChangeFilters={onChangeFilters}
            open={advancedPanelOpen}
            onOpenChange={setAdvancedPanelOpen}
          />
        ) : null}
      </div>
      {showSharedViewActions ? (
        <div className="view-filter-actions">
          <button type="button" className="view-tab-action" onClick={onResetView}>
            重置
          </button>
        </div>
      ) : null}
    </div>
  );
}

function renderFilterPopover(
  rule: FilterRule,
  filters: FilterGroup,
  displayTypes: Record<string, FieldDisplayType>,
  fieldViewConfigs: Record<string, FieldViewConfig>,
  fieldTypes: Record<string, FieldDisplayType>,
  relationFilterOptions: Record<string, MultiSelectOptionView[]>,
  cachedValues: string[] | null,
  onCachedValuesChange: (values: string[] | null) => void,
  onMergeIntoAdvanced: (() => void) | null,
  onChangeFilters: (filters: FilterGroup) => void,
  onCreateFormalOption?: (input: CreateFilterOptionInput) => Promise<MultiSelectOptionView[]>,
) {
  const fieldType = resolveFieldType(rule.field, displayTypes, fieldViewConfigs, fieldTypes);
  const label = fieldLabel(rule.field, fieldViewConfigs);
  if (fieldType === "Checkbox") {
    return <BooleanFilterPopover filters={filters} rule={rule} fieldLabel={label} onMergeIntoAdvanced={onMergeIntoAdvanced} onChangeFilters={onChangeFilters} />;
  }
  if (fieldType === "Multi-select" || fieldType === "Select" || fieldType === "Relation") {
    return (
      <MultiSelectFilterPopover
        filters={filters}
        rule={rule}
        fieldLabel={label}
        fieldType={fieldType}
        mode="multi"
        options={optionsForField(rule.field, fieldType, fieldViewConfigs, relationFilterOptions)}
        cachedValues={cachedValues}
        onCachedValuesChange={onCachedValuesChange}
        onCreateFormalOption={onCreateFormalOption}
        onMergeIntoAdvanced={onMergeIntoAdvanced}
        onChangeFilters={onChangeFilters}
      />
    );
  }
  return <TextFilterPopover filters={filters} rule={rule} fieldLabel={label} onMergeIntoAdvanced={onMergeIntoAdvanced} onChangeFilters={onChangeFilters} />;
}

function filterChipLabel(
  rule: FilterRule,
  displayTypes: Record<string, FieldDisplayType>,
  fieldViewConfigs: Record<string, FieldViewConfig>,
  fieldTypes: Record<string, FieldDisplayType>,
  relationFilterOptions: Record<string, MultiSelectOptionView[]> = {},
) {
  const fieldType = resolveFieldType(rule.field, displayTypes, fieldViewConfigs, fieldTypes);
  const label = fieldLabel(rule.field, fieldViewConfigs);
  if (fieldType === "Checkbox") {
    const valueLabel = booleanLabel(rule);
    return valueLabel ? `${label}: ${valueLabel}` : label;
  }
  if (fieldType === "Multi-select" || fieldType === "Select" || fieldType === "Relation") {
    const labels = normalizeFilterValues(rule.value)
      .map((value) => optionLabel(rule.field, value, fieldType, fieldViewConfigs, relationFilterOptions));
    const operator = valueOperatorLabel(rule.operator);
    if (!labels.length) return `${label} ${operator}`;
    return `${label} ${operator} ${truncateList(labels)}`;
  }
  const textOperator = textOperatorLabel(rule.operator);
  const value = textValue(rule.value);
  if (!value) return `${label} ${textOperator}`;
  return `${label} ${textOperator} ${truncateText(value, 28)}`;
}

function filterChipTitle(
  rule: FilterRule,
  displayTypes: Record<string, FieldDisplayType>,
  fieldViewConfigs: Record<string, FieldViewConfig>,
  fieldTypes: Record<string, FieldDisplayType>,
  relationFilterOptions: Record<string, MultiSelectOptionView[]> = {},
) {
  const fieldType = resolveFieldType(rule.field, displayTypes, fieldViewConfigs, fieldTypes);
  const label = fieldLabel(rule.field, fieldViewConfigs);
  if (fieldType === "Checkbox") {
    const valueLabel = booleanLabel(rule);
    return valueLabel ? `${label}: ${valueLabel}` : label;
  }
  if (fieldType === "Multi-select" || fieldType === "Select" || fieldType === "Relation") {
    const operator = valueOperatorLabel(rule.operator);
    const values = normalizeFilterValues(rule.value);
    if (!values.length) return `${label} ${operator}`;
    const labels = values.map((value) => optionLabel(rule.field, value, fieldType, fieldViewConfigs, relationFilterOptions));
    return `${label} ${operator} ${labels.join(", ")}`;
  }
  const operator = textOperatorLabel(rule.operator);
  const values = normalizeFilterValues(rule.value);
  if (!values.length) return `${label} ${operator}`;
  return `${label} ${operator} ${values.join(", ")}`;
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
  return "包含";
}

function textOperatorLabel(operator: FilterRule["operator"]) {
  if (operator === "does_not_contain") return "不包含";
  if (operator === "is") return "等于";
  if (operator === "is_not") return "不等于";
  if (operator === "is_empty") return "为空";
  if (operator === "is_not_empty") return "不为空";
  return "包含";
}

function sortChipLabel(sorts: SortRule[], fieldViewConfigs: Record<string, FieldViewConfig>) {
  if (sorts.length > 1) return `⇵ ${sorts.length} 个排序`;
  const firstSort = sorts[0];
  if (!firstSort) return "";
  return `${firstSort.direction === "asc" ? "↑" : "↓"} ${fieldLabel(firstSort.field, fieldViewConfigs)}`;
}

function sortChipTitle(sorts: SortRule[], fieldViewConfigs: Record<string, FieldViewConfig>) {
  if (!sorts.length) return "";
  return sorts.map((sort) => `${fieldLabel(sort.field, fieldViewConfigs)} ${sort.direction}`).join(", ");
}
