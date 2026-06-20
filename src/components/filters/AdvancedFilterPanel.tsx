import * as Popover from "@radix-ui/react-popover";
import type { FilterGroup, FilterGroupNode, FilterNode } from "../../api/client";
import type { FieldDisplayType } from "../../model/fieldTypes";
import type { FieldViewConfig, MultiSelectOptionView } from "../../model/viewConfig";
import { AdvancedFilterGroupEditor } from "./AdvancedFilterGroupEditor";
import { icons } from "../icons";

type AdvancedFilterPanelProps = {
  filters: FilterGroup;
  advancedRoot: FilterGroupNode;
  fields: string[];
  displayTypes: Record<string, FieldDisplayType>;
  fieldViewConfigs: Record<string, FieldViewConfig>;
  fieldTypes: Record<string, FieldDisplayType>;
  relationFilterOptions: Record<string, MultiSelectOptionView[]>;
  onChangeFilters: (filters: FilterGroup) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function AdvancedFilterPanel({
  filters,
  advancedRoot,
  fields,
  displayTypes,
  fieldViewConfigs,
  fieldTypes,
  relationFilterOptions,
  onChangeFilters,
  open,
  onOpenChange,
}: AdvancedFilterPanelProps) {
  const ruleCount = countRules(advancedRoot);

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <button className="view-filter-chip filter-chip advanced-filter-chip" type="button" title={advancedFilterTitle(advancedRoot, ruleCount)}>
          <icons.filter size={14} />
          <span className="filter-chip-label">{ruleCount} 条规则</span>
          <icons.chevronDown className="filter-chip-chevron" size={14} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="menu-content filter-popover-content advanced-filter-panel" sideOffset={6} align="start">
          <div className="filter-popover filter-popover-shell advanced-filter-panel-shell">
            <AdvancedFilterGroupEditor
              filters={filters}
              group={advancedRoot}
              depth={1}
              isRoot
              fields={fields}
              displayTypes={displayTypes}
              fieldViewConfigs={fieldViewConfigs}
              fieldTypes={fieldTypes}
              relationFilterOptions={relationFilterOptions}
              onChangeFilters={onChangeFilters}
            />
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function countRules(node: FilterNode): number {
  if (node.kind === "rule") return 1;
  return (node.children ?? []).reduce((total, child) => total + countRules(child), 0);
}

function advancedFilterTitle(group: FilterGroupNode, ruleCount: number) {
  return `高级筛选：${ruleCount} 条规则`;
}
