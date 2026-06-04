import * as Select from "@radix-ui/react-select";
import type { SortRule } from "../../api/client";
import { icons } from "../icons";

type SortPopoverProps = {
  fields: string[];
  sorts: SortRule[];
  onChangeSorts: (sorts: SortRule[]) => void;
};

const sortDirections: Array<{ value: SortRule["direction"]; label: string }> = [
  { value: "asc", label: "升序" },
  { value: "desc", label: "降序" },
];

export function SortPopover({ fields, sorts, onChangeSorts }: SortPopoverProps) {
  const availableFields = fields.length ? fields : sorts.map((sort) => sort.field);

  function updateSort(sortId: string, patch: Partial<SortRule>) {
    const nextSorts = sorts.map((sort) => sort.id === sortId ? { ...sort, ...patch } : sort);
    onChangeSorts(nextSorts);
  }

  function addSort() {
    const field = availableFields.find((item) => !sorts.some((sort) => sort.field === item)) ?? availableFields[0];
    if (!field) return;
    const nextSorts = [
      ...sorts,
      { id: createSortId(field, sorts), field, direction: "asc" as const },
    ];
    onChangeSorts(nextSorts);
  }

  function deleteSort(sortId: string) {
    const nextSorts = sorts.filter((sort) => sort.id !== sortId);
    onChangeSorts(nextSorts);
  }

  return (
    <div className="sort-popover">
      <div className="sort-popover-header">
        <strong>排序</strong>
        <button className="ghost-button compact" onClick={addSort} disabled={!availableFields.length} type="button">
          <icons.addField size={15} />
          添加排序
        </button>
      </div>
      <div className="sort-rule-list">
        {sorts.length ? sorts.map((sort) => (
          <div className="sort-rule-row" key={sort.id}>
            <Select.Root value={sort.field} onValueChange={(field) => updateSort(sort.id, { field, id: createSortId(field, sorts, sort.id) })}>
              <Select.Trigger className="select-trigger sort-field-trigger" aria-label="排序字段">
                <Select.Value />
                <Select.Icon />
              </Select.Trigger>
              <Select.Portal>
                <Select.Content className="menu-content select-content sort-select-content" position="popper" sideOffset={6}>
                  <Select.Viewport>
                    {availableFields.map((field) => (
                      <Select.Item className="menu-item" key={field} value={field}>
                        <Select.ItemText>{field}</Select.ItemText>
                      </Select.Item>
                    ))}
                  </Select.Viewport>
                </Select.Content>
              </Select.Portal>
            </Select.Root>
            <Select.Root value={sort.direction} onValueChange={(direction) => updateSort(sort.id, { direction: direction as SortRule["direction"] })}>
              <Select.Trigger className="select-trigger sort-direction-trigger" aria-label="排序方向">
                <Select.Value />
                <Select.Icon />
              </Select.Trigger>
              <Select.Portal>
                <Select.Content className="menu-content select-content sort-direction-content" position="popper" sideOffset={6}>
                  <Select.Viewport>
                    {sortDirections.map((direction) => (
                      <Select.Item className="menu-item" key={direction.value} value={direction.value}>
                        <Select.ItemText>{direction.label}</Select.ItemText>
                      </Select.Item>
                    ))}
                  </Select.Viewport>
                </Select.Content>
              </Select.Portal>
            </Select.Root>
            <button className="ghost-button icon-button" onClick={() => deleteSort(sort.id)} type="button" aria-label="删除排序">
              <icons.delete size={15} />
            </button>
          </div>
        )) : <div className="filter-empty-hint">暂无排序</div>}
      </div>
    </div>
  );
}

function createSortId(field: string, sorts: SortRule[], currentId?: string) {
  const baseId = `sort:${field}`;
  if (!sorts.some((sort) => sort.id === baseId && sort.id !== currentId)) return baseId;
  let index = 2;
  while (sorts.some((sort) => sort.id === `${baseId}:${index}` && sort.id !== currentId)) index += 1;
  return `${baseId}:${index}`;
}
