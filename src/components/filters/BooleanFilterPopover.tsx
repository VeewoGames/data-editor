import type { FilterGroup, FilterRule } from "../../api/client";
import { removeNodeFromFilters, replaceNodeInFilters } from "../../view/filter-tree.mjs";
import { FilterActionMenu } from "./FilterActionMenu";

type BooleanFilterPopoverProps = {
  filters: FilterGroup;
  rule: FilterRule;
  onMergeIntoAdvanced?: (() => void) | null;
  onChangeFilters: (filters: FilterGroup) => void;
};

export function BooleanFilterPopover({ filters, rule, onMergeIntoAdvanced = null, onChangeFilters }: BooleanFilterPopoverProps) {
  function updateRule(nextRule: FilterRule) {
    onChangeFilters(replaceRule(filters, nextRule));
  }

  function deleteRule() {
    onChangeFilters(removeRule(filters, rule.id));
  }

  const activeValue = rule.value === false ? "false" : rule.value === true ? "true" : "";

  return (
    <div className="filter-popover filter-popover-shell">
      <div className="filter-popover-header">
        <strong>{rule.field}</strong>
        <FilterActionMenu onDelete={deleteRule} onMergeIntoAdvanced={onMergeIntoAdvanced} />
      </div>
      <div className="filter-popover-section">
        <div className="filter-section-label">条件</div>
        <div className="filter-choice-list">
          <button
            className={activeValue === "false" ? "filter-choice selected" : "filter-choice"}
            onClick={() => updateRule({ ...rule, operator: "is", value: false })}
            type="button"
          >
            未勾选
          </button>
          <button
            className={activeValue === "true" ? "filter-choice selected" : "filter-choice"}
            onClick={() => updateRule({ ...rule, operator: "is", value: true })}
            type="button"
          >
            已勾选
          </button>
          <button
            className="filter-choice"
            onClick={deleteRule}
            type="button"
          >
            清除
          </button>
        </div>
      </div>
    </div>
  );
}

function replaceRule(filters: FilterGroup, nextRule: FilterRule): FilterGroup {
  return replaceNodeInFilters(filters, nextRule);
}

function removeRule(filters: FilterGroup, ruleId: string): FilterGroup {
  return removeNodeFromFilters(filters, ruleId);
}
