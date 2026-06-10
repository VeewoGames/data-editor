import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import * as Select from "@radix-ui/react-select";
import type { SortRule } from "../../api/client";
import { useVerticalListDragReorder } from "../useVerticalListDragReorder";
import { icons } from "../icons";
import { reorderSortRulesById } from "./reorder-sort-rules.mjs";

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
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const sortRowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const {
    beginDrag,
    dragPreview,
    draggingId,
    handleSuppressedClickCapture,
  } = useVerticalListDragReorder({
    fullOrder: sorts.map((sort) => sort.id),
    visibleOrder: sorts.map((sort) => sort.id),
    itemRefs: sortRowRefs,
    onCommitOrder: (orderedIds) => {
      const nextSorts = reorderSortRulesById(sorts, orderedIds);
      onChangeSorts(nextSorts);
    },
  });
  const renderedSorts = sorts.filter((sort) => sort.id !== dragPreview?.activeId);

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
    <div
      className="sort-popover"
      onClickCapture={handleSuppressedClickCapture}
      ref={popoverRef}
    >
      <div className="sort-popover-header">
        <strong>排序</strong>
        <button className="ghost-button compact" data-sort-action="add" onClick={addSort} disabled={!availableFields.length} type="button">
          <icons.addField size={15} />
          添加排序
        </button>
      </div>
      <div className="sort-rule-list">
        {sorts.length ? renderedSorts.map((sort, index) => (
          <div key={sort.id}>
            {dragPreview?.dropIndex === index ? (
              <div className="sort-rule-drag-placeholder" style={{ minHeight: dragPreview.ghostHeight }} />
            ) : null}
            <SortRuleRow
              availableFields={availableFields}
              onBeginDrag={beginDrag}
              onDeleteSort={deleteSort}
              onUpdateSort={updateSort}
              rowRef={(node) => {
                sortRowRefs.current[sort.id] = node;
              }}
              sort={sort}
              sorts={sorts}
            />
          </div>
        )) : <div className="filter-empty-hint">暂无排序</div>}
        {dragPreview?.dropIndex === renderedSorts.length ? (
          <div className="sort-rule-drag-placeholder" style={{ minHeight: dragPreview.ghostHeight }} />
        ) : null}
      </div>
      {dragPreview && draggingId ? (
        <div
          className="sort-rule-drag-ghost"
          style={{
            left: dragPreview.ghostLeft - (popoverRef.current?.getBoundingClientRect().left ?? 0),
            minHeight: dragPreview.ghostHeight,
            top: dragPreview.ghostTop - (popoverRef.current?.getBoundingClientRect().top ?? 0),
            width: dragPreview.ghostWidth,
          }}
        >
          {(() => {
            const activeSort = sorts.find((sort) => sort.id === draggingId);
            if (!activeSort) return null;
            return <SortRuleGhost sort={activeSort} />;
          })()}
        </div>
      ) : null}
    </div>
  );
}

type SortRuleRowProps = {
  availableFields: string[];
  onBeginDrag: (id: string, event: ReactPointerEvent<HTMLElement>) => void;
  onDeleteSort: (sortId: string) => void;
  onUpdateSort: (sortId: string, patch: Partial<SortRule>) => void;
  rowRef: (node: HTMLDivElement | null) => void;
  sort: SortRule;
  sorts: SortRule[];
};

function SortRuleRow({
  availableFields,
  onBeginDrag,
  onDeleteSort,
  onUpdateSort,
  rowRef,
  sort,
  sorts,
}: SortRuleRowProps) {
  return (
    <div className="sort-rule-row" data-sort-id={sort.id} ref={rowRef}>
      <button
        aria-label={`拖拽排序 ${sort.field}`}
        className="sort-rule-drag-handle"
        onPointerDown={(event) => {
          event.preventDefault();
          onBeginDrag(sort.id, event);
        }}
        type="button"
      >
        <icons.dragHandle size={14} />
      </button>
      <Select.Root value={sort.field} onValueChange={(field) => onUpdateSort(sort.id, { field, id: createSortId(field, sorts, sort.id) })}>
        <Select.Trigger className="select-trigger sort-field-trigger" aria-label="排序字段">
          <Select.Value />
          <Select.Icon asChild><icons.chevronDown size={16} /></Select.Icon>
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
      <Select.Root value={sort.direction} onValueChange={(direction) => onUpdateSort(sort.id, { direction: direction as SortRule["direction"] })}>
        <Select.Trigger className="select-trigger sort-direction-trigger" aria-label="排序方向">
          <Select.Value />
          <Select.Icon asChild><icons.chevronDown size={16} /></Select.Icon>
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
      <button className="ghost-button icon-button" onClick={() => onDeleteSort(sort.id)} type="button" aria-label="删除排序">
        <icons.delete size={15} />
      </button>
    </div>
  );
}

function SortRuleGhost({ sort }: { sort: SortRule }) {
  return (
    <>
      <span className="sort-rule-drag-handle ghost"><icons.dragHandle size={14} /></span>
      <span className="sort-rule-ghost-field">{sort.field}</span>
      <span className="sort-rule-ghost-direction">{sort.direction === "asc" ? "升序" : "降序"}</span>
      <span className="sort-rule-ghost-delete"><icons.delete size={15} /></span>
    </>
  );
}

function createSortId(field: string, sorts: SortRule[], currentId?: string) {
  const baseId = `sort:${field}`;
  if (!sorts.some((sort) => sort.id === baseId && sort.id !== currentId)) return baseId;
  let index = 2;
  while (sorts.some((sort) => sort.id === `${baseId}:${index}` && sort.id !== currentId)) index += 1;
  return `${baseId}:${index}`;
}
