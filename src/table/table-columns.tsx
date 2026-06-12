import { createContext, memo, useContext, useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { BacklinkCellViewer } from "./BacklinkCellViewer";
import { CellRenderer } from "./CellRenderer";
import { ColumnHeader } from "./ColumnHeader";
import type { OptionFieldDraftCommit } from "./OptionFieldEditor";
import { TableCellFrame, type TableCellContentKind, type TableCellLayout } from "./TableCellFrame";
import { summarizeNested, type DataRecord } from "../model/documentModel";
import { isCompatible, type FieldDisplayType } from "../model/fieldTypes";
import type { RelationBacklink } from "../model/relationMaintenance";
import type { RelationConfig } from "../model/viewConfig";
import type { TableColumnModel } from "./table-column-models";
import { resolveValidationIssue } from "../validation/issue-lookup.mjs";
import type { ValidationSnapshot } from "../validation/issue-map";
import type { ActiveTextEditorRegistrar } from "../editing";

type TableColumnsRuntime = {
  backlinkValuesByRowId: Record<number | string, Record<string, RelationBacklink[]>>;
  tableLayoutMode: "center" | "top";
  validation: ValidationSnapshot | null;
  textEditable: boolean;
  activeTextCellId: string | null;
  onRegisterActiveTextEditor?: ActiveTextEditorRegistrar;
  onActivateTextCell: (cellId: string) => void;
  onDeactivateTextCell: (cellId: string) => void;
  onSort: (fieldName: string, direction: "asc" | "desc" | null) => void;
  onAddFilter: (fieldName: string, displayType: FieldDisplayType) => void;
  onHideField: (fieldName: string) => void;
  onResizeField: (fieldName: string, width: number) => void;
  onMoveField: (fieldName: string, direction: "left" | "right") => void;
  onDragStart: (fieldName: string, rect: DOMRect, pointerOffsetX: number) => void;
  onDragMove: (fieldName: string, clientX: number) => void;
  onDragEnd: (fieldName: string) => void;
  onDragCancel: (fieldName: string) => void;
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

type TableColumnsHeaderState = {
  sortField: string | null;
  sortDirection: "asc" | "desc" | null;
  pressedField: string | null;
  draggingField: string | null;
  tooltipSuppressed: boolean;
};

type TableColumnHeaderSnapshot = {
  sortDirection: "asc" | "desc" | null;
  pressed: boolean;
  isDragging: boolean;
  tooltipSuppressed: boolean;
};

type TableColumnsHeaderStore = ReturnType<typeof createTableColumnsHeaderStore>;
type CellFrameMeta = { kind: TableCellContentKind; layout: TableCellLayout };

const TableColumnsRuntimeContext = createContext<TableColumnsRuntime | null>(null);
const TableColumnsHeaderStoreContext = createContext<TableColumnsHeaderStore | null>(null);

export function TableColumnsRuntimeProvider(
  {
    value,
    headerState,
    children,
  }: { value: TableColumnsRuntime; headerState: TableColumnsHeaderState; children: ReactNode },
) {
  const storeRef = useRef<TableColumnsHeaderStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = createTableColumnsHeaderStore(headerState);
  }
  useEffect(() => {
    storeRef.current?.setState(headerState);
  }, [headerState]);
  return (
    <TableColumnsRuntimeContext.Provider value={value}>
      <TableColumnsHeaderStoreContext.Provider value={storeRef.current}>
        {children}
      </TableColumnsHeaderStoreContext.Provider>
    </TableColumnsRuntimeContext.Provider>
  );
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

function useTableColumnHeaderSnapshot(fieldName: string) {
  const store = useContext(TableColumnsHeaderStoreContext);
  if (!store) throw new Error("TableColumnsHeaderStoreContext is missing");
  return useSyncExternalStore(
    (listener) => store.subscribeField(fieldName, listener),
    () => store.getFieldSnapshot(fieldName),
    () => store.getFieldSnapshot(fieldName),
  );
}

function TableColumnHeaderView({ columnModel }: { columnModel: TableColumnModel }) {
  const runtime = useTableColumnsRuntime();
  const headerState = useTableColumnHeaderSnapshot(columnModel.fieldName);
  return (
    <ColumnHeader
      fieldName={columnModel.fieldName}
      roleKind={columnModel.roleKind}
      allowTypeChange={columnModel.allowTypeChange}
      displayType={columnModel.displayType}
      relationConfigured={columnModel.relationConfigured}
      sortDirection={headerState.sortDirection}
      tooltipSuppressed={headerState.tooltipSuppressed}
      wrapped={columnModel.wrapped}
      width={columnModel.width}
      pressed={headerState.pressed}
      onSort={(direction) => runtime.onSort(columnModel.fieldName, direction)}
      onAddFilter={() => runtime.onAddFilter(columnModel.fieldName, columnModel.displayType)}
      onHide={() => runtime.onHideField(columnModel.fieldName)}
      onResize={(width) => runtime.onResizeField(columnModel.fieldName, width)}
      onMove={(direction) => runtime.onMoveField(columnModel.fieldName, direction)}
      isDragging={headerState.isDragging}
      onDragStart={runtime.onDragStart}
      onDragMove={runtime.onDragMove}
      onDragEnd={runtime.onDragEnd}
      onDragCancel={runtime.onDragCancel}
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
  const displayType = columnModel.relationConfig ? "Relation" : columnModel.displayType;
  const cellId = `${rowId}:${columnModel.fieldName}`;
  const textEditingActive = runtime.activeTextCellId === cellId;
  const frameMeta = resolveCellFrameMeta(columnModel, displayType, value, runtime.tableLayoutMode, runtime.textEditable, textEditingActive);

  if (columnModel.backlinkColumn) {
    return (
      <TableCellFrame kind={frameMeta.kind} layout={frameMeta.layout}>
        <BacklinkCellViewer
          items={runtime.backlinkValuesByRowId[rowId]?.[columnModel.fieldName] ?? []}
          status={columnModel.backlinkColumn.status}
          message={columnModel.backlinkColumn.message}
          wrapped={columnModel.wrapped}
          onOpen={runtime.onOpenBacklink}
        />
      </TableCellFrame>
    );
  }
  if (columnModel.isNested) {
    return (
      <TableCellFrame kind={frameMeta.kind} layout={frameMeta.layout}>
        <div className="table-cell-content-main">
          <button className="nested-summary" onClick={() => runtime.onSelectRow(originalRowIndex, rowId)} type="button">
            {summarizeNestedValue(value)}
          </button>
        </div>
      </TableCellFrame>
    );
  }
  if (columnModel.isTitle) {
    return (
      <TableCellFrame kind={frameMeta.kind} layout={frameMeta.layout}>
        <div className="table-cell-content-main">
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
        </div>
      </TableCellFrame>
    );
  }
  return (
    <TableCellFrame kind={frameMeta.kind} layout={frameMeta.layout}>
      <CellRenderer
        cellId={cellId}
        value={value}
        displayType={displayType}
        wrapped={columnModel.wrapped}
        multiSelectConfig={columnModel.multiSelectConfig}
        selectConfig={columnModel.selectConfig}
        relationOptions={columnModel.relationOptions}
        relationConfigured={columnModel.relationConfigured}
        relationMode={columnModel.relationConfig?.mode}
        onOpenRelationTarget={columnModel.relationConfig ? (nextValue) => runtime.onOpenRelationTarget(columnModel.relationConfig as RelationConfig, nextValue) : undefined}
        issue={resolveValidationIssue(runtime.validation, rowId, originalRowIndex, columnModel.fieldName)}
        textEditable={runtime.textEditable}
        textEditingActive={textEditingActive}
        onRegisterActiveEditor={runtime.onRegisterActiveTextEditor}
        onActivateTextCell={runtime.onActivateTextCell}
        onDeactivateTextCell={runtime.onDeactivateTextCell}
        onEdit={(next) => runtime.onEditCell(originalRowIndex, rowId, columnModel.fieldName, next)}
        onCommitMultiSelectDraft={(patch) => runtime.onCommitMultiSelectDraft(originalRowIndex, rowId, columnModel.fieldName, patch)}
        onCommitSelectDraft={(patch) => runtime.onCommitSelectDraft(originalRowIndex, rowId, columnModel.fieldName, patch)}
      />
    </TableCellFrame>
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

function resolveCellFrameMeta(
  columnModel: TableColumnModel,
  displayType: FieldDisplayType,
  value: unknown,
  tableLayoutMode: "center" | "top",
  textEditable: boolean,
  textEditingActive: boolean,
): CellFrameMeta {
  const layout: TableCellLayout = tableLayoutMode;
  if (columnModel.backlinkColumn) {
    return { kind: "backlink", layout };
  }
  if (columnModel.isNested) {
    return { kind: "nested", layout };
  }
  if (columnModel.isTitle) {
    return { kind: "title", layout };
  }
  if (!isCompatible(displayType, value)) {
    return { kind: "incompatible", layout };
  }
  if (displayType === "Checkbox") {
    return { kind: "checkbox", layout };
  }
  if (displayType === "Select" || displayType === "Multi-select" || displayType === "Relation") {
    return { kind: "token", layout };
  }
  if (
    displayType === "Text" &&
    textEditable &&
    (value == null || typeof value === "string" || typeof value === "number")
  ) {
    return { kind: "editor", layout };
  }
  return { kind: "text", layout };
}

function createTableColumnsHeaderStore(initialState: TableColumnsHeaderState) {
  let state = initialState;
  const listeners = new Set<() => void>();
  const snapshotCache = new Map<string, TableColumnHeaderSnapshot>();

  function getFieldSnapshot(fieldName: string) {
    const nextSnapshot: TableColumnHeaderSnapshot = {
      sortDirection: state.sortField === fieldName ? state.sortDirection : null,
      pressed: state.pressedField === fieldName,
      isDragging: state.draggingField === fieldName,
      tooltipSuppressed: state.tooltipSuppressed,
    };
    const cached = snapshotCache.get(fieldName);
    if (cached && sameHeaderSnapshot(cached, nextSnapshot)) return cached;
    snapshotCache.set(fieldName, nextSnapshot);
    return nextSnapshot;
  }

  return {
    getFieldSnapshot,
    subscribeField(fieldName: string, listener: () => void) {
      let previousSnapshot = getFieldSnapshot(fieldName);
      const notifyIfChanged = () => {
        const nextSnapshot = getFieldSnapshot(fieldName);
        if (sameHeaderSnapshot(previousSnapshot, nextSnapshot)) return;
        previousSnapshot = nextSnapshot;
        listener();
      };
      listeners.add(notifyIfChanged);
      return () => listeners.delete(notifyIfChanged);
    },
    setState(nextState: TableColumnsHeaderState) {
      if (sameHeaderState(state, nextState)) return;
      state = nextState;
      listeners.forEach((listener) => listener());
    },
  };
}

function sameHeaderState(previous: TableColumnsHeaderState, next: TableColumnsHeaderState) {
  return previous.sortField === next.sortField &&
    previous.sortDirection === next.sortDirection &&
    previous.pressedField === next.pressedField &&
    previous.draggingField === next.draggingField &&
    previous.tooltipSuppressed === next.tooltipSuppressed;
}

function sameHeaderSnapshot(previous: TableColumnHeaderSnapshot, next: TableColumnHeaderSnapshot) {
  return previous.sortDirection === next.sortDirection &&
    previous.pressed === next.pressed &&
    previous.isDragging === next.isDragging &&
    previous.tooltipSuppressed === next.tooltipSuppressed;
}
