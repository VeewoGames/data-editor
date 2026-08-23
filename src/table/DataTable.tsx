import { flexRender, getCoreRowModel, useReactTable, type HeaderGroup } from "@tanstack/react-table";
import * as Popover from "@radix-ui/react-popover";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  buildColumnPreviewOrderState,
  buildPreviewOrderFromSlots,
  collectColumnSlots,
  getPointerXInScrollSpace,
  projectHeaderFieldsByPreviewOrder,
  resolveAutoScrollDirection,
  scrollColumnContainer,
} from "./column-dnd.mjs";
import { forwardOptionFieldSurfaceClick, type OptionFieldDraftCommit } from "./OptionFieldEditor";
import { buildTableColumns, TableColumnsRuntimeProvider } from "./table-columns";
import { buildTableColumnModels, getColumnModelDisplayType } from "./table-column-models.mjs";
import { buildTableColumnModelsSignature } from "./table-column-signatures.mjs";
import { buildOptionFieldClearPatch, buildSelectionRect, isCellInsideRect, resolveClearValueByDisplayType } from "./table-selection.mjs";
import { buildVisibleTableRenderContract } from "./table-render-contract.mjs";
import type { DataRecord, DocumentModel } from "../model/documentModel";
import type { TableRowView } from "../model/document-store";
import { getMainColumns, getNestedFields } from "../model/documentModel";
import type { FieldDisplayType } from "../model/fieldTypes";
import type { RelationOption } from "../model/relations";
import { icons } from "../components/icons";
import { findTitleField } from "../model/titleField";
import type { BacklinkGridColumn } from "../model/backlinkGrid";
import type { RelationBacklink } from "../model/relationMaintenance";
import type { FieldViewConfig, MultiSelectOptionView, RelationConfig } from "../model/viewConfig";
import type { ValidationSnapshot } from "../validation/issue-map";
import { mergeMeasuredRowHeights, resolveRowHeight as resolveMeasuredRowHeight } from "./row-height-index.mjs";
import { buildTableRuntimeDeps } from "./table-runtime-deps.mjs";
import { buildVariableRowWindow } from "./variable-row-window.mjs";
import {
  hasExceededRowDragThreshold,
  isPreciseRowDragPointer,
  resolveRowAutoScrollDelta,
  resolveRowDropTarget,
} from "./row-dnd.mjs";
import type { ActiveTextEditorRegistrar } from "../editing";
import type { DocumentIndexEntry } from "../api/client";

export type TableFieldConfig = {
  displayTypes: Record<string, FieldDisplayType>;
  hidden: Set<string>;
  wrapped: Set<string>;
  widths: Record<string, number>;
  order: string[];
};

export type FieldConfig = TableFieldConfig & {
  detailOrder: string[];
};

export type MultiSelectFieldOptionConfig = {
  options: MultiSelectOptionView[];
  optionMap: Record<string, MultiSelectOptionView>;
};

export type SelectFieldOptionConfig = {
  options: MultiSelectOptionView[];
  optionMap: Record<string, MultiSelectOptionView>;
};

const compactRowHeight = 36;
const estimatedWrappedRowHeight = 72;
const rowOverscan = 8;
const rowActionColumnWidth = 42;
const addColumnWidth = 44;
const tableBottomBufferHeight = 300;
const interactiveSelectionDragThreshold = 4;

type TableCellCoord = {
  rowId: string;
  visibleRowIndex: number;
  fieldName: string;
  visibleColumnIndex: number;
};

type PendingInteractiveSelection = {
  anchor: TableCellCoord;
  clientX: number;
  clientY: number;
};

type RowDropTarget = {
  rowId: string;
  placement: "before" | "after";
};

type ActiveRowDrag = {
  sourceRowId: string;
  sourceRowIndex: number;
  pointerId: number;
  startX: number;
  startY: number;
  dragging: boolean;
  handle: HTMLButtonElement;
};

type RowDragVisual = {
  sourceRowId: string;
  target: RowDropTarget | null;
};

function sameTableCellCoord(left: TableCellCoord | null, right: TableCellCoord | null) {
  if (!left || !right) return false;
  return left.rowId === right.rowId &&
    left.fieldName === right.fieldName &&
    left.visibleRowIndex === right.visibleRowIndex &&
    left.visibleColumnIndex === right.visibleColumnIndex;
}

export type TableSnapshot = {
  schemaModel: DocumentModel;
  sourcePath: string | null;
  collectionPath: string;
  rowViews: TableRowView[];
  allRows?: DataRecord[];
  fieldConfig: TableFieldConfig;
  fieldViewConfigs: Record<string, FieldViewConfig>;
  backlinkColumns: BacklinkGridColumn[];
  backlinkValuesByRowId: Record<string, Record<string, RelationBacklink[]>>;
  relationOptions: Record<string, RelationOption[]>;
  relationConfigs: Record<string, RelationConfig>;
  documentIndexEntries: Record<string, DocumentIndexEntry>;
  documentConfiguredFields: string[];
  revision: number;
  sort: { field: string; direction: "asc" | "desc" } | null;
  validation: ValidationSnapshot;
  titleField: string | null;
  primaryKeyField: string | null;
  scrollRestoreKey: string | null;
  initialScrollPosition: { scrollTop: number; scrollLeft: number } | null;
  textEditable: boolean;
  showFieldNames: boolean;
  canReorderRows: boolean;
  onEnableTextEditMode?: () => void;
  onRegisterActiveTextEditor?: ActiveTextEditorRegistrar;
};

type DataTableProps = {
  snapshot: TableSnapshot;
  onScrollPositionChange: (position: { scrollTop: number; scrollLeft: number }) => void;
  onSelectRow: (rowIndex: number, rowId: string | null) => void;
  onOpenDetail: (rowIndex: number, rowId: string | null) => void;
  onOpenNestedDetail: (rowIndex: number, rowId: string | null, fieldName: string) => void;
  onOpenBacklink: (backlink: RelationBacklink) => void;
  onEditCell: (rowIndex: number, rowId: string | null, fieldName: string, value: unknown) => void;
  onCommitMultiSelectDraft: (rowIndex: number, rowId: string | null, fieldName: string, patch: OptionFieldDraftCommit) => void;
  onCommitSelectDraft: (rowIndex: number, rowId: string | null, fieldName: string, patch: OptionFieldDraftCommit) => void;
  onChangeFieldType: (fieldName: string, displayType: FieldDisplayType) => void;
  onHideField: (fieldName: string) => void;
  onToggleWrapField: (fieldName: string) => void;
  onResizeField: (fieldName: string, width: number) => void;
  onMoveField: (fieldName: string, direction: "left" | "right") => void;
  onReorderFields: (order: string[]) => void;
  onSort: (fieldName: string, direction: "asc" | "desc" | null) => void;
  onAddFilter: (fieldName: string, fieldType: FieldDisplayType) => void;
  onSetTitleField: (fieldName: string) => void;
  onSetPrimaryKeyField: (fieldName: string) => void;
  onConfigureRelation: (fieldName: string) => void;
  onClearRelation: (fieldName: string) => void;
  onConfigureDocument: (fieldName: string) => void;
  onClearDocument: (fieldName: string) => void;
  onOpenRelationTarget: (config: RelationConfig, value: string | number) => void;
  onAddRow: () => void;
  onDuplicateRow: (rowIndex: number, rowId: string | null) => void;
  onReorderRows: (sourceRowId: string, targetRowId: string, placement: "before" | "after") => void;
  onDeleteRow: (rowIndex: number, rowId: string | null) => void;
  onAddField: () => void;
  onDeleteField: (fieldName: string) => void;
};

function DataTableComponent(props: DataTableProps) {
  const { snapshot } = props;
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(720);
  const [pressedField, setPressedField] = useState<string | null>(null);
  const [activeTextCellId, setActiveTextCellId] = useState<string | null>(null);
  const [selectionAnchor, setSelectionAnchor] = useState<TableCellCoord | null>(null);
  const [selectionFocus, setSelectionFocus] = useState<TableCellCoord | null>(null);
  const [selectionPointerActive, setSelectionPointerActive] = useState(false);
  const [activeOptionFieldCellId, setActiveOptionFieldCellId] = useState<string | null>(null);
  const [openRowActionId, setOpenRowActionId] = useState<string | null>(null);
  const [rowDragVisual, setRowDragVisual] = useState<RowDragVisual | null>(null);
  const [columnDragSession, setColumnDragSession] = useState<{
    draggingField: string;
    ghostTop: number;
    width: number;
    height: number;
    pointerOffsetX: number;
  } | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const scrollMetricsRef = useRef({ scrollTop: 0, scrollLeft: 0, viewportHeight: 720 });
  const columnDragSessionRef = useRef<typeof columnDragSession>(null);
  const columnDragPreviewStoreRef = useRef(createColumnDragPreviewStore());
  const columnDragPointerXRef = useRef<number | null>(null);
  const columnDragAutoScrollDirectionRef = useRef<-1 | 0 | 1>(0);
  const columnDragAutoScrollFrameRef = useRef<number | null>(null);
  const activeRowDragRef = useRef<ActiveRowDrag | null>(null);
  const rowDropTargetRef = useRef<RowDropTarget | null>(null);
  const rowPointerXRef = useRef<number | null>(null);
  const rowPointerYRef = useRef<number | null>(null);
  const rowAutoScrollFrameRef = useRef<number | null>(null);
  const suppressRowHandleClickRef = useRef<string | null>(null);
  const suppressRowHandleClickTimerRef = useRef<number | null>(null);
  const optionFieldClosersRef = useRef<Record<string, () => void>>({});
  const localWidthsRef = useRef<Record<string, number>>({ ...snapshot.fieldConfig.widths });
  const rowElementRefs = useRef<Record<string, HTMLTableRowElement | null>>({});
  const previousTableRenderContractRef = useRef<ReturnType<typeof buildVisibleTableRenderContract> | null>(null);
  const previousColumnModelsByFieldRef = useRef<Record<string, ReturnType<typeof buildTableColumnModels>[number]>>({});
  const selectionPointerActiveRef = useRef(false);
  const selectionExpandedRef = useRef(false);
  const suppressNextSelectionClickRef = useRef(false);
  const pendingInteractiveSelectionRef = useRef<PendingInteractiveSelection | null>(null);
  const runtimeActionRef = useRef({
    onSort: props.onSort,
    onAddFilter: props.onAddFilter,
    onSetTitleField: props.onSetTitleField,
    onSetPrimaryKeyField: props.onSetPrimaryKeyField,
    onHideField: props.onHideField,
    onMoveField: props.onMoveField,
    onToggleWrapField: props.onToggleWrapField,
    onChangeFieldType: props.onChangeFieldType,
    onConfigureRelation: props.onConfigureRelation,
    onClearRelation: props.onClearRelation,
    onConfigureDocument: props.onConfigureDocument,
    onClearDocument: props.onClearDocument,
    onDeleteField: props.onDeleteField,
    onOpenRelationTarget: props.onOpenRelationTarget,
    onSelectRow: props.onSelectRow,
    onOpenDetail: props.onOpenDetail,
    onOpenNestedDetail: props.onOpenNestedDetail,
    onOpenBacklink: props.onOpenBacklink,
    onEditCell: props.onEditCell,
    onCommitMultiSelectDraft: props.onCommitMultiSelectDraft,
    onCommitSelectDraft: props.onCommitSelectDraft,
    onResizeField: props.onResizeField,
    onReorderFields: props.onReorderFields,
    onDuplicateRow: props.onDuplicateRow,
    onDeleteRow: props.onDeleteRow,
    onReorderRows: props.onReorderRows,
  });
  const restoredScrollContextKeyRef = useRef<string | null>(null);
  const [measuredRowHeights, setMeasuredRowHeights] = useState<Record<string, number>>({});
  const rowViews = snapshot.rowViews;
  const rowIds = useMemo(() => rowViews.map((view) => view.rowId), [rowViews]);
  const rows = useMemo(() => rowViews.map((view) => view.row), [rowViews]);
  const optionRows = snapshot.allRows ?? rows;
  const schemaModel = snapshot.schemaModel;
  const nestedFieldSet = useMemo<Set<string>>(
    () => new Set<string>(getNestedFields(schemaModel, snapshot.collectionPath)),
    [schemaModel, snapshot.collectionPath],
  );

  useEffect(() => {
    localWidthsRef.current = { ...snapshot.fieldConfig.widths };
  }, [snapshot.sourcePath, snapshot.collectionPath, snapshot.revision, snapshot.fieldConfig.widths]);

  useEffect(() => {
    setActiveTextCellId(null);
  }, [snapshot.textEditable, snapshot.sourcePath, snapshot.collectionPath]);
  useEffect(() => {
    cancelRowDrag();
    setOpenRowActionId(null);
  }, [snapshot.sourcePath, snapshot.collectionPath, snapshot.revision]);
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !activeRowDragRef.current) return;
      event.preventDefault();
      cancelRowDrag();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      stopRowAutoScroll();
      if (suppressRowHandleClickTimerRef.current != null) {
        window.clearTimeout(suppressRowHandleClickTimerRef.current);
      }
    };
  }, []);
  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const activeDrag = activeRowDragRef.current;
      if (!activeDrag?.dragging || activeDrag.pointerId !== event.pointerId) return;
      event.preventDefault();
      moveActiveRowDrag(event.pointerId, event.clientX, event.clientY);
    };
    const handlePointerUp = (event: PointerEvent) => {
      const activeDrag = activeRowDragRef.current;
      if (!activeDrag?.dragging || activeDrag.pointerId !== event.pointerId) return;
      event.preventDefault();
      finishActiveRowDrag(event.pointerId, event.clientX, event.clientY);
    };
    const handlePointerCancel = (event: PointerEvent) => {
      const activeDrag = activeRowDragRef.current;
      if (!activeDrag?.dragging || activeDrag.pointerId !== event.pointerId) return;
      cancelRowDrag(false);
    };
    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
    };
  }, [rowIds]);

  useEffect(() => {
    setScrollTop(0);
    scrollMetricsRef.current = { scrollTop: 0, scrollLeft: 0, viewportHeight: scrollMetricsRef.current.viewportHeight };
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
      scrollContainerRef.current.scrollLeft = 0;
    }
  }, [snapshot.sourcePath, snapshot.collectionPath]);
  useEffect(() => {
    if (!snapshot.scrollRestoreKey) return;
    if (restoredScrollContextKeyRef.current === snapshot.scrollRestoreKey) return;
    restoredScrollContextKeyRef.current = snapshot.scrollRestoreKey;
    const nextScrollTop = snapshot.initialScrollPosition?.scrollTop ?? 0;
    const nextScrollLeft = snapshot.initialScrollPosition?.scrollLeft ?? 0;
    scrollMetricsRef.current = {
      scrollTop: nextScrollTop,
      scrollLeft: nextScrollLeft,
      viewportHeight: scrollMetricsRef.current.viewportHeight,
    };
    setScrollTop(nextScrollTop);
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = nextScrollTop;
      scrollContainerRef.current.scrollLeft = nextScrollLeft;
    }
  }, [snapshot.scrollRestoreKey, snapshot.initialScrollPosition]);
  useEffect(() => {
    columnDragSessionRef.current = columnDragSession;
  }, [columnDragSession]);
  useEffect(() => () => stopColumnAutoScroll(), []);
  const allColumns = useMemo(() => orderColumns([
    ...getMainColumns(schemaModel, snapshot.collectionPath),
    ...nestedFieldSet,
    ...snapshot.backlinkColumns.map((column) => column.fieldName),
  ], snapshot.fieldConfig.order), [schemaModel, snapshot.collectionPath, snapshot.fieldConfig.order, nestedFieldSet, snapshot.backlinkColumns]);

  const detectedTitleField = snapshot.titleField ?? findTitleField(allColumns, rows);
  const visibleBaseFields = useMemo(() => allColumns.filter((field) => !snapshot.fieldConfig.hidden.has(field)), [allColumns, snapshot.fieldConfig.hidden]);
  const baseVisibleFields = useMemo(
    () => snapshot.fieldConfig.order.length ? visibleBaseFields : moveTitleFirst(visibleBaseFields, detectedTitleField),
    [visibleBaseFields, detectedTitleField, snapshot.fieldConfig.order.length],
  );
  const visibleFields = baseVisibleFields;
  const hasWrappedField = useMemo(() => visibleFields.some((field) => snapshot.fieldConfig.wrapped.has(field)), [visibleFields, snapshot.fieldConfig.wrapped]);
  const variableRowWindow = useMemo(() => hasWrappedField
    ? buildVariableRowWindow({
      rowIds,
      viewportHeight,
      scrollTop,
      overscan: rowOverscan,
      getRowHeight: (rowId) => resolveMeasuredRowHeight(rowId, measuredRowHeights, estimatedWrappedRowHeight),
    })
    : null, [hasWrappedField, rowIds, viewportHeight, scrollTop, measuredRowHeights]);
  const {
    fieldOptions,
    selectOptions,
    relationOptionsByField,
    relationConfigByField,
    documentLabelsByField,
    fieldLabelsByField,
  } = useMemo(() => buildTableRuntimeDeps({
    visibleFields,
    rows,
    optionRows,
    sourcePath: snapshot.sourcePath,
    collectionPath: snapshot.collectionPath,
    primaryKeyField: snapshot.primaryKeyField,
    displayTypes: snapshot.fieldConfig.displayTypes,
    fieldViewConfigs: snapshot.fieldViewConfigs,
    relationConfigs: snapshot.relationConfigs,
    relationOptions: snapshot.relationOptions,
    documentIndexEntries: snapshot.documentIndexEntries,
  }), [
    visibleFields,
    rows,
    optionRows,
    snapshot.sourcePath,
    snapshot.collectionPath,
    snapshot.primaryKeyField,
    snapshot.fieldConfig.displayTypes,
    snapshot.fieldViewConfigs,
    snapshot.relationConfigs,
    snapshot.relationOptions,
    snapshot.documentIndexEntries,
  ]);
  const windowSize = hasWrappedField ? (variableRowWindow?.windowEnd ?? rows.length) - (variableRowWindow?.windowStart ?? 0) : Math.ceil(viewportHeight / compactRowHeight) + rowOverscan * 2;
  const rawWindowStart = Math.max(0, Math.floor(scrollTop / compactRowHeight) - rowOverscan);
  const maxWindowStart = Math.max(0, rows.length - windowSize);
  const windowStart = hasWrappedField ? (variableRowWindow?.windowStart ?? 0) : Math.min(rawWindowStart, maxWindowStart);
  const windowEnd = hasWrappedField ? (variableRowWindow?.windowEnd ?? rows.length) : Math.min(rows.length, windowStart + windowSize);
  const data = useMemo(() => rowViews.slice(windowStart, windowEnd), [rowViews, windowStart, windowEnd]);
  const topSpacerHeight = hasWrappedField ? (variableRowWindow?.topSpacerHeight ?? 0) : windowStart * compactRowHeight;
  const bottomSpacerHeight = hasWrappedField ? (variableRowWindow?.bottomSpacerHeight ?? 0) : Math.max(0, (rows.length - windowEnd) * compactRowHeight);
  const totalBottomSpacerHeight = bottomSpacerHeight + (rows.length > 0 ? tableBottomBufferHeight : 0);
  const tableColumnCount = visibleFields.length + 2;
  const tableWidth = useMemo(() => {
    return rowActionColumnWidth + addColumnWidth + visibleFields.reduce((total, fieldName) => total + getColumnWidth(fieldName), 0);
  }, [visibleFields, snapshot.fieldConfig.widths]);
  const tableRenderContract = useMemo(
    () => buildVisibleTableRenderContract({
      rowViews: data,
      windowStart,
      previousContract: previousTableRenderContractRef.current,
    }),
    [data, windowStart],
  );
  useEffect(() => {
    previousTableRenderContractRef.current = tableRenderContract;
  }, [tableRenderContract]);
  useEffect(() => {
    runtimeActionRef.current = {
      onSort: props.onSort,
      onAddFilter: props.onAddFilter,
      onSetTitleField: props.onSetTitleField,
      onSetPrimaryKeyField: props.onSetPrimaryKeyField,
      onHideField: props.onHideField,
      onMoveField: props.onMoveField,
      onToggleWrapField: props.onToggleWrapField,
      onChangeFieldType: props.onChangeFieldType,
      onConfigureRelation: props.onConfigureRelation,
      onClearRelation: props.onClearRelation,
      onConfigureDocument: props.onConfigureDocument,
      onClearDocument: props.onClearDocument,
      onDeleteField: props.onDeleteField,
      onOpenRelationTarget: props.onOpenRelationTarget,
      onSelectRow: props.onSelectRow,
      onOpenDetail: props.onOpenDetail,
      onOpenNestedDetail: props.onOpenNestedDetail,
      onOpenBacklink: props.onOpenBacklink,
      onEditCell: props.onEditCell,
      onCommitMultiSelectDraft: props.onCommitMultiSelectDraft,
      onCommitSelectDraft: props.onCommitSelectDraft,
      onResizeField: props.onResizeField,
      onReorderFields: props.onReorderFields,
      onDuplicateRow: props.onDuplicateRow,
      onDeleteRow: props.onDeleteRow,
      onReorderRows: props.onReorderRows,
    };
  }, [
    props.onSort,
    props.onAddFilter,
    props.onSetTitleField,
    props.onSetPrimaryKeyField,
    props.onHideField,
    props.onMoveField,
    props.onToggleWrapField,
    props.onChangeFieldType,
    props.onConfigureRelation,
    props.onClearRelation,
    props.onConfigureDocument,
    props.onClearDocument,
    props.onDeleteField,
    props.onOpenRelationTarget,
    props.onSelectRow,
    props.onOpenDetail,
    props.onOpenNestedDetail,
    props.onOpenBacklink,
    props.onEditCell,
    props.onCommitMultiSelectDraft,
    props.onCommitSelectDraft,
    props.onResizeField,
    props.onReorderFields,
    props.onDuplicateRow,
    props.onDeleteRow,
    props.onReorderRows,
  ]);
  const tableData = tableRenderContract.rows;
  const columnModelSignature = useMemo(() => buildTableColumnModelsSignature({
    visibleFields,
    rows,
    nestedFieldSet,
    displayTypes: snapshot.fieldConfig.displayTypes,
    wrappedFields: snapshot.fieldConfig.wrapped,
    detectedTitleField,
    primaryKeyField: snapshot.primaryKeyField,
    backlinkColumns: snapshot.backlinkColumns,
    relationOptionsByField,
    relationConfigByField,
    fieldOptions,
    selectOptions,
    fieldLabelsByField,
    documentLabelsByField,
    documentConfiguredFields: new Set(snapshot.documentConfiguredFields),
    widths: snapshot.fieldConfig.widths,
    textEditable: snapshot.textEditable,
    showFieldNames: snapshot.showFieldNames,
  }), [
    visibleFields,
    rows,
    nestedFieldSet,
    snapshot.fieldConfig.displayTypes,
    snapshot.fieldConfig.wrapped,
    detectedTitleField,
    snapshot.backlinkColumns,
    relationOptionsByField,
    relationConfigByField,
    fieldOptions,
    selectOptions,
    fieldLabelsByField,
    documentLabelsByField,
    snapshot.documentConfiguredFields,
    snapshot.fieldConfig.widths,
    snapshot.textEditable,
    snapshot.showFieldNames,
  ]);
  const columnModels = useMemo(() => buildTableColumnModels({
    visibleFields,
    rows,
    nestedFieldSet,
    displayTypes: snapshot.fieldConfig.displayTypes,
    wrappedFields: snapshot.fieldConfig.wrapped,
    detectedTitleField,
    primaryKeyField: snapshot.primaryKeyField,
    backlinkColumns: snapshot.backlinkColumns,
    relationOptionsByField,
    relationConfigByField,
    fieldOptions,
    selectOptions,
    fieldLabelsByField,
    showFieldNames: snapshot.showFieldNames,
    documentLabelsByField,
    documentConfiguredFields: new Set(snapshot.documentConfiguredFields),
    getColumnWidth,
    previousByField: previousColumnModelsByFieldRef.current,
  }), [columnModelSignature, snapshot.documentConfiguredFields]);
  useEffect(() => {
    previousColumnModelsByFieldRef.current = Object.fromEntries(columnModels.map((model) => [model.fieldName, model]));
  }, [columnModels]);
  const columns = useMemo(() => buildTableColumns(columnModels), [columnModels]);
  const columnModelsByField = useMemo(
    () => Object.fromEntries(columnModels.map((columnModel) => [columnModel.fieldName, columnModel])),
    [columnModels],
  );
  const handleSort = useCallback((fieldName: string, direction: "asc" | "desc" | null) => {
    runtimeActionRef.current.onSort(fieldName, direction);
  }, []);
  const handleAddFilter = useCallback((fieldName: string, displayType: FieldDisplayType) => {
    runtimeActionRef.current.onAddFilter(fieldName, displayType);
  }, []);
  const handleSetTitleField = useCallback((fieldName: string) => {
    runtimeActionRef.current.onSetTitleField(fieldName);
  }, []);
  const handleSetPrimaryKeyField = useCallback((fieldName: string) => {
    runtimeActionRef.current.onSetPrimaryKeyField(fieldName);
  }, []);
  const handleHideField = useCallback((fieldName: string) => {
    runtimeActionRef.current.onHideField(fieldName);
  }, []);
  const handleMoveField = useCallback((fieldName: string, direction: "left" | "right") => {
    runtimeActionRef.current.onMoveField(fieldName, direction);
  }, []);
  const handleToggleWrapField = useCallback((fieldName: string) => {
    runtimeActionRef.current.onToggleWrapField(fieldName);
  }, []);
  const handleChangeFieldType = useCallback((fieldName: string, displayType: FieldDisplayType) => {
    runtimeActionRef.current.onChangeFieldType(fieldName, displayType);
  }, []);
  const handleConfigureRelation = useCallback((fieldName: string) => {
    runtimeActionRef.current.onConfigureRelation(fieldName);
  }, []);
  const handleClearRelation = useCallback((fieldName: string) => {
    runtimeActionRef.current.onClearRelation(fieldName);
  }, []);
  const handleConfigureDocument = useCallback((fieldName: string) => {
    runtimeActionRef.current.onConfigureDocument(fieldName);
  }, []);
  const handleClearDocument = useCallback((fieldName: string) => {
    runtimeActionRef.current.onClearDocument(fieldName);
  }, []);
  const handleDeleteField = useCallback((fieldName: string) => {
    runtimeActionRef.current.onDeleteField(fieldName);
  }, []);
  const handleOpenRelationTarget = useCallback((config: RelationConfig, value: string | number) => {
    runtimeActionRef.current.onOpenRelationTarget(config, value);
  }, []);
  const handleOpenBacklink = useCallback((backlink: RelationBacklink) => {
    runtimeActionRef.current.onOpenBacklink(backlink);
  }, []);
  const handleEditCell = useCallback((rowIndex: number, rowId: string, fieldName: string, next: unknown) => {
    runtimeActionRef.current.onEditCell(rowIndex, rowId, fieldName, next);
  }, []);
  const handleCommitMultiSelectDraft = useCallback((rowIndex: number, rowId: string, fieldName: string, patch: OptionFieldDraftCommit) => {
    runtimeActionRef.current.onCommitMultiSelectDraft(rowIndex, rowId, fieldName, patch);
  }, []);
  const handleCommitSelectDraft = useCallback((rowIndex: number, rowId: string, fieldName: string, patch: OptionFieldDraftCommit) => {
    runtimeActionRef.current.onCommitSelectDraft(rowIndex, rowId, fieldName, patch);
  }, []);
  const handleActivateTextCell = useCallback((cellId: string) => {
    if (!snapshot.textEditable) return;
    setActiveTextCellId((current) => current === cellId ? current : cellId);
  }, [snapshot.textEditable]);
  const handleDeactivateTextCell = useCallback((cellId: string) => {
    setActiveTextCellId((current) => current === cellId ? null : current);
  }, []);

  const handleOptionFieldOpenState = useCallback((cellId: string, open: boolean, close: () => void) => {
    if (open) {
      optionFieldClosersRef.current[cellId] = close;
      setActiveOptionFieldCellId(cellId);
      return;
    }
    delete optionFieldClosersRef.current[cellId];
    setActiveOptionFieldCellId((current) => current === cellId ? null : current);
  }, []);

  const closeActiveOptionField = useCallback(() => {
    if (!activeOptionFieldCellId) return;
    optionFieldClosersRef.current[activeOptionFieldCellId]?.();
  }, [activeOptionFieldCellId]);

  useEffect(() => () => closeActiveOptionField(), [closeActiveOptionField]);

  const selectRowByRuntime = useCallback((rowIndex: number, rowId: string | null) => {
    runtimeActionRef.current.onSelectRow(rowIndex, rowId);
  }, []);

  const openDetailByRuntime = useCallback((rowIndex: number, rowId: string | null) => {
    runtimeActionRef.current.onOpenDetail(rowIndex, rowId);
  }, []);

  const openNestedDetailByRuntime = useCallback((rowIndex: number, rowId: string | null, fieldName: string) => {
    runtimeActionRef.current.onOpenNestedDetail(rowIndex, rowId, fieldName);
  }, []);

  const selectRow = useCallback((event: ReactMouseEvent<HTMLTableRowElement>, rowIndex: number, rowId: string | null) => {
    const rowElement = event.currentTarget;
    rowElement.closest("tbody")?.querySelectorAll("tr.selected-row").forEach((row) => row.classList.remove("selected-row"));
    rowElement.classList.add("selected-row");
    selectRowByRuntime(rowIndex, rowId);
  }, [selectRowByRuntime]);

  const resizeField = useCallback((fieldName: string, width: number) => {
    localWidthsRef.current = { ...localWidthsRef.current, [fieldName]: width };
    runtimeActionRef.current.onResizeField(fieldName, width);
  }, []);

  function getColumnWidth(fieldName: string) {
    return localWidthsRef.current[fieldName] ?? 180;
  }

  const handlePressChange = useCallback((fieldName: string, pressed: boolean) => {
    setPressedField((current) => {
      if (pressed) return fieldName;
      return current === fieldName ? null : current;
    });
  }, []);

  const handleColumnDragStart = useCallback((fieldName: string, rect: DOMRect, pointerOffsetX: number) => {
    setPressedField(null);
    columnDragPointerXRef.current = rect.left + pointerOffsetX;
    columnDragAutoScrollDirectionRef.current = 0;
    stopColumnAutoScroll();
    columnDragPreviewStoreRef.current.setState({
      ...buildColumnPreviewOrderState(baseVisibleFields, baseVisibleFields),
      ghostLeft: rect.left,
    });
    const nextSession = {
      draggingField: fieldName,
      ghostTop: rect.top,
      width: rect.width,
      height: rect.height,
      pointerOffsetX,
    };
    columnDragSessionRef.current = nextSession;
    setColumnDragSession(nextSession);
  }, [baseVisibleFields]);

  const handleColumnDragMove = useCallback((fieldName: string, clientX: number) => {
    columnDragPointerXRef.current = clientX;
    columnDragAutoScrollDirectionRef.current = resolveAutoScrollDirection(scrollContainerRef.current, clientX);
    if (columnDragAutoScrollDirectionRef.current !== 0) scheduleColumnAutoScroll();
    else stopColumnAutoScroll();
    updateColumnDragPreview(fieldName, clientX);
  }, []);

  const handleColumnDragEnd = useCallback((fieldName: string) => {
    setPressedField(null);
    columnDragPointerXRef.current = null;
    columnDragAutoScrollDirectionRef.current = 0;
    stopColumnAutoScroll();
    const current = columnDragSessionRef.current;
    if (!current || current.draggingField !== fieldName) return;
    runtimeActionRef.current.onReorderFields(columnDragPreviewStoreRef.current.getState().previewOrder);
    columnDragPreviewStoreRef.current.setState({ ...buildColumnPreviewOrderState([], []), ghostLeft: 0 });
    columnDragSessionRef.current = null;
    setColumnDragSession(null);
  }, []);

  const handleColumnDragCancel = useCallback((fieldName: string) => {
    setPressedField(null);
    columnDragPointerXRef.current = null;
    columnDragAutoScrollDirectionRef.current = 0;
    stopColumnAutoScroll();
    const current = columnDragSessionRef.current;
    if (!current || current.draggingField !== fieldName) return;
    columnDragPreviewStoreRef.current.setState({ ...buildColumnPreviewOrderState([], []), ghostLeft: 0 });
    columnDragSessionRef.current = null;
    setColumnDragSession(null);
  }, []);
  const tableLayoutMode: "center" | "top" = hasWrappedField ? "top" : "center";

  const tableColumnsRuntime = useMemo(() => ({
    backlinkValuesByRowId: snapshot.backlinkValuesByRowId,
    tableLayoutMode,
    validation: snapshot.validation,
    titleField: snapshot.titleField,
    primaryKeyField: snapshot.primaryKeyField,
    textEditable: snapshot.textEditable,
    showFieldNames: snapshot.showFieldNames,
    activeTextCellId,
    onEnableTextEditMode: snapshot.onEnableTextEditMode ?? (() => {}),
    onRegisterActiveTextEditor: snapshot.onRegisterActiveTextEditor,
    onActivateTextCell: handleActivateTextCell,
    onDeactivateTextCell: handleDeactivateTextCell,
    onOptionFieldOpenStateChange: handleOptionFieldOpenState,
    onSort: handleSort,
    onAddFilter: handleAddFilter,
    onSetTitleField: handleSetTitleField,
    onSetPrimaryKeyField: handleSetPrimaryKeyField,
    onHideField: handleHideField,
    onResizeField: resizeField,
    onMoveField: handleMoveField,
    onDragStart: handleColumnDragStart,
    onDragMove: handleColumnDragMove,
    onDragEnd: handleColumnDragEnd,
    onDragCancel: handleColumnDragCancel,
    onPressChange: handlePressChange,
    onToggleWrapField: handleToggleWrapField,
    onChangeFieldType: handleChangeFieldType,
    onConfigureRelation: handleConfigureRelation,
    onClearRelation: handleClearRelation,
    onConfigureDocument: handleConfigureDocument,
    onClearDocument: handleClearDocument,
    onDeleteField: handleDeleteField,
    onOpenRelationTarget: handleOpenRelationTarget,
    onSelectRow: selectRowByRuntime,
    onOpenDetail: openDetailByRuntime,
    onOpenNestedDetail: openNestedDetailByRuntime,
    onOpenBacklink: handleOpenBacklink,
    onEditCell: handleEditCell,
    onCommitMultiSelectDraft: handleCommitMultiSelectDraft,
    onCommitSelectDraft: handleCommitSelectDraft,
  }), [
    snapshot.backlinkValuesByRowId,
    tableLayoutMode,
    snapshot.validation,
    snapshot.titleField,
    snapshot.primaryKeyField,
    snapshot.textEditable,
    snapshot.showFieldNames,
    activeTextCellId,
    snapshot.onEnableTextEditMode,
    snapshot.onRegisterActiveTextEditor,
    handleActivateTextCell,
    handleDeactivateTextCell,
    handleOptionFieldOpenState,
    handleSort,
    handleAddFilter,
    handleSetTitleField,
    handleSetPrimaryKeyField,
    handleHideField,
    resizeField,
    handleMoveField,
    handleColumnDragStart,
    handleColumnDragMove,
    handleColumnDragEnd,
    handleColumnDragCancel,
    handlePressChange,
    handleToggleWrapField,
    handleChangeFieldType,
    handleConfigureRelation,
    handleClearRelation,
    handleConfigureDocument,
    handleClearDocument,
    handleDeleteField,
    handleOpenRelationTarget,
    selectRowByRuntime,
    openDetailByRuntime,
    openNestedDetailByRuntime,
    handleOpenBacklink,
    handleEditCell,
    handleCommitMultiSelectDraft,
    handleCommitSelectDraft,
  ]);
  const tableColumnsHeaderState = useMemo(() => ({
    sortField: snapshot.sort?.field ?? null,
    sortDirection: snapshot.sort?.direction ?? null,
    pressedField,
    draggingField: columnDragSession?.draggingField ?? null,
    tooltipSuppressed: columnDragSession != null,
  }), [snapshot.sort?.field, snapshot.sort?.direction, pressedField, columnDragSession]);

  const table = useReactTable({
    data: tableData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => String(row.__rowId ?? row.__rowIndex),
  });

  const selectionRect = useMemo(
    () => selectionAnchor && selectionFocus ? buildSelectionRect(selectionAnchor, selectionFocus) : null,
    [selectionAnchor, selectionFocus],
  );
  const selectedCells = useMemo(() => {
    if (!selectionRect) return [];
    return rowViews.flatMap((rowView, viewRowIndex) => visibleFields.flatMap((fieldName, visibleColumnIndex) => {
      const coord = {
        rowId: rowView.rowId,
        visibleRowIndex: viewRowIndex,
        fieldName,
        visibleColumnIndex,
      };
      if (!isCellInsideRect(selectionRect, coord)) return [];
      const columnModel = columnModelsByField[fieldName];
      if (!columnModel || columnModel.isReadonly) return [];
      return [{
        rowId: rowView.rowId,
        rowIndex: rowView.sourceIndex,
        fieldName,
        displayType: columnModel.effectiveDisplayType,
        relationMode: columnModel.relationConfig?.mode ?? null,
        value: rowView.row[fieldName],
        selectOptions: columnModel.selectConfig?.options ?? [],
        multiSelectOptions: columnModel.multiSelectConfig?.options ?? [],
      }];
    }));
  }, [selectionRect, rowViews, visibleFields, columnModelsByField]);

  const clearSelectedCells = useCallback(() => {
    if (!selectedCells.length) return;
    closeActiveOptionField();
    for (const cell of selectedCells) {
      if (cell.displayType === "Select") {
        runtimeActionRef.current.onCommitSelectDraft(
          cell.rowIndex,
          cell.rowId,
          cell.fieldName,
          buildOptionFieldClearPatch({
            mode: "single",
            options: cell.selectOptions,
            selectedValues: cell.value == null || cell.value === "" ? [] : [cell.value],
          }),
        );
        continue;
      }
      if (cell.displayType === "Multi-select") {
        runtimeActionRef.current.onCommitMultiSelectDraft(
          cell.rowIndex,
          cell.rowId,
          cell.fieldName,
          buildOptionFieldClearPatch({
            mode: "multi",
            options: cell.multiSelectOptions,
            selectedValues: Array.isArray(cell.value) ? cell.value : [],
          }),
        );
        continue;
      }
      const nextValue = resolveClearValueByDisplayType(cell.displayType, cell.relationMode);
      if (nextValue !== undefined) {
        runtimeActionRef.current.onEditCell(cell.rowIndex, cell.rowId, cell.fieldName, nextValue);
      }
    }
  }, [closeActiveOptionField, selectedCells]);

  useEffect(() => {
    function onWindowKeyDown(event: KeyboardEvent) {
      const activeElement = document.activeElement;
      if (event.key !== "Delete") return;
      if (activeElement?.tagName === "INPUT" || activeElement?.tagName === "TEXTAREA") return;
      clearSelectedCells();
    }
    window.addEventListener("keydown", onWindowKeyDown);
    return () => window.removeEventListener("keydown", onWindowKeyDown);
  }, [clearSelectedCells]);

  const clearCellSelection = useCallback(() => {
    setSelectionAnchor(null);
    setSelectionFocus(null);
    setSelectionPointerActive(false);
    selectionPointerActiveRef.current = false;
    selectionExpandedRef.current = false;
    pendingInteractiveSelectionRef.current = null;
  }, []);

  const blurActiveTextEditor = useCallback(() => {
    const activeElement = document.activeElement;
    if (!(activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement)) return;
    if (!scrollContainerRef.current?.contains(activeElement)) return;
    activeElement.blur();
  }, []);

  const finishCellSelectionPointer = useCallback((expanded: boolean) => {
    selectionPointerActiveRef.current = false;
    setSelectionPointerActive(false);
    if (expanded) suppressNextSelectionClickRef.current = true;
  }, []);

  const beginCellSelection = useCallback((coord: TableCellCoord) => {
    suppressNextSelectionClickRef.current = false;
    selectionExpandedRef.current = false;
    selectionPointerActiveRef.current = true;
    setSelectionAnchor(coord);
    setSelectionFocus(coord);
    setSelectionPointerActive(true);
  }, []);

  const extendCellSelection = useCallback((coord: TableCellCoord) => {
    setSelectionFocus((current) => {
      if (!current) return coord;
      if (current.visibleRowIndex === coord.visibleRowIndex && current.visibleColumnIndex === coord.visibleColumnIndex) {
        return current;
      }
      selectionExpandedRef.current = true;
      return coord;
    });
  }, []);

  const resolveSelectionCoordFromPoint = useCallback((clientX: number, clientY: number): TableCellCoord | null => {
    const cell = document.elementFromPoint(clientX, clientY)?.closest<HTMLTableCellElement>('td[data-cell-kind="data"]');
    if (!cell) return null;
    const rowId = cell.closest<HTMLTableRowElement>("tr[data-row-id]")?.dataset.rowId;
    const fieldName = cell.dataset.columnField;
    const visibleRowIndex = Number(cell.dataset.viewRowIndex);
    const visibleColumnIndex = Number(cell.dataset.visibleColumnIndex);
    if (!rowId || !fieldName || Number.isNaN(visibleRowIndex) || Number.isNaN(visibleColumnIndex)) return null;
    return {
      rowId,
      visibleRowIndex,
      fieldName,
      visibleColumnIndex,
    };
  }, []);

  const activatePendingInteractiveSelection = useCallback((clientX: number, clientY: number) => {
    const pending = pendingInteractiveSelectionRef.current;
    if (!pending) return false;
    if (Math.abs(clientX - pending.clientX) < interactiveSelectionDragThreshold && Math.abs(clientY - pending.clientY) < interactiveSelectionDragThreshold) {
      return false;
    }
    pendingInteractiveSelectionRef.current = null;
    beginCellSelection(pending.anchor);
    const nextCoord = resolveSelectionCoordFromPoint(clientX, clientY);
    if (nextCoord) extendCellSelection(nextCoord);
    return true;
  }, [beginCellSelection, extendCellSelection, resolveSelectionCoordFromPoint]);

  useEffect(() => {
    function updateSelectionFromPoint(clientX: number, clientY: number) {
      const coord = resolveSelectionCoordFromPoint(clientX, clientY);
      if (!coord) return;
      extendCellSelection(coord);
    }
    function onWindowMouseMove(event: MouseEvent) {
      if (!selectionPointerActiveRef.current) activatePendingInteractiveSelection(event.clientX, event.clientY);
      if (!selectionPointerActiveRef.current) return;
      updateSelectionFromPoint(event.clientX, event.clientY);
    }
    function onWindowMouseUp(event: MouseEvent) {
      if (!selectionPointerActiveRef.current) {
        pendingInteractiveSelectionRef.current = null;
        return;
      }
      if (!selectionPointerActiveRef.current) return;
      updateSelectionFromPoint(event.clientX, event.clientY);
      finishCellSelectionPointer(selectionExpandedRef.current);
    }
    window.addEventListener("mousemove", onWindowMouseMove);
    window.addEventListener("mouseup", onWindowMouseUp);
    return () => {
      window.removeEventListener("mousemove", onWindowMouseMove);
      window.removeEventListener("mouseup", onWindowMouseUp);
    };
  }, [extendCellSelection, finishCellSelectionPointer, resolveSelectionCoordFromPoint]);

  const handleSelectionCellPointerDown = useCallback((event: ReactMouseEvent<HTMLTableCellElement> | ReactPointerEvent<HTMLTableCellElement>, coord: TableCellCoord) => {
    if ("button" in event && event.button !== 0) return;
    const target = event.target;
    if (target instanceof HTMLElement && target.closest('[data-cell-role="token-trigger"], [data-cell-role="detail-trigger"]')) {
      pendingInteractiveSelectionRef.current = {
        anchor: coord,
        clientX: "clientX" in event ? event.clientX : 0,
        clientY: "clientY" in event ? event.clientY : 0,
      };
      return;
    }
    pendingInteractiveSelectionRef.current = null;
    if (
      target instanceof HTMLElement &&
      target.closest('input, textarea, [contenteditable="true"], [data-cell-role="editor"], [data-cell-role="text-editor-overlay"], [data-radix-popper-content-wrapper]')
    ) {
      return;
    }
    blurActiveTextEditor();
    event.preventDefault();
    beginCellSelection(coord);
  }, [beginCellSelection, blurActiveTextEditor]);

  const handleSelectionCellClickCapture = useCallback((event: ReactMouseEvent<HTMLTableCellElement>) => {
    if (!suppressNextSelectionClickRef.current) return;
    suppressNextSelectionClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  useEffect(() => {
    setMeasuredRowHeights({});
    rowElementRefs.current = {};
  }, [
    snapshot.sourcePath,
    snapshot.collectionPath,
    snapshot.fieldConfig.wrapped,
    snapshot.fieldConfig.widths,
    visibleFields,
    hasWrappedField,
  ]);

  useLayoutEffect(() => {
    if (!hasWrappedField) return;
    const nextMeasurements: Record<string, number> = {};
    for (const rowView of data) {
      const element = rowElementRefs.current[rowView.rowId];
      if (!element) continue;
      nextMeasurements[rowView.rowId] = element.getBoundingClientRect().height;
    }
    setMeasuredRowHeights((current) => mergeMeasuredRowHeights(current, nextMeasurements));
  }, [hasWrappedField, data, visibleFields, snapshot.fieldConfig.widths]);

  function updateColumnDragPreview(fieldName: string, clientX: number) {
    const current = columnDragSessionRef.current;
    if (!current || current.draggingField !== fieldName) return;
    const scrollContainer = scrollContainerRef.current;
    const slots = collectColumnSlots(scrollContainer, current.draggingField);
    const pointerX = getPointerXInScrollSpace(scrollContainer, clientX);
    const previewState = columnDragPreviewStoreRef.current.getState();
    const nextOrder = buildPreviewOrderFromSlots(previewState.previewOrder, current.draggingField, slots, pointerX);
    columnDragPreviewStoreRef.current.setState({
      baseOrder: previewState.baseOrder,
      previewOrder: nextOrder,
      ghostLeft: clientX - current.pointerOffsetX,
    });
  }

  function scheduleColumnAutoScroll() {
    if (columnDragAutoScrollFrameRef.current != null) return;
    const step = () => {
      columnDragAutoScrollFrameRef.current = null;
      const scrollContainer = scrollContainerRef.current;
      const direction = columnDragAutoScrollDirectionRef.current;
      const activeState = columnDragSessionRef.current;
      if (!scrollContainer || !activeState || direction === 0) return;
      const moved = scrollColumnContainer(scrollContainer, direction);
      if (!moved) {
        columnDragAutoScrollDirectionRef.current = 0;
        return;
      }
      if (columnDragPointerXRef.current != null) {
        updateColumnDragPreview(activeState.draggingField, columnDragPointerXRef.current);
      }
      if (columnDragAutoScrollDirectionRef.current !== 0 && columnDragSessionRef.current) {
        columnDragAutoScrollFrameRef.current = window.requestAnimationFrame(step);
      }
    };
    columnDragAutoScrollFrameRef.current = window.requestAnimationFrame(step);
  }

  function stopColumnAutoScroll() {
    if (columnDragAutoScrollFrameRef.current != null) {
      window.cancelAnimationFrame(columnDragAutoScrollFrameRef.current);
    }
    columnDragAutoScrollFrameRef.current = null;
  }

  function updateRowDropTarget(clientX: number, clientY: number) {
    const activeDrag = activeRowDragRef.current;
    const scrollContainer = scrollContainerRef.current;
    if (!activeDrag?.dragging || !scrollContainer) return;
    const rowRects = Object.entries(rowElementRefs.current).flatMap(([rowId, element]) => {
      if (!element || !element.isConnected) return [];
      const rect = element.getBoundingClientRect();
      return [{ rowId, top: rect.top, bottom: rect.bottom }];
    });
    const containerRect = scrollContainer.getBoundingClientRect();
    const target = resolveRowDropTarget({
      sourceRowId: activeDrag.sourceRowId,
      pointerX: clientX,
      pointerY: clientY,
      containerRect: {
        left: containerRect.left,
        right: containerRect.right,
        top: containerRect.top,
        bottom: containerRect.bottom,
      },
      rowRects,
      rowIds,
    }) as RowDropTarget | null;
    rowDropTargetRef.current = target;
    setRowDragVisual((current) => {
      if (
        current?.sourceRowId === activeDrag.sourceRowId
        && current.target?.rowId === target?.rowId
        && current.target?.placement === target?.placement
      ) return current;
      return { sourceRowId: activeDrag.sourceRowId, target };
    });
  }

  function scheduleRowAutoScroll() {
    if (rowAutoScrollFrameRef.current != null) return;
    const step = () => {
      rowAutoScrollFrameRef.current = null;
      const activeDrag = activeRowDragRef.current;
      const scrollContainer = scrollContainerRef.current;
      const pointerX = rowPointerXRef.current;
      const pointerY = rowPointerYRef.current;
      if (!activeDrag?.dragging || !scrollContainer || pointerX == null || pointerY == null) return;
      const rect = scrollContainer.getBoundingClientRect();
      const delta = resolveRowAutoScrollDelta({
        pointerY,
        containerTop: rect.top,
        containerBottom: rect.bottom,
      });
      if (delta === 0) return;
      const previousScrollTop = scrollContainer.scrollTop;
      const maximumScrollTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
      const nextScrollTop = Math.min(maximumScrollTop, Math.max(0, previousScrollTop + delta));
      if (nextScrollTop === previousScrollTop) return;
      scrollContainer.scrollTop = nextScrollTop;
      updateRowDropTarget(pointerX, pointerY);
      rowAutoScrollFrameRef.current = window.requestAnimationFrame(step);
    };
    rowAutoScrollFrameRef.current = window.requestAnimationFrame(step);
  }

  function stopRowAutoScroll() {
    if (rowAutoScrollFrameRef.current != null) {
      window.cancelAnimationFrame(rowAutoScrollFrameRef.current);
    }
    rowAutoScrollFrameRef.current = null;
  }

  function cancelRowDrag(suppressClick = false) {
    const activeDrag = activeRowDragRef.current;
    if (suppressClick && activeDrag?.dragging) {
      suppressRowHandleClickRef.current = activeDrag.sourceRowId;
      if (suppressRowHandleClickTimerRef.current != null) {
        window.clearTimeout(suppressRowHandleClickTimerRef.current);
      }
      suppressRowHandleClickTimerRef.current = window.setTimeout(() => {
        suppressRowHandleClickRef.current = null;
        suppressRowHandleClickTimerRef.current = null;
      }, 0);
    }
    activeRowDragRef.current = null;
    if (activeDrag?.handle.hasPointerCapture(activeDrag.pointerId)) {
      activeDrag.handle.releasePointerCapture(activeDrag.pointerId);
    }
    rowDropTargetRef.current = null;
    rowPointerXRef.current = null;
    rowPointerYRef.current = null;
    stopRowAutoScroll();
    setRowDragVisual(null);
  }

  function handleRowHandlePointerDown(
    event: ReactPointerEvent<HTMLButtonElement>,
    sourceRowIndex: number,
    sourceRowId: string,
  ) {
    event.stopPropagation();
    if (!snapshot.canReorderRows || !isPreciseRowDragPointer(event.pointerType) || event.button !== 0) return;
    cancelRowDrag();
    activeRowDragRef.current = {
      sourceRowId,
      sourceRowIndex,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
      handle: event.currentTarget,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveActiveRowDrag(pointerId: number, clientX: number, clientY: number) {
    const activeDrag = activeRowDragRef.current;
    if (!activeDrag || activeDrag.pointerId !== pointerId) return;
    if (!activeDrag.dragging) {
      if (!hasExceededRowDragThreshold(
        activeDrag.startX,
        activeDrag.startY,
        clientX,
        clientY,
      )) return;
      activeDrag.dragging = true;
      setOpenRowActionId(null);
      setRowDragVisual({ sourceRowId: activeDrag.sourceRowId, target: null });
    }
    rowPointerXRef.current = clientX;
    rowPointerYRef.current = clientY;
    updateRowDropTarget(clientX, clientY);
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;
    const rect = scrollContainer.getBoundingClientRect();
    const delta = resolveRowAutoScrollDelta({
      pointerY: clientY,
      containerTop: rect.top,
      containerBottom: rect.bottom,
    });
    if (delta === 0) stopRowAutoScroll();
    else scheduleRowAutoScroll();
  }

  function handleRowHandlePointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const activeDrag = activeRowDragRef.current;
    if (!activeDrag || activeDrag.pointerId !== event.pointerId) return;
    moveActiveRowDrag(event.pointerId, event.clientX, event.clientY);
    if (activeRowDragRef.current?.dragging) event.preventDefault();
  }

  function finishActiveRowDrag(pointerId: number, clientX: number, clientY: number) {
    const activeDrag = activeRowDragRef.current;
    if (!activeDrag || activeDrag.pointerId !== pointerId) return;
    rowPointerXRef.current = clientX;
    rowPointerYRef.current = clientY;
    if (activeDrag.dragging) updateRowDropTarget(clientX, clientY);
    const target = rowDropTargetRef.current;
    const shouldCommit = activeDrag.dragging && target != null;
    const sourceRowId = activeDrag.sourceRowId;
    cancelRowDrag(activeDrag.dragging);
    if (shouldCommit && target) {
      runtimeActionRef.current.onReorderRows(sourceRowId, target.rowId, target.placement);
    }
  }

  function handleRowHandlePointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    const activeDrag = activeRowDragRef.current;
    if (!activeDrag || activeDrag.pointerId !== event.pointerId) return;
    if (activeDrag.dragging) {
      event.preventDefault();
      event.stopPropagation();
    }
    finishActiveRowDrag(event.pointerId, event.clientX, event.clientY);
  }

  function handleRowHandlePointerCancel(event: ReactPointerEvent<HTMLButtonElement>) {
    const activeDrag = activeRowDragRef.current;
    if (!activeDrag || activeDrag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    cancelRowDrag(false);
  }

  function handleRowHandleClick(event: ReactMouseEvent<HTMLButtonElement>, rowId: string) {
    event.stopPropagation();
    if (suppressRowHandleClickRef.current !== rowId) return;
    suppressRowHandleClickRef.current = null;
    if (suppressRowHandleClickTimerRef.current != null) {
      window.clearTimeout(suppressRowHandleClickTimerRef.current);
      suppressRowHandleClickTimerRef.current = null;
    }
    event.preventDefault();
  }

  return (
    <section className="table-shell" data-row-dragging={rowDragVisual ? "true" : undefined}>
      <TableColumnsRuntimeProvider value={tableColumnsRuntime} headerState={tableColumnsHeaderState}>
        <div
          className="table-scroll"
          ref={scrollContainerRef}
          onMouseDown={(event) => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) return;
            if (target.closest('td[data-cell-kind="data"]')) return;
            blurActiveTextEditor();
            clearCellSelection();
          }}
          onScroll={(event) => {
            const element = event.currentTarget;
            const nextScrollTop = element.scrollTop;
            const nextScrollLeft = element.scrollLeft;
            const nextViewportHeight = element.clientHeight;
            const current = scrollMetricsRef.current;
            if (current.scrollTop === nextScrollTop && current.scrollLeft === nextScrollLeft && current.viewportHeight === nextViewportHeight) return;
            scrollMetricsRef.current = { scrollTop: nextScrollTop, scrollLeft: nextScrollLeft, viewportHeight: nextViewportHeight };
            if (current.scrollTop !== nextScrollTop) setScrollTop(nextScrollTop);
            if (current.viewportHeight !== nextViewportHeight) setViewportHeight(nextViewportHeight);
            if (snapshot.scrollRestoreKey) {
              props.onScrollPositionChange({ scrollTop: nextScrollTop, scrollLeft: nextScrollLeft });
            }
            if (activeTextCellId) {
              const activeEditor = document.activeElement as HTMLElement | null;
              if (activeEditor && event.currentTarget.contains(activeEditor) && (activeEditor.tagName === "INPUT" || activeEditor.tagName === "TEXTAREA")) {
                activeEditor.blur();
              }
            }
            if (columnDragPointerXRef.current != null && columnDragSessionRef.current) {
              updateColumnDragPreview(columnDragSessionRef.current.draggingField, columnDragPointerXRef.current);
            }
          }}
        >
          <table className="data-table" style={{ width: tableWidth, minWidth: tableWidth }}>
          <colgroup>
            <col className="row-action-col" />
            {visibleFields.map((fieldName) => {
              const width = getColumnWidth(fieldName);
              return <col data-column-field={fieldName} key={fieldName} style={{ width, minWidth: width }} />;
            })}
            <col className="add-column-col" />
          </colgroup>
          <thead>
            {table.getHeaderGroups().map((group) => (
              <MemoProjectedHeaderRow
                key={group.id}
                group={group}
                baseVisibleFields={baseVisibleFields}
                draggingField={columnDragSession?.draggingField ?? null}
                onAddField={props.onAddField}
                store={columnDragPreviewStoreRef.current}
              />
            ))}
          </thead>
          <tbody>
            {topSpacerHeight > 0 ? <tr className="virtual-spacer-row"><td colSpan={tableColumnCount} style={{ height: topSpacerHeight }} /></tr> : null}
            {table.getRowModel().rows.map((row) => {
              const rowIndex = row.index;
              const originalRowIndex = Number(row.original.__rowIndex ?? rowIndex);
              const rowId = String(row.original.__rowId ?? originalRowIndex);
              return (
                <tr
                  key={row.id}
                  data-row-id={rowId}
                  data-row-layout={hasWrappedField ? "top" : "center"}
                  data-row-drag-source={rowDragVisual?.sourceRowId === rowId ? "true" : undefined}
                  data-row-drop-placement={rowDragVisual?.target?.rowId === rowId ? rowDragVisual.target.placement : undefined}
                  ref={(element) => {
                    if (element) rowElementRefs.current[rowId] = element;
                    else delete rowElementRefs.current[rowId];
                  }}
                  onClick={(event) => selectRow(event, originalRowIndex, rowId)}
                >
                  <td className="row-action-cell" data-cell-kind="row-action">
                    <Popover.Root
                      open={openRowActionId === rowId}
                      onOpenChange={(open) => setOpenRowActionId(open ? rowId : null)}
                    >
                      <Popover.Trigger asChild>
                        <button
                          aria-label="条目操作"
                          aria-description={snapshot.canReorderRows ? "拖动排序，点击打开操作菜单" : "点击打开操作菜单"}
                          className="icon-button row-action-handle"
                          data-row-action-handle={rowId}
                          data-row-reorder-enabled={snapshot.canReorderRows ? "true" : "false"}
                          onClick={(event) => handleRowHandleClick(event, rowId)}
                          onMouseDown={(event) => event.stopPropagation()}
                          onPointerCancel={handleRowHandlePointerCancel}
                          onPointerDown={(event) => handleRowHandlePointerDown(event, originalRowIndex, rowId)}
                          onPointerMove={handleRowHandlePointerMove}
                          onPointerUp={handleRowHandlePointerUp}
                          onLostPointerCapture={(event) => {
                            const activeDrag = activeRowDragRef.current;
                            if (activeDrag?.pointerId === event.pointerId && !activeDrag.dragging) cancelRowDrag(false);
                          }}
                          title={snapshot.canReorderRows ? "拖动排序或点击打开操作菜单" : "点击打开操作菜单"}
                          type="button"
                        >
                          <icons.dragHandle size={16} />
                        </button>
                      </Popover.Trigger>
                      <Popover.Portal>
                        <Popover.Content
                          align="start"
                          className="menu-content row-action-menu"
                          role="menu"
                          side="right"
                          sideOffset={6}
                        >
                          <button
                            className="menu-item"
                            onClick={() => {
                              setOpenRowActionId(null);
                              runtimeActionRef.current.onDuplicateRow(originalRowIndex, rowId);
                            }}
                            role="menuitem"
                            type="button"
                          >
                            <icons.copy size={15} />
                            <span>复制条目</span>
                          </button>
                          <button
                            className="menu-item danger"
                            onClick={() => {
                              setOpenRowActionId(null);
                              runtimeActionRef.current.onDeleteRow(originalRowIndex, rowId);
                            }}
                            role="menuitem"
                            type="button"
                          >
                            <icons.delete size={15} />
                            <span>删除条目</span>
                          </button>
                        </Popover.Content>
                      </Popover.Portal>
                    </Popover.Root>
                  </td>
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className="data-cell"
                      data-cell-kind="data"
                      data-column-field={cell.column.id}
                      data-view-row-index={windowStart + row.index}
                      data-visible-column-index={visibleFields.indexOf(cell.column.id)}
                      data-cell-selected={selectionRect && isCellInsideRect(selectionRect, {
                        rowId,
                        visibleRowIndex: windowStart + row.index,
                        fieldName: cell.column.id,
                        visibleColumnIndex: visibleFields.indexOf(cell.column.id),
                      }) ? "true" : "false"}
                      data-cell-selection-role={sameTableCellCoord(selectionAnchor, {
                        rowId,
                        visibleRowIndex: windowStart + row.index,
                        fieldName: cell.column.id,
                        visibleColumnIndex: visibleFields.indexOf(cell.column.id),
                      }) ? "anchor" : "range"}
                      data-wrap-mode={snapshot.fieldConfig.wrapped.has(cell.column.id) ? "wrap" : "truncate"}
                      onClickCapture={handleSelectionCellClickCapture}
                      onMouseDown={(event) => handleSelectionCellPointerDown(event, {
                        rowId,
                        visibleRowIndex: windowStart + row.index,
                        fieldName: cell.column.id,
                        visibleColumnIndex: visibleFields.indexOf(cell.column.id),
                      })}
                      onPointerDown={(event) => handleSelectionCellPointerDown(event, {
                        rowId,
                        visibleRowIndex: windowStart + row.index,
                        fieldName: cell.column.id,
                        visibleColumnIndex: visibleFields.indexOf(cell.column.id),
                      })}
                      onMouseOver={() => {
                        if (!selectionPointerActiveRef.current) return;
                        extendCellSelection({
                          rowId,
                          visibleRowIndex: windowStart + row.index,
                          fieldName: cell.column.id,
                          visibleColumnIndex: visibleFields.indexOf(cell.column.id),
                        });
                      }}
                      onMouseMove={() => {
                        if (!selectionPointerActiveRef.current) return;
                        extendCellSelection({
                          rowId,
                          visibleRowIndex: windowStart + row.index,
                          fieldName: cell.column.id,
                          visibleColumnIndex: visibleFields.indexOf(cell.column.id),
                        });
                      }}
                      onMouseUp={() => {
                        if (!selectionPointerActiveRef.current) return;
                        finishCellSelectionPointer(selectionExpandedRef.current);
                      }}
                      onPointerUp={() => {
                        if (!selectionPointerActiveRef.current) return;
                        finishCellSelectionPointer(selectionExpandedRef.current);
                      }}
                      onClick={(event) => {
                        finishCellSelectionPointer(false);
                        if (selectionExpandedRef.current) return;
                        forwardOptionFieldSurfaceClick(event);
                      }}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                  <td data-cell-kind="add-column-spacer" />
                </tr>
              );
            })}
            {totalBottomSpacerHeight > 0 ? <tr className="virtual-spacer-row"><td colSpan={tableColumnCount} style={{ height: totalBottomSpacerHeight }} /></tr> : null}
          </tbody>
          </table>
        </div>
      </TableColumnsRuntimeProvider>
      {columnDragSession ? (
        <MemoColumnDragGhost
          draggingField={columnDragSession.draggingField}
          ghostTop={columnDragSession.ghostTop}
          width={columnDragSession.width}
          height={columnDragSession.height}
          displayType={getColumnModelDisplayType(columnDragSession.draggingField, columnModels) ?? "Text"}
          store={columnDragPreviewStoreRef.current}
        />
      ) : null}
    </section>
  );
}

export const DataTable = memo(DataTableComponent, (previous, next) => {
  return sameTableSnapshot(previous.snapshot, next.snapshot) &&
    previous.onDuplicateRow === next.onDuplicateRow &&
    previous.onReorderRows === next.onReorderRows &&
    previous.onScrollPositionChange === next.onScrollPositionChange;
});

function sameTableSnapshot(previous: TableSnapshot, next: TableSnapshot) {
  return previous.schemaModel === next.schemaModel &&
    previous.revision === next.revision &&
    previous.sourcePath === next.sourcePath &&
    previous.collectionPath === next.collectionPath &&
    previous.titleField === next.titleField &&
    previous.primaryKeyField === next.primaryKeyField &&
    previous.rowViews === next.rowViews &&
    previous.scrollRestoreKey === next.scrollRestoreKey &&
    sameScrollPosition(previous.initialScrollPosition, next.initialScrollPosition) &&
    sameBacklinkColumns(previous.backlinkColumns, next.backlinkColumns) &&
    sameBacklinkValues(previous.backlinkValuesByRowId, next.backlinkValuesByRowId) &&
    sameRelationOptions(previous.relationOptions, next.relationOptions) &&
    sameRelationConfigs(previous.relationConfigs, next.relationConfigs) &&
    previous.documentIndexEntries === next.documentIndexEntries &&
    sameFieldConfig(previous.fieldConfig, next.fieldConfig) &&
    sameSort(previous.sort, next.sort) &&
    previous.validation === next.validation &&
    previous.textEditable === next.textEditable &&
    previous.showFieldNames === next.showFieldNames &&
    previous.canReorderRows === next.canReorderRows &&
    previous.onRegisterActiveTextEditor === next.onRegisterActiveTextEditor &&
    sameFieldViewConfigs(previous.fieldViewConfigs, next.fieldViewConfigs);
}

function sameFieldConfig(previous: TableFieldConfig, next: TableFieldConfig) {
  return sameRecord(previous.displayTypes, next.displayTypes) &&
    sameSet(previous.hidden, next.hidden) &&
    sameSet(previous.wrapped, next.wrapped) &&
    sameRecord(previous.widths, next.widths) &&
    previous.order.length === next.order.length &&
    previous.order.every((field, index) => next.order[index] === field);
}

function sameSort(previous: TableSnapshot["sort"], next: TableSnapshot["sort"]) {
  if (previous === next) return true;
  if (!previous || !next) return false;
  return previous.field === next.field && previous.direction === next.direction;
}

function sameScrollPosition(
  previous: TableSnapshot["initialScrollPosition"],
  next: TableSnapshot["initialScrollPosition"],
) {
  if (previous === next) return true;
  if (!previous || !next) return false;
  return previous.scrollTop === next.scrollTop && previous.scrollLeft === next.scrollLeft;
}

function sameRecord<T extends string | number>(previous: Record<string, T>, next: Record<string, T>) {
  const previousKeys = Object.keys(previous);
  const nextKeys = Object.keys(next);
  return previousKeys.length === nextKeys.length && previousKeys.every((key) => previous[key] === next[key]);
}

function sameSet(previous: Set<string>, next: Set<string>) {
  return previous.size === next.size && [...previous].every((value) => next.has(value));
}

function sameRelationOptions(previous: Record<string, RelationOption[]>, next: Record<string, RelationOption[]>) {
  const previousKeys = Object.keys(previous);
  const nextKeys = Object.keys(next);
  if (previousKeys.length !== nextKeys.length) return false;
  return previousKeys.every((key) => {
    const previousOptions = previous[key] ?? [];
    const nextOptions = next[key] ?? [];
    return previousOptions.length === nextOptions.length &&
      previousOptions.every((option, index) => {
        const candidate = nextOptions[index];
        return candidate && option.value === candidate.value && option.label === candidate.label && option.description === candidate.description;
      });
  });
}

function sameRelationConfigs(previous: TableSnapshot["relationConfigs"], next: TableSnapshot["relationConfigs"]) {
  const previousKeys = Object.keys(previous);
  const nextKeys = Object.keys(next);
  if (previousKeys.length !== nextKeys.length) return false;
  return previousKeys.every((key) => {
    const left = previous[key];
    const right = next[key];
    return Boolean(right) &&
      left.targetFile === right.targetFile &&
      left.targetCollection === right.targetCollection &&
      left.targetKey === right.targetKey &&
      left.mode === right.mode &&
      left.allowMissing === right.allowMissing &&
      left.titleFields.length === right.titleFields.length &&
      left.titleFields.every((field, index) => right.titleFields[index] === field);
  });
}

function sameFieldViewConfigs(previous: Record<string, FieldViewConfig>, next: Record<string, FieldViewConfig>) {
  const previousKeys = Object.keys(previous);
  const nextKeys = Object.keys(next);
  if (previousKeys.length !== nextKeys.length) return false;
  return previousKeys.every((key) => previous[key] === next[key]);
}

function sameBacklinkColumns(previous: BacklinkGridColumn[], next: BacklinkGridColumn[]) {
  return previous.length === next.length && previous.every((column, index) => {
    const candidate = next[index];
    return Boolean(candidate) &&
      column.backlinkKey === candidate.backlinkKey &&
      column.fieldName === candidate.fieldName &&
      column.sourceRelation === candidate.sourceRelation &&
      column.targetKey === candidate.targetKey &&
      column.status === candidate.status &&
      column.message === candidate.message;
  });
}

function sameBacklinkValues(
  previous: Record<number | string, Record<string, RelationBacklink[]>>,
  next: Record<number | string, Record<string, RelationBacklink[]>>,
) {
  const previousRows = Object.keys(previous);
  const nextRows = Object.keys(next);
  if (previousRows.length !== nextRows.length) return false;
  return previousRows.every((rowKey) => {
    const previousFields = previous[rowKey] ?? {};
    const nextFields = next[rowKey] ?? {};
    const previousFieldKeys = Object.keys(previousFields);
    const nextFieldKeys = Object.keys(nextFields);
    if (previousFieldKeys.length !== nextFieldKeys.length) return false;
    return previousFieldKeys.every((fieldKey) => {
      const previousItems = previousFields[fieldKey] ?? [];
      const nextItems = nextFields[fieldKey] ?? [];
      return previousItems.length === nextItems.length && previousItems.every((item, index) => {
        const candidate = nextItems[index];
        return Boolean(candidate) &&
          item.relationKey === candidate.relationKey &&
          item.sourceFile === candidate.sourceFile &&
          item.sourceCollection === candidate.sourceCollection &&
          item.rowIndex === candidate.rowIndex &&
          item.title === candidate.title;
      });
    });
  });
}

function moveTitleFirst(fields: string[], titleField: string | null) {
  if (!titleField || !fields.includes(titleField)) return fields;
  return [titleField, ...fields.filter((field) => field !== titleField)];
}

function orderColumns(columns: string[], order: string[]) {
  const known = order.filter((field) => columns.includes(field));
  const rest = columns.filter((field) => !known.includes(field));
  return [...known, ...rest];
}

function createColumnDragPreviewStore() {
  let state: { baseOrder: string[]; previewOrder: string[]; ghostLeft: number } = {
    ...buildColumnPreviewOrderState([], []),
    ghostLeft: 0,
  };
  const listeners = new Set<() => void>();
  return {
    getState() {
      return state;
    },
    setState(nextState: { baseOrder: string[]; previewOrder: string[]; ghostLeft: number }) {
      if (
        sameFieldOrder(state.baseOrder, nextState.baseOrder) &&
        sameFieldOrder(state.previewOrder, nextState.previewOrder) &&
        state.ghostLeft === nextState.ghostLeft
      ) return;
      state = nextState;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function ProjectedHeaderRow(
  {
    group,
    baseVisibleFields,
    draggingField,
    onAddField,
    store,
  }: {
    group: HeaderGroup<DataRecord>;
    baseVisibleFields: string[];
    draggingField: string | null;
    onAddField: () => void;
    store: ReturnType<typeof createColumnDragPreviewStore>;
  },
) {
  const previewState = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const renderedHeaderFields = useMemo(() => {
    if (!draggingField) return baseVisibleFields;
    return projectHeaderFieldsByPreviewOrder(baseVisibleFields, previewState.previewOrder);
  }, [draggingField, baseVisibleFields, previewState.previewOrder]);
  const headerByField = useMemo(
    () => new Map(group.headers.map((header) => [header.id, header])),
    [group.headers],
  );
  return (
    <tr>
      <th className="row-action-cell" />
      {/* The current table renders a single leaf-header row only.
          Header projection intentionally reorders leaf headers in that row. */}
      {renderedHeaderFields.map((fieldName) => {
        const header = headerByField.get(fieldName);
        if (!header) return null;
        return (
          <th key={header.id} data-column-field={header.id}>
            <div
              className={`column-slot ${draggingField === fieldName ? "column-slot-placeholder" : ""} ${draggingField ? "column-slot-previewing" : ""}`}
            >
              {flexRender(header.column.columnDef.header, header.getContext())}
            </div>
          </th>
        );
      })}
      <th className="add-column-cell">
        <button className="icon-button" onClick={onAddField} title="Add field"><icons.addField size={16} /></button>
      </th>
    </tr>
  );
}

const MemoProjectedHeaderRow = memo(
  ProjectedHeaderRow,
  (previous, next) =>
    previous.group === next.group &&
    previous.draggingField === next.draggingField &&
    previous.baseVisibleFields === next.baseVisibleFields &&
    previous.onAddField === next.onAddField &&
    previous.store === next.store &&
    previous.group.headers === next.group.headers,
);

function ColumnDragGhost(
  {
    draggingField,
    ghostTop,
    width,
    height,
    displayType,
    store,
  }: {
    draggingField: string;
    ghostTop: number;
    width: number;
    height: number;
    displayType: string;
    store: ReturnType<typeof createColumnDragPreviewStore>;
  },
) {
  const previewState = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  return (
    <div
      className="column-drag-ghost"
      style={{
        width,
        height,
        left: previewState.ghostLeft,
        top: ghostTop,
      }}
    >
      <div className="column-drag-ghost-name">{draggingField}</div>
      <div className="column-drag-ghost-type">{displayType}</div>
    </div>
  );
}

const MemoColumnDragGhost = memo(
  ColumnDragGhost,
  (previous, next) =>
    previous.draggingField === next.draggingField &&
    previous.ghostTop === next.ghostTop &&
    previous.width === next.width &&
    previous.height === next.height &&
    previous.displayType === next.displayType &&
    previous.store === next.store,
);

function sameFieldOrder(previous: string[], next: string[]) {
  return previous.length === next.length && previous.every((field, index) => next[index] === field);
}



