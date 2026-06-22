import * as Popover from "@radix-ui/react-popover";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CollectionView, FilterGroup, FilterRule, SortRule } from "../api/client";
import type { FieldDisplayType } from "../model/fieldTypes";
import type { FieldViewConfig, MultiSelectOptionView } from "../model/viewConfig";
import { mergeTopLevelRuleIntoAdvancedRoot } from "../view/filter-tree.mjs";
import { FieldTypeIcon } from "./FieldTypeIcon";
import { icons } from "./icons";
import { AdvancedFilterPanel } from "./filters/AdvancedFilterPanel";
import { BooleanFilterPopover } from "./filters/BooleanFilterPopover";
import { optionsForField, resolveFieldType } from "./filters/filter-rule-ui";
import { MultiSelectFilterPopover, type CreateFilterOptionInput } from "./filters/MultiSelectFilterPopover";
import { TextFilterPopover } from "./filters/TextFilterPopover";
import { SortPopover } from "./sort/SortPopover";
import { createDefaultFilterRule } from "../view/filter-rules.mjs";

export type ViewFilterBarProps = {
  snapshot: ViewFilterBarSnapshot;
  onChangeFilters: (filters: FilterGroup) => void;
  onChangeSorts: (sorts: SortRule[]) => void;
  onAddFilter: (field: string, fieldType: FieldDisplayType) => void;
  onAutoOpenRuleHandled: () => void;
  onResetView: () => void;
  onSaveForEveryone: () => void;
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
  onSaveForEveryone,
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
  const [openRuleId, setOpenRuleId] = useState<string | null>(null);
  const [openRuleRect, setOpenRuleRect] = useState<{ left: number; top: number } | null>(null);
  const [advancedPanelOpen, setAdvancedPanelOpen] = useState(false);
  const handledAutoOpenRuleIdRef = useRef<string | null>(null);
  const suppressCloseRuleIdRef = useRef<string | null>(null);
  const filterChipWrapRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const recentValueCacheRef = useRef(new Map<string, string[]>());

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
    const fieldType = resolveFieldType(field, displayTypes, fieldViewConfigs, fieldTypes);
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
                  <span className="add-filter-field-icon" data-field-icon={resolveFieldType(field, displayTypes, fieldViewConfigs, fieldTypes)}>
                    <FieldTypeIcon fieldType={resolveFieldType(field, displayTypes, fieldViewConfigs, fieldTypes)} size={14} strokeWidth={2.2} />
                  </span>
                  <span className="add-filter-field-name">{field}</span>
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
              <button className="view-filter-chip filter-chip sort-chip" type="button" title={sortChipTitle(sorts)}>
                <span className="filter-chip-label">{sortChipLabel(sorts)}</span>
                <icons.chevronDown className="filter-chip-chevron" size={14} />
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content className="menu-content sort-popover-content" sideOffset={6} align="start">
                <SortPopover fields={fields} sorts={sorts} onChangeSorts={onChangeSorts} />
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        ) : null}
        {visibleFilterRules.map((rule) => (
          <div className="filter-chip-wrap" key={rule.id} ref={(node) => { filterChipWrapRefs.current[rule.id] = node; }}>
            <button
              className="view-filter-chip filter-chip"
              type="button"
              title={filterChipTitle(rule, displayTypes, fieldViewConfigs, fieldTypes, relationFilterOptions)}
              onClick={() => {
                if (suppressCloseRuleIdRef.current === rule.id) return;
                setOpenRuleId((current) => current === rule.id ? null : rule.id);
              }}
            >
              <span className="filter-chip-label">{filterChipLabel(rule, displayTypes, fieldViewConfigs, fieldTypes, relationFilterOptions)}</span>
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
                </div>,
                document.body,
              )
              : null}
          </div>
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
  if (fieldType === "Checkbox") {
    return <BooleanFilterPopover filters={filters} rule={rule} onMergeIntoAdvanced={onMergeIntoAdvanced} onChangeFilters={onChangeFilters} />;
  }
  if (fieldType === "Multi-select" || fieldType === "Select" || fieldType === "Relation") {
    return (
      <MultiSelectFilterPopover
        filters={filters}
        rule={rule}
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
  return <TextFilterPopover filters={filters} rule={rule} onMergeIntoAdvanced={onMergeIntoAdvanced} onChangeFilters={onChangeFilters} />;
}

function filterChipLabel(
  rule: FilterRule,
  displayTypes: Record<string, FieldDisplayType>,
  fieldViewConfigs: Record<string, FieldViewConfig>,
  fieldTypes: Record<string, FieldDisplayType>,
  relationFilterOptions: Record<string, MultiSelectOptionView[]> = {},
) {
  const fieldType = resolveFieldType(rule.field, displayTypes, fieldViewConfigs, fieldTypes);
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
  displayTypes: Record<string, FieldDisplayType>,
  fieldViewConfigs: Record<string, FieldViewConfig>,
  fieldTypes: Record<string, FieldDisplayType>,
  relationFilterOptions: Record<string, MultiSelectOptionView[]> = {},
) {
  const fieldType = resolveFieldType(rule.field, displayTypes, fieldViewConfigs, fieldTypes);
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

function sortChipLabel(sorts: SortRule[]) {
  if (sorts.length > 1) return `⇵ ${sorts.length} 个排序`;
  const firstSort = sorts[0];
  if (!firstSort) return "";
  return `${firstSort.direction === "asc" ? "↑" : "↓"} ${firstSort.field}`;
}

function sortChipTitle(sorts: SortRule[]) {
  if (!sorts.length) return "";
  return sorts.map((sort) => `${sort.field} ${sort.direction}`).join(", ");
}
