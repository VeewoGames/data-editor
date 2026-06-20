import type { FilterGroup, FilterGroupNode } from "../../api/client";
import type { FieldDisplayType } from "../../model/fieldTypes";
import type { FieldViewConfig, MultiSelectOptionView } from "../../model/viewConfig";
import { createDefaultFilterRule } from "../../view/filter-rules.mjs";
import { addGroupToGroup, addRuleToGroup, canCreateChildGroup, collectAllFilterNodeIds, duplicateNodeInAdvancedRoot, removeNodeFromFilters, updateGroupOp } from "../../view/filter-tree.mjs";
import { icons } from "../icons";
import { AdvancedFilterSelect } from "./AdvancedFilterSelect";
import { resolveFieldType } from "./filter-rule-ui";
import { AdvancedFilterNodeMenu } from "./AdvancedFilterNodeMenu";
import { AdvancedFilterRuleEditor } from "./AdvancedFilterRuleEditor";

type AdvancedFilterGroupEditorProps = {
  filters: FilterGroup;
  group: FilterGroupNode;
  depth: number;
  isRoot?: boolean;
  fields: string[];
  displayTypes: Record<string, FieldDisplayType>;
  fieldViewConfigs: Record<string, FieldViewConfig>;
  fieldTypes: Record<string, FieldDisplayType>;
  relationFilterOptions: Record<string, MultiSelectOptionView[]>;
  onChangeFilters: (filters: FilterGroup) => void;
};

export function AdvancedFilterGroupEditor({
  filters,
  group,
  depth,
  isRoot = false,
  fields,
  displayTypes,
  fieldViewConfigs,
  fieldTypes,
  relationFilterOptions,
  onChangeFilters,
}: AdvancedFilterGroupEditorProps) {
  const canAddGroup = canCreateChildGroup(filters, group.id);

  function addRule() {
    const firstField = fields[0];
    if (!firstField) return;
    const fieldType = resolveFieldType(firstField, displayTypes, fieldViewConfigs, fieldTypes);
    const nextRule = createDefaultFilterRule(firstField, fieldType, buildExistingIdItems(filters));
    onChangeFilters(addRuleToGroup(filters, group.id, nextRule));
  }

  function addGroup() {
    if (!canAddGroup) return;
    onChangeFilters(addGroupToGroup(filters, group.id, {
      kind: "group",
      id: createGroupId(filters),
      op: group.op,
      children: [],
    }));
  }

  return (
    <div className="advanced-filter-group" data-advanced-depth={depth}>
      {!isRoot ? (
        <div className="advanced-filter-group-toolbar">
          <span className="advanced-filter-group-label">筛选分组</span>
          <AdvancedFilterNodeMenu
            onDelete={() => onChangeFilters(removeNodeFromFilters(filters, group.id))}
            onDuplicate={() => onChangeFilters(duplicateNodeInAdvancedRoot(filters, group.id))}
          />
        </div>
      ) : null}
      <div className="advanced-filter-group-children">
        {(group.children ?? []).map((child, index) => (
          <div className="advanced-filter-child-row" key={child.id}>
            <div className="advanced-filter-connector">
              {index === 0 ? (
                <span className="advanced-filter-connector-label">当</span>
              ) : (
                <AdvancedFilterSelect
                  ariaLabel="高级筛选连接词"
                  className="advanced-filter-control advanced-filter-logic advanced-filter-connector-select"
                  contentClassName="advanced-filter-logic-content"
                  options={[
                    { value: "and", label: "与" },
                    { value: "or", label: "或" },
                  ]}
                  value={group.op}
                  onValueChange={(value) => onChangeFilters(updateGroupOp(filters, group.id, value))}
                />
              )}
            </div>
            <div className="advanced-filter-child-content">
              {child.kind === "group" ? (
                <AdvancedFilterGroupEditor
                  filters={filters}
                  group={child}
                  depth={depth + 1}
                  fields={fields}
                  displayTypes={displayTypes}
                  fieldViewConfigs={fieldViewConfigs}
                  fieldTypes={fieldTypes}
                  relationFilterOptions={relationFilterOptions}
                  onChangeFilters={onChangeFilters}
                />
              ) : (
                <AdvancedFilterRuleEditor
                  filters={filters}
                  rule={child}
                  fields={fields}
                  displayTypes={displayTypes}
                  fieldViewConfigs={fieldViewConfigs}
                  fieldTypes={fieldTypes}
                  relationFilterOptions={relationFilterOptions}
                  onChangeFilters={onChangeFilters}
                />
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="advanced-filter-group-footer">
        <button type="button" className="ghost-button compact advanced-filter-add-button" onClick={addRule}>
          <icons.addField size={14} />
          添加筛选规则
        </button>
        <button type="button" className="ghost-button compact advanced-filter-add-button" onClick={addGroup} disabled={!canAddGroup}>
          <icons.nested size={14} />
          添加筛选分组
        </button>
      </div>
      {isRoot ? (
        <div className="advanced-filter-root-footer">
          <button
            type="button"
            className="ghost-button compact advanced-filter-delete-button"
            onClick={() => onChangeFilters({
              topLevelRules: Array.isArray(filters?.topLevelRules)
                ? filters.topLevelRules
                : Array.isArray((filters as unknown as { rules?: unknown[] } | null | undefined)?.rules)
                  ? (filters as unknown as { rules: FilterGroup["topLevelRules"] }).rules
                  : [],
              advancedRoot: null,
            })}
          >
            <icons.delete size={16} />
            删除筛选
          </button>
        </div>
      ) : null}
    </div>
  );
}

function buildExistingIdItems(filters: FilterGroup) {
  return [...collectAllFilterNodeIds(filters)].map((id) => ({ id }));
}

function createGroupId(filters: FilterGroup) {
  const usedIds = collectAllFilterNodeIds(filters);
  let candidate = "group:1";
  let index = 2;
  while (usedIds.has(candidate)) {
    candidate = `group:${index}`;
    index += 1;
  }
  return candidate;
}
