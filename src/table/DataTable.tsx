import { flexRender, getCoreRowModel, useReactTable, type HeaderGroup } from "@tanstack/react-table";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent as ReactMouseEvent } from "react";
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
import type { ActiveTextEditorRegistrar } from "../editing";

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

export type TableSnapshot = {
  schemaModel: DocumentModel;
  sourcePath: string | null;
  collectionPath: string;
  rowViews: TableRowView[];
  fieldConfig: TableFieldConfig;
  fieldViewConfigs: Record<string, FieldViewConfig>;
  backlinkColumns: BacklinkGridColumn[];
  backlinkValuesByRowId: Record<string, Record<string, RelationBacklink[]>>;
  relationOptions: Record<string, RelationOption[]>;
  relationConfigs: Record<string, RelationConfig>;
  revision: number;
  sort: { field: string; direction: "asc" | "desc" } | null;
  validation: ValidationSnapshot;
  titleField: string | null;
  primaryKeyField: string | null;
  scrollRestoreKey: string | null;
  initialScrollPosition: { scrollTop: number; scrollLeft: number } | null;
  textEditable: boolean;
  onRegisterActiveTextEditor?: ActiveTextEditorRegistrar;
};

type DataTableProps = {
  snapshot: TableSnapshot;
  onScrollPositionChange: (position: { scrollTop: number; scrollLeft: number }) => void;
  onSelectRow: (rowIndex: number, rowId: string | null) => void;
  onOpenDetail: (rowIndex: number, rowId: string | null) => void;
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
  onOpenRelationTarget: (config: RelationConfig, value: string | number) => void;
  onAddRow: () => void;
  onDeleteRow: (rowIndex: number, rowId: string | null) => void;
  showRowDeleteControls: boolean;
  onAddField: () => void;
  onDeleteField: (fieldName: string) => void;
};

function DataTableComponent(props: DataTableProps) {
  const { snapshot } = props;
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(720);
  const [pressedField, setPressedField] = useState<string | null>(null);
  const [activeTextCellId, setActiveTextCellId] = useState<string | null>(null);
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
  const localWidthsRef = useRef<Record<string, number>>({ ...snapshot.fieldConfig.widths });
  const rowElementRefs = useRef<Record<string, HTMLTableRowElement | null>>({});
  const previousTableRenderContractRef = useRef<ReturnType<typeof buildVisibleTableRenderContract> | null>(null);
  const previousColumnModelsByFieldRef = useRef<Record<string, ReturnType<typeof buildTableColumnModels>[number]>>({});
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
    onDeleteField: props.onDeleteField,
    onOpenRelationTarget: props.onOpenRelationTarget,
    onSelectRow: props.onSelectRow,
    onOpenDetail: props.onOpenDetail,
    onOpenBacklink: props.onOpenBacklink,
    onEditCell: props.onEditCell,
    onCommitMultiSelectDraft: props.onCommitMultiSelectDraft,
    onCommitSelectDraft: props.onCommitSelectDraft,
    onResizeField: props.onResizeField,
    onReorderFields: props.onReorderFields,
  });
  const restoredScrollContextKeyRef = useRef<string | null>(null);
  const [measuredRowHeights, setMeasuredRowHeights] = useState<Record<string, number>>({});
  const rowViews = snapshot.rowViews;
  const rowIds = useMemo(() => rowViews.map((view) => view.rowId), [rowViews]);
  const rows = useMemo(() => rowViews.map((view) => view.row), [rowViews]);
  const schemaModel = snapshot.schemaModel;
  const nestedFieldSet = useMemo(
    () => new Set(getNestedFields(schemaModel, snapshot.collectionPath)),
    [schemaModel, snapshot.collectionPath],
  );

  useEffect(() => {
    localWidthsRef.current = { ...snapshot.fieldConfig.widths };
  }, [snapshot.sourcePath, snapshot.collectionPath, snapshot.revision, snapshot.fieldConfig.widths]);

  useEffect(() => {
    setActiveTextCellId(null);
  }, [snapshot.textEditable, snapshot.sourcePath, snapshot.collectionPath, snapshot.revision]);

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
  } = useMemo(() => buildTableRuntimeDeps({
    visibleFields,
    rows,
    sourcePath: snapshot.sourcePath,
    collectionPath: snapshot.collectionPath,
    displayTypes: snapshot.fieldConfig.displayTypes,
    fieldViewConfigs: snapshot.fieldViewConfigs,
    relationConfigs: snapshot.relationConfigs,
    relationOptions: snapshot.relationOptions,
  }), [
    visibleFields,
    rows,
    snapshot.sourcePath,
    snapshot.collectionPath,
    snapshot.fieldConfig.displayTypes,
    snapshot.fieldViewConfigs,
    snapshot.relationConfigs,
    snapshot.relationOptions,
  ]);
  const windowSize = hasWrappedField ? (variableRowWindow?.windowEnd ?? rows.length) - (variableRowWindow?.windowStart ?? 0) : Math.ceil(viewportHeight / compactRowHeight) + rowOverscan * 2;
  const rawWindowStart = Math.max(0, Math.floor(scrollTop / compactRowHeight) - rowOverscan);
  const maxWindowStart = Math.max(0, rows.length - windowSize);
  const windowStart = hasWrappedField ? (variableRowWindow?.windowStart ?? 0) : Math.min(rawWindowStart, maxWindowStart);
  const windowEnd = hasWrappedField ? (variableRowWindow?.windowEnd ?? rows.length) : Math.min(rows.length, windowStart + windowSize);
  const data = useMemo(() => rowViews.slice(windowStart, windowEnd), [rowViews, windowStart, windowEnd]);
  const topSpacerHeight = hasWrappedField ? (variableRowWindow?.topSpacerHeight ?? 0) : windowStart * compactRowHeight;
  const bottomSpacerHeight = hasWrappedField ? (variableRowWindow?.bottomSpacerHeight ?? 0) : Math.max(0, (rows.length - windowEnd) * compactRowHeight);
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
      onDeleteField: props.onDeleteField,
      onOpenRelationTarget: props.onOpenRelationTarget,
      onSelectRow: props.onSelectRow,
      onOpenDetail: props.onOpenDetail,
      onOpenBacklink: props.onOpenBacklink,
      onEditCell: props.onEditCell,
      onCommitMultiSelectDraft: props.onCommitMultiSelectDraft,
      onCommitSelectDraft: props.onCommitSelectDraft,
      onResizeField: props.onResizeField,
      onReorderFields: props.onReorderFields,
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
    props.onDeleteField,
    props.onOpenRelationTarget,
    props.onSelectRow,
    props.onOpenDetail,
    props.onOpenBacklink,
    props.onEditCell,
    props.onCommitMultiSelectDraft,
    props.onCommitSelectDraft,
    props.onResizeField,
    props.onReorderFields,
  ]);
  const tableData = tableRenderContract.rows;
  const columnModelSignature = useMemo(() => buildTableColumnModelsSignature({
    visibleFields,
    rows,
    nestedFieldSet,
    displayTypes: snapshot.fieldConfig.displayTypes,
    wrappedFields: snapshot.fieldConfig.wrapped,
    detectedTitleField,
    backlinkColumns: snapshot.backlinkColumns,
    relationOptionsByField,
    relationConfigByField,
    fieldOptions,
    selectOptions,
    widths: snapshot.fieldConfig.widths,
    textEditable: snapshot.textEditable,
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
    snapshot.fieldConfig.widths,
    snapshot.textEditable,
  ]);
  const columnModels = useMemo(() => buildTableColumnModels({
    visibleFields,
    rows,
    nestedFieldSet,
    displayTypes: snapshot.fieldConfig.displayTypes,
    wrappedFields: snapshot.fieldConfig.wrapped,
    detectedTitleField,
    backlinkColumns: snapshot.backlinkColumns,
    relationOptionsByField,
    relationConfigByField,
    fieldOptions,
    selectOptions,
    getColumnWidth,
    previousByField: previousColumnModelsByFieldRef.current,
  }), [columnModelSignature]);
  useEffect(() => {
    previousColumnModelsByFieldRef.current = Object.fromEntries(columnModels.map((model) => [model.fieldName, model]));
  }, [columnModels]);
  const columns = useMemo(() => buildTableColumns(columnModels), [columnModels]);
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

  const selectRowByRuntime = useCallback((rowIndex: number, rowId: string | null) => {
    runtimeActionRef.current.onSelectRow(rowIndex, rowId);
  }, []);

  const openDetailByRuntime = useCallback((rowIndex: number, rowId: string | null) => {
    runtimeActionRef.current.onOpenDetail(rowIndex, rowId);
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
    activeTextCellId,
    onRegisterActiveTextEditor: snapshot.onRegisterActiveTextEditor,
    onActivateTextCell: handleActivateTextCell,
    onDeactivateTextCell: handleDeactivateTextCell,
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
    onDeleteField: handleDeleteField,
    onOpenRelationTarget: handleOpenRelationTarget,
    onSelectRow: selectRowByRuntime,
    onOpenDetail: openDetailByRuntime,
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
    activeTextCellId,
    snapshot.onRegisterActiveTextEditor,
    handleActivateTextCell,
    handleDeactivateTextCell,
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
    handleDeleteField,
    handleOpenRelationTarget,
    selectRowByRuntime,
    openDetailByRuntime,
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

  useEffect(() => {
    setMeasuredRowHeights({});
    rowElementRefs.current = {};
  }, [
    snapshot.sourcePath,
    snapshot.collectionPath,
    snapshot.revision,
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

  return (
    <section className="table-shell">
      <TableColumnsRuntimeProvider value={tableColumnsRuntime} headerState={tableColumnsHeaderState}>
        <div
          className="table-scroll"
          ref={scrollContainerRef}
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
                  ref={(element) => { rowElementRefs.current[rowId] = element; }}
                  onClick={(event) => selectRow(event, originalRowIndex, rowId)}
                >
                  <td className="row-action-cell" data-cell-kind="row-action">
                    <button
                      className={props.showRowDeleteControls ? "icon-button danger" : "icon-button danger row-delete-hidden"}
                      onClick={(event) => { event.stopPropagation(); props.onDeleteRow(originalRowIndex, rowId); }}
                      title="Delete row"
                      aria-hidden={!props.showRowDeleteControls}
                      tabIndex={props.showRowDeleteControls ? 0 : -1}
                    >
                      <icons.delete size={14} />
                    </button>
                  </td>
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className="data-cell"
                      data-cell-kind="data"
                      data-column-field={cell.column.id}
                      data-wrap-mode={snapshot.fieldConfig.wrapped.has(cell.column.id) ? "wrap" : "truncate"}
                      onClick={forwardOptionFieldSurfaceClick}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                  <td data-cell-kind="add-column-spacer" />
                </tr>
              );
            })}
            {bottomSpacerHeight > 0 ? <tr className="virtual-spacer-row"><td colSpan={tableColumnCount} style={{ height: bottomSpacerHeight }} /></tr> : null}
          </tbody>
          </table>
        </div>
      </TableColumnsRuntimeProvider>
      <button className="new-row-button" onClick={props.onAddRow}>
        <icons.addRow size={16} />
        New row
      </button>
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
    previous.showRowDeleteControls === next.showRowDeleteControls &&
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
    sameFieldConfig(previous.fieldConfig, next.fieldConfig) &&
    sameSort(previous.sort, next.sort) &&
    previous.validation === next.validation &&
    previous.textEditable === next.textEditable &&
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

