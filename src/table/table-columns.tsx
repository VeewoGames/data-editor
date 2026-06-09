import { createContext, memo, useContext, type ReactNode } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { BacklinkCellViewer } from "./BacklinkCellViewer";
import { CellRenderer } from "./CellRenderer";
import { ColumnHeader } from "./ColumnHeader";
import type { OptionFieldDraftCommit } from "./OptionFieldEditor";
import { summarizeNested, type DataRecord } from "../model/documentModel";
import type { FieldDisplayType } from "../model/fieldTypes";
import type { RelationBacklink } from "../model/relationMaintenance";
import type { RelationConfig } from "../model/viewConfig";
import type { TableColumnModel } from "./table-column-models";
import { resolveValidationIssue } from "../validation/issue-lookup.mjs";
import type { ValidationSnapshot } from "../validation/issue-map";

type ColumnDragState = {
  draggingField: string;
};

type TableColumnsRuntime = {
  backlinkValuesByRowId: Record<number | string, Record<string, RelationBacklink[]>>;
  validation: ValidationSnapshot | null;
  sortField: string | null;
  sortDirection: "asc" | "desc" | null;
  pressedField: string | null;
  columnDragState: ColumnDragState | null;
  onSort: (fieldName: string, direction: "asc" | "desc" | null) => void;
  onAddFilter: (fieldName: string, displayType: FieldDisplayType) => void;
  onHideField: (fieldName: string) => void;
  onResizeField: (fieldName: string, width: number) => void;
  onMoveField: (fieldName: string, direction: "left" | "right") => void;
  onDragStart: (fieldName: string, rect: DOMRect, pointerOffsetX: number) => void;
  onDragMove: (fieldName: string, clientX: number) => void;
  onDragEnd: (fieldName: string) => void;
  onPressChange: (fieldName: string, pressed: boolean) => void;
  onToggleWrapField: (fieldName: string) => void;
  onChangeFieldType: (fieldName: string, type: FieldDisplayType) => void;
  onConfigureRelation: (fieldName: string) => void;
  onClearRelation: (fieldName: string) => void;
  onDeleteField: (fieldName: string) => void;
  onOpenRelationTarget: (config: RelationConfig, value: string | number) => void;
  onSelectRow: (rowIndex: number, rowId: string | null) => void;
  onOpenDetail: (rowIndex: number, rowId: string | null) => void;
  onOpenBacklink: (backlink: RelationBacklink) => void;
  onEditCell: (rowIndex: number, rowId: string, fieldName: string, next: unknown) => void;
  onCommitMultiSelectDraft: (rowIndex: number, rowId: string, fieldName: string, patch: OptionFieldDraftCommit) => void;
  onCommitSelectDraft: (rowIndex: number, rowId: string, fieldName: string, patch: OptionFieldDraftCommit) => void;
};

const TableColumnsRuntimeContext = createContext<TableColumnsRuntime | null>(null);

export function TableColumnsRuntimeProvider(
  { value, children }: { value: TableColumnsRuntime; children: ReactNode },
) {
  return <TableColumnsRuntimeContext.Provider value={value}>{children}</TableColumnsRuntimeContext.Provider>;
}

export function buildTableColumns(columnModels: TableColumnModel[]): ColumnDef<DataRecord>[] {
  return columnModels.map((columnModel) => ({
    id: columnModel.fieldName,
    accessorFn: (row) => row[columnModel.fieldName],
    size: columnModel.width,
    header: () => <MemoTableColumnHeaderView columnModel={columnModel} />,
    cell: (ctx) => {
      const value = ctx.getValue();
      const rowIndex = ctx.row.index;
      const originalRowIndex = Number(ctx.row.original.__rowIndex ?? rowIndex);
      const rowId = String(ctx.row.original.__rowId ?? originalRowIndex);
      return (
        <MemoTableColumnCellView
          columnModel={columnModel}
          value={value}
          originalRowIndex={originalRowIndex}
          rowId={rowId}
        />
      );
    },
  }));
}

function useTableColumnsRuntime() {
  const runtime = useContext(TableColumnsRuntimeContext);
  if (!runtime) throw new Error("TableColumnsRuntimeProvider is missing");
  return runtime;
}

function TableColumnHeaderView({ columnModel }: { columnModel: TableColumnModel }) {
  const runtime = useTableColumnsRuntime();
  return (
    <ColumnHeader
      fieldName={columnModel.fieldName}
      roleKind={columnModel.roleKind}
      allowTypeChange={columnModel.allowTypeChange}
      displayType={columnModel.displayType}
      relationConfigured={columnModel.relationConfigured}
      sortDirection={runtime.sortField === columnModel.fieldName ? runtime.sortDirection : null}
      wrapped={columnModel.wrapped}
      width={columnModel.width}
      pressed={runtime.pressedField === columnModel.fieldName}
      onSort={(direction) => runtime.onSort(columnModel.fieldName, direction)}
      onAddFilter={() => runtime.onAddFilter(columnModel.fieldName, columnModel.displayType)}
      onHide={() => runtime.onHideField(columnModel.fieldName)}
      onResize={(width) => runtime.onResizeField(columnModel.fieldName, width)}
      onMove={(direction) => runtime.onMoveField(columnModel.fieldName, direction)}
      isDragging={runtime.columnDragState?.draggingField === columnModel.fieldName}
      onDragStart={runtime.onDragStart}
      onDragMove={runtime.onDragMove}
      onDragEnd={runtime.onDragEnd}
      onPressChange={runtime.onPressChange}
      onToggleWrap={() => runtime.onToggleWrapField(columnModel.fieldName)}
      onChangeFieldType={(type) => runtime.onChangeFieldType(columnModel.fieldName, type)}
      onConfigureRelation={() => runtime.onConfigureRelation(columnModel.fieldName)}
      onClearRelation={() => runtime.onClearRelation(columnModel.fieldName)}
      onDeleteField={() => runtime.onDeleteField(columnModel.fieldName)}
    />
  );
}

const MemoTableColumnHeaderView = memo(TableColumnHeaderView, (previous, next) => previous.columnModel === next.columnModel);

function TableColumnCellView(
  {
    columnModel,
    value,
    originalRowIndex,
    rowId,
  }: {
    columnModel: TableColumnModel;
    value: unknown;
    originalRowIndex: number;
    rowId: string;
  },
) {
  const runtime = useTableColumnsRuntime();
  if (columnModel.backlinkColumn) {
    return (
      <BacklinkCellViewer
        items={runtime.backlinkValuesByRowId[rowId]?.[columnModel.fieldName] ?? []}
        status={columnModel.backlinkColumn.status}
        message={columnModel.backlinkColumn.message}
        wrapped={columnModel.wrapped}
        onOpen={runtime.onOpenBacklink}
      />
    );
  }
  if (columnModel.isNested) {
    return (
      <button className="nested-summary" onClick={() => runtime.onSelectRow(originalRowIndex, rowId)}>
        {summarizeNestedValue(value)}
      </button>
    );
  }
  if (columnModel.isTitle) {
    return (
      <button
        type="button"
        className={`title-cell title-cell-button cell-text-content ${columnModel.wrapped ? "cell-text-wrap" : ""}`}
        data-cell-role="title-action"
        data-wrap-mode={columnModel.wrapped ? "wrap" : "truncate"}
        onClick={(event) => {
          event.stopPropagation();
          runtime.onOpenDetail(originalRowIndex, rowId);
        }}
        title="Open detail"
      >
        <span className="title-cell-text" data-cell-role="title-text">{value == null ? "" : String(value)}</span>
      </button>
    );
  }
  return (
    <CellRenderer
      cellId={`${rowId}:${columnModel.fieldName}`}
      value={value}
      displayType={columnModel.relationConfig ? "Relation" : columnModel.displayType}
      wrapped={columnModel.wrapped}
      multiSelectConfig={columnModel.multiSelectConfig}
      selectConfig={columnModel.selectConfig}
      relationOptions={columnModel.relationOptions}
      relationConfigured={columnModel.relationConfigured}
      relationMode={columnModel.relationConfig?.mode}
      onOpenRelationTarget={columnModel.relationConfig ? (nextValue) => runtime.onOpenRelationTarget(columnModel.relationConfig as RelationConfig, nextValue) : undefined}
      issue={resolveValidationIssue(runtime.validation, rowId, originalRowIndex, columnModel.fieldName)}
      onEdit={(next) => runtime.onEditCell(originalRowIndex, rowId, columnModel.fieldName, next)}
      onCommitMultiSelectDraft={(patch) => runtime.onCommitMultiSelectDraft(originalRowIndex, rowId, columnModel.fieldName, patch)}
      onCommitSelectDraft={(patch) => runtime.onCommitSelectDraft(originalRowIndex, rowId, columnModel.fieldName, patch)}
    />
  );
}

const MemoTableColumnCellView = memo(
  TableColumnCellView,
  (previous, next) =>
    previous.columnModel === next.columnModel &&
    previous.value === next.value &&
    previous.originalRowIndex === next.originalRowIndex &&
    previous.rowId === next.rowId,
);

function summarizeNestedValue(value: unknown) {
  if (value == null) return "未设置";
  return summarizeNested(value);
}
