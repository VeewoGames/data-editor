import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { memo, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { ColumnHeader } from "./ColumnHeader";
import {
  buildPreviewOrderFromSlots,
  collectColumnSlots,
  getPointerXInScrollSpace,
  resolveAutoScrollDirection,
  scrollColumnContainer,
} from "./column-dnd.mjs";
import { BacklinkCellViewer } from "./BacklinkCellViewer";
import { CellRenderer } from "./CellRenderer";
import type { DataRecord, DocumentModel } from "../model/documentModel";
import { getMainColumns, getNestedFields, getRows, summarizeNested } from "../model/documentModel";
import type { FieldDisplayType } from "../model/fieldTypes";
import { defaultTypeFor } from "../model/fieldTypes";
import type { RelationOption } from "../model/relations";
import { buildRelationKey } from "../model/relationPath";
import { resolveFieldRole, type ResolvedFieldRole } from "../model/fieldRole";
import type { ValidationIssue } from "../model/validation";
import { icons } from "../components/icons";
import { findTitleField } from "../model/titleField";
import type { BacklinkGridColumn } from "../model/backlinkGrid";
import type { RelationBacklink } from "../model/relationMaintenance";
import type { FieldViewConfig, MultiSelectOptionColor, MultiSelectOptionView, RelationConfig } from "../model/viewConfig";
import { buildMultiSelectFieldConfig } from "../multiselect-config.mjs";

export type FieldConfig = {
  displayTypes: Record<string, FieldDisplayType>;
  hidden: Set<string>;
  wrapped: Set<string>;
  widths: Record<string, number>;
  order: string[];
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
const rowOverscan = 8;
const rowActionColumnWidth = 42;
const addColumnWidth = 44;

type DataTableProps = {
  model: DocumentModel;
  sourcePath: string | null;
  collectionPath: string;
  fieldConfig: FieldConfig;
  fieldViewConfigs: Record<string, FieldViewConfig>;
  backlinkColumns: BacklinkGridColumn[];
  backlinkValuesByRowIndex: Record<number, Record<string, RelationBacklink[]>>;
  relationOptions: Record<string, RelationOption[]>;
  relationConfigs: Record<string, RelationConfig>;
  revision: number;
  query: string;
  sort: { field: string; direction: "asc" | "desc" } | null;
  issues: Record<string, ValidationIssue | null>;
  titleField: string | null;
  onSelectRow: (rowIndex: number) => void;
  onOpenDetail: (rowIndex: number) => void;
  onOpenBacklink: (backlink: RelationBacklink) => void;
  onEditCell: (rowIndex: number, fieldName: string, value: unknown) => void;
  onRenameMultiSelectOption: (fieldName: string, previousValue: string | number, nextValue: string) => void;
  onDeleteMultiSelectOption: (fieldName: string, optionValue: string | number) => void;
  onSetMultiSelectOptionColor: (fieldName: string, optionValue: string | number, color: MultiSelectOptionColor | null) => void;
  onRenameSelectOption: (fieldName: string, previousValue: string | number, nextValue: string) => void;
  onDeleteSelectOption: (fieldName: string, optionValue: string | number) => void;
  onSetSelectOptionColor: (fieldName: string, optionValue: string | number, color: MultiSelectOptionColor | null) => void;
  onChangeFieldType: (fieldName: string, displayType: FieldDisplayType) => void;
  onHideField: (fieldName: string) => void;
  onToggleWrapField: (fieldName: string) => void;
  onResizeField: (fieldName: string, width: number) => void;
  onMoveField: (fieldName: string, direction: "left" | "right") => void;
  onReorderFields: (order: string[]) => void;
  onSort: (fieldName: string, direction: "asc" | "desc" | null) => void;
  onConfigureRelation: (fieldName: string) => void;
  onClearRelation: (fieldName: string) => void;
  onOpenRelationTarget: (config: RelationConfig, value: string | number) => void;
  onAddRow: () => void;
  onDeleteRow: (rowIndex: number) => void;
  onAddField: () => void;
  onDeleteField: (fieldName: string) => void;
};

function DataTableComponent(props: DataTableProps) {
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(720);
  const [pressedField, setPressedField] = useState<string | null>(null);
  const [columnDragState, setColumnDragState] = useState<{
    draggingField: string;
    order: string[];
    ghostLeft: number;
    ghostTop: number;
    width: number;
    height: number;
    pointerOffsetX: number;
  } | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const scrollMetricsRef = useRef({ scrollTop: 0, scrollLeft: 0, viewportHeight: 720 });
  const columnDragStateRef = useRef<typeof columnDragState>(null);
  const columnDragPointerXRef = useRef<number | null>(null);
  const columnDragAutoScrollDirectionRef = useRef<-1 | 0 | 1>(0);
  const columnDragAutoScrollFrameRef = useRef<number | null>(null);
  const localWidthsRef = useRef<Record<string, number>>({ ...props.fieldConfig.widths });
  const rows = getRows(props.model, props.collectionPath) as DataRecord[];
  const nestedFieldSet = useMemo(
    () => new Set(getNestedFields(props.model, props.collectionPath)),
    [props.model, props.collectionPath],
  );

  useEffect(() => {
    localWidthsRef.current = { ...props.fieldConfig.widths };
  }, [props.sourcePath, props.collectionPath, props.revision, props.fieldConfig.widths]);

  useEffect(() => {
    setScrollTop(0);
    scrollMetricsRef.current = { scrollTop: 0, scrollLeft: 0, viewportHeight: scrollMetricsRef.current.viewportHeight };
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
      scrollContainerRef.current.scrollLeft = 0;
    }
  }, [props.sourcePath, props.collectionPath]);
  useEffect(() => {
    columnDragStateRef.current = columnDragState;
  }, [columnDragState]);
  useEffect(() => () => stopColumnAutoScroll(), []);
  const allColumns = useMemo(() => orderColumns([
    ...getMainColumns(props.model, props.collectionPath),
    ...nestedFieldSet,
    ...props.backlinkColumns.map((column) => column.fieldName),
  ], props.fieldConfig.order), [props.model, props.collectionPath, props.fieldConfig.order, nestedFieldSet, props.backlinkColumns]);

  const detectedTitleField = props.titleField ?? findTitleField(allColumns, rows);
  const visibleBaseFields = useMemo(() => allColumns.filter((field) => !props.fieldConfig.hidden.has(field)), [allColumns, props.fieldConfig.hidden]);
  const baseVisibleFields = useMemo(
    () => props.fieldConfig.order.length ? visibleBaseFields : moveTitleFirst(visibleBaseFields, detectedTitleField),
    [visibleBaseFields, detectedTitleField, props.fieldConfig.order.length],
  );
  const visibleFields = columnDragState?.order ?? baseVisibleFields;
  const hasWrappedField = useMemo(() => visibleFields.some((field) => props.fieldConfig.wrapped.has(field)), [visibleFields, props.fieldConfig.wrapped]);
  const sortedData = useMemo(() => applySort(rows, props.sort), [rows, props.sort]);
  const fieldOptions = useMemo(() => {
    const options: Record<string, MultiSelectFieldOptionConfig> = {};
    for (const fieldName of visibleFields) {
      const unique = new Map<string, string | number>();
      for (const row of rows) {
        const value = row[fieldName];
        if (!Array.isArray(value)) continue;
        for (const item of value) {
          if (item == null || (typeof item !== "string" && typeof item !== "number")) continue;
          unique.set(String(item), item);
        }
      }
      options[fieldName] = buildMultiSelectFieldConfig([...unique.values()], props.fieldViewConfigs[fieldName]);
    }
    return options;
  }, [rows, visibleFields, props.fieldViewConfigs]);
  const selectOptions = useMemo(() => {
    const options: Record<string, SelectFieldOptionConfig> = {};
    for (const fieldName of visibleFields) {
      const storedOptions = props.fieldViewConfigs[fieldName]?.selectOptions ?? {};
      const merged = new Map<string, MultiSelectOptionView>();
      for (const [value, option] of Object.entries(storedOptions)) {
        merged.set(value, { value, label: option.label, color: option.color ?? null });
      }
      const currentDisplayType = props.fieldConfig.displayTypes[fieldName];
      if (currentDisplayType === "Select") {
        for (const row of rows) {
          const value = row[fieldName];
          if (value == null) continue;
          const normalized = String(value).trim();
          if (!normalized) continue;
          if (!merged.has(normalized)) merged.set(normalized, { value: normalized, label: normalized, color: null });
        }
      }
      const normalizedOptions = [...merged.values()];
      options[fieldName] = {
        options: normalizedOptions,
        optionMap: Object.fromEntries(normalizedOptions.map((option) => [option.value, option])),
      };
    }
    return options;
  }, [rows, visibleFields, props.fieldConfig.displayTypes, props.fieldViewConfigs]);
  const relationOptionsByField = useMemo(() => {
    const options: Record<string, RelationOption[]> = {};
    for (const fieldName of visibleFields) {
      const role = getFieldRole(props.sourcePath, props.collectionPath, fieldName, props.relationConfigs);
      options[fieldName] = role.kind === "relation"
        ? (props.relationOptions[role.relationKey] ?? [])
        : [];
    }
    return options;
  }, [props.collectionPath, props.relationConfigs, props.relationOptions, props.sourcePath, visibleFields]);
  const relationConfigByField = useMemo(() => {
    const configs: Record<string, RelationConfig | null> = {};
    for (const fieldName of visibleFields) {
      const role = getFieldRole(props.sourcePath, props.collectionPath, fieldName, props.relationConfigs);
      configs[fieldName] = role.kind === "relation" ? role.config : null;
    }
    return configs;
  }, [props.collectionPath, props.relationConfigs, props.sourcePath, visibleFields]);
  const windowSize = hasWrappedField ? sortedData.length : Math.ceil(viewportHeight / compactRowHeight) + rowOverscan * 2;
  const rawWindowStart = Math.max(0, Math.floor(scrollTop / compactRowHeight) - rowOverscan);
  const maxWindowStart = Math.max(0, sortedData.length - windowSize);
  const windowStart = hasWrappedField ? 0 : Math.min(rawWindowStart, maxWindowStart);
  const windowEnd = Math.min(sortedData.length, windowStart + windowSize);
  const data = useMemo(() => sortedData.slice(windowStart, windowEnd), [sortedData, windowStart, windowEnd]);
  const topSpacerHeight = hasWrappedField ? 0 : windowStart * compactRowHeight;
  const bottomSpacerHeight = hasWrappedField ? 0 : Math.max(0, (sortedData.length - windowEnd) * compactRowHeight);
  const tableColumnCount = visibleFields.length + 2;
  const tableWidth = useMemo(() => {
    return rowActionColumnWidth + addColumnWidth + visibleFields.reduce((total, fieldName) => total + getColumnWidth(fieldName), 0);
  }, [visibleFields, props.fieldConfig.widths]);
  const tableData = useMemo(() => data.map((row, index) => ({ ...row, __rowIndex: typeof row.__rowIndex === "number" ? row.__rowIndex : rows.indexOf(row) >= 0 ? rows.indexOf(row) : index })), [data, rows]);
  const columns = useMemo<ColumnDef<DataRecord>[]>(() => visibleFields.map((fieldName) => ({
    id: fieldName,
    accessorFn: (row) => row[fieldName],
    size: getColumnWidth(fieldName),
    header: () => {
      const backlinkColumn = props.backlinkColumns.find((column) => column.fieldName === fieldName);
      const displayType = backlinkColumn
        ? "Backlink"
        : relationConfigByField[fieldName] ? "Relation" : inferColumnDisplayType(fieldName, rows, nestedFieldSet, props.fieldConfig.displayTypes);
      const relationConfigured = Boolean(relationConfigByField[fieldName]);
      return (
        <ColumnHeader
          fieldName={fieldName}
          roleKind={backlinkColumn ? "backlink" : relationConfigured ? "relation" : "normal"}
          allowTypeChange={!nestedFieldSet.has(fieldName) && !backlinkColumn}
          displayType={displayType}
          relationConfigured={relationConfigured}
          sortDirection={props.sort?.field === fieldName ? props.sort.direction : null}
          wrapped={props.fieldConfig.wrapped.has(fieldName)}
          width={getColumnWidth(fieldName)}
          pressed={pressedField === fieldName}
          onSort={(direction) => props.onSort(fieldName, direction)}
          onHide={() => props.onHideField(fieldName)}
          onResize={(width) => resizeField(fieldName, width)}
          onMove={(direction) => props.onMoveField(fieldName, direction)}
          isDragging={columnDragState?.draggingField === fieldName}
          onDragStart={handleColumnDragStart}
          onDragMove={handleColumnDragMove}
          onDragEnd={handleColumnDragEnd}
          onPressChange={handlePressChange}
          onToggleWrap={() => props.onToggleWrapField(fieldName)}
          onChangeFieldType={(type) => props.onChangeFieldType(fieldName, type)}
          onConfigureRelation={() => props.onConfigureRelation(fieldName)}
          onClearRelation={() => props.onClearRelation(fieldName)}
          onDeleteField={() => props.onDeleteField(fieldName)}
        />
      );
    },
    cell: (ctx) => {
      const value = ctx.getValue();
      const rowIndex = ctx.row.original.__rowIndex as number;
      const backlinkColumn = props.backlinkColumns.find((column) => column.fieldName === fieldName);
      if (backlinkColumn) {
        return (
          <BacklinkCellViewer
            items={props.backlinkValuesByRowIndex[rowIndex]?.[fieldName] ?? []}
            status={backlinkColumn.status}
            message={backlinkColumn.message}
            wrapped={props.fieldConfig.wrapped.has(fieldName)}
            onOpen={props.onOpenBacklink}
          />
        );
      }
      if (nestedFieldSet.has(fieldName)) {
        return (
          <button className="nested-summary" onClick={() => props.onSelectRow(rowIndex)}>
            {summarizeNestedValue(value)}
          </button>
        );
      }
      const displayType = nestedFieldSet.has(fieldName)
        ? "Nested"
        : relationConfigByField[fieldName] ? "Relation" : props.fieldConfig.displayTypes[fieldName] ?? defaultTypeFor(value);
      if (fieldName === detectedTitleField) {
        return (
          <div className={`title-cell ${props.fieldConfig.wrapped.has(fieldName) ? "cell-wrap" : ""}`}>
            <span>{value == null ? "" : String(value)}</span>
            <button className="title-open-button" onClick={(event) => { event.stopPropagation(); props.onOpenDetail(rowIndex); }} title="Open detail">
              <icons.openDetail size={16} />
            </button>
          </div>
        );
      }
      return (
        <CellRenderer
          cellId={`${rowIndex}:${fieldName}`}
          value={value}
          displayType={displayType}
          wrapped={props.fieldConfig.wrapped.has(fieldName)}
          multiSelectConfig={fieldOptions[fieldName]}
          selectConfig={selectOptions[fieldName]}
          relationOptions={relationOptionsByField[fieldName]}
          relationConfigured={Boolean(relationConfigByField[fieldName])}
          relationMode={relationConfigByField[fieldName]?.mode}
          onOpenRelationTarget={relationConfigByField[fieldName] ? (value) => props.onOpenRelationTarget(relationConfigByField[fieldName]!, value) : undefined}
          issue={props.issues[`${rowIndex}:${fieldName}`]}
          onEdit={(next) => props.onEditCell(rowIndex, fieldName, next)}
          onRenameMultiSelectOption={(previousValue, nextValue) => props.onRenameMultiSelectOption(fieldName, previousValue, nextValue)}
          onDeleteMultiSelectOption={(optionValue) => props.onDeleteMultiSelectOption(fieldName, optionValue)}
          onSetMultiSelectOptionColor={(optionValue, color) => props.onSetMultiSelectOptionColor(fieldName, optionValue, color)}
          onRenameSelectOption={(previousValue, nextValue) => props.onRenameSelectOption(fieldName, previousValue, nextValue)}
          onDeleteSelectOption={(optionValue) => props.onDeleteSelectOption(fieldName, optionValue)}
          onSetSelectOptionColor={(optionValue, color) => props.onSetSelectOptionColor(fieldName, optionValue, color)}
        />
      );
    },
  })), [
    baseVisibleFields,
    visibleFields,
    pressedField,
    columnDragState,
    rows,
    detectedTitleField,
    props.fieldConfig.displayTypes,
    props.fieldConfig.wrapped,
    fieldOptions,
    props.backlinkColumns,
    props.backlinkValuesByRowIndex,
    nestedFieldSet,
    relationOptionsByField,
    relationConfigByField,
    props.sort,
    props.issues,
    props.fieldViewConfigs,
    selectOptions,
    props.relationConfigs,
    props.sourcePath,
    props.collectionPath,
    props.onSort,
    props.onHideField,
    props.onMoveField,
    props.onToggleWrapField,
    props.onChangeFieldType,
    props.onConfigureRelation,
    props.onClearRelation,
    props.onOpenRelationTarget,
    props.onDeleteField,
    props.onResizeField,
    props.onReorderFields,
    props.onSelectRow,
    props.onOpenDetail,
    props.onOpenBacklink,
    props.onEditCell,
    props.onRenameMultiSelectOption,
    props.onDeleteMultiSelectOption,
    props.onSetMultiSelectOptionColor,
    props.onRenameSelectOption,
    props.onDeleteSelectOption,
    props.onSetSelectOptionColor,
  ]);

  const table = useReactTable({
    data: tableData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => String(row.__rowIndex),
  });

  function selectRow(event: ReactMouseEvent<HTMLTableRowElement>, rowIndex: number) {
    const rowElement = event.currentTarget;
    rowElement.closest("tbody")?.querySelectorAll("tr.selected-row").forEach((row) => row.classList.remove("selected-row"));
    rowElement.classList.add("selected-row");
    props.onSelectRow(rowIndex);
  }

  function resizeField(fieldName: string, width: number) {
    localWidthsRef.current = { ...localWidthsRef.current, [fieldName]: width };
    props.onResizeField(fieldName, width);
  }

  function getColumnWidth(fieldName: string) {
    return localWidthsRef.current[fieldName] ?? 180;
  }

  function handlePressChange(fieldName: string, pressed: boolean) {
    setPressedField((current) => {
      if (pressed) return fieldName;
      return current === fieldName ? null : current;
    });
  }

  function handleColumnDragStart(fieldName: string, rect: DOMRect, pointerOffsetX: number) {
    setPressedField(null);
    columnDragPointerXRef.current = rect.left + pointerOffsetX;
    columnDragAutoScrollDirectionRef.current = 0;
    stopColumnAutoScroll();
    setColumnDragState({
      draggingField: fieldName,
      order: [...baseVisibleFields],
      ghostLeft: rect.left,
      ghostTop: rect.top,
      width: rect.width,
      height: rect.height,
      pointerOffsetX,
    });
  }

  function handleColumnDragMove(fieldName: string, clientX: number) {
    columnDragPointerXRef.current = clientX;
    columnDragAutoScrollDirectionRef.current = resolveAutoScrollDirection(scrollContainerRef.current, clientX);
    if (columnDragAutoScrollDirectionRef.current !== 0) scheduleColumnAutoScroll();
    else stopColumnAutoScroll();
    updateColumnDragPreview(fieldName, clientX);
  }

  function handleColumnDragEnd(fieldName: string) {
    setPressedField(null);
    columnDragPointerXRef.current = null;
    columnDragAutoScrollDirectionRef.current = 0;
    stopColumnAutoScroll();
    setColumnDragState((current) => {
      if (!current || current.draggingField !== fieldName) return null;
      props.onReorderFields(current.order);
      return null;
    });
  }

  function updateColumnDragPreview(fieldName: string, clientX: number) {
    const scrollContainer = scrollContainerRef.current;
    setColumnDragState((current) => {
      if (!current || current.draggingField !== fieldName) return current;
      const slots = collectColumnSlots(scrollContainer, current.draggingField);
      const pointerX = getPointerXInScrollSpace(scrollContainer, clientX);
      const nextOrder = buildPreviewOrderFromSlots(current.order, current.draggingField, slots, pointerX);
      return {
        ...current,
        order: nextOrder,
        ghostLeft: clientX - current.pointerOffsetX,
      };
    });
  }

  function scheduleColumnAutoScroll() {
    if (columnDragAutoScrollFrameRef.current != null) return;
    const step = () => {
      columnDragAutoScrollFrameRef.current = null;
      const scrollContainer = scrollContainerRef.current;
      const direction = columnDragAutoScrollDirectionRef.current;
      const activeState = columnDragStateRef.current;
      if (!scrollContainer || !activeState || direction === 0) return;
      const moved = scrollColumnContainer(scrollContainer, direction);
      if (!moved) {
        columnDragAutoScrollDirectionRef.current = 0;
        return;
      }
      if (columnDragPointerXRef.current != null) {
        updateColumnDragPreview(activeState.draggingField, columnDragPointerXRef.current);
      }
      if (columnDragAutoScrollDirectionRef.current !== 0 && columnDragStateRef.current) {
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
          if (columnDragPointerXRef.current != null && columnDragStateRef.current) {
            updateColumnDragPreview(columnDragStateRef.current.draggingField, columnDragPointerXRef.current);
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
              <tr key={group.id}>
                <th className="row-action-cell" />
                {group.headers.map((header) => (
                  <th key={header.id} data-column-field={header.id}>
                    <div
                      className={`column-slot ${columnDragState?.draggingField === header.id ? "column-slot-placeholder" : ""}`}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                    </div>
                  </th>
                ))}
                <th className="add-column-cell">
                  <button className="icon-button" onClick={props.onAddField} title="Add field"><icons.addField size={16} /></button>
                </th>
              </tr>
            ))}
          </thead>
          <tbody>
            {topSpacerHeight > 0 ? <tr className="virtual-spacer-row"><td colSpan={tableColumnCount} style={{ height: topSpacerHeight }} /></tr> : null}
            {table.getRowModel().rows.map((row) => {
              const rowIndex = row.original.__rowIndex as number;
              return (
                <tr
                  key={row.id}
                  data-row-index={rowIndex}
                  onClick={(event) => selectRow(event, rowIndex)}
                >
                  <td className="row-action-cell">
                    <button className="icon-button danger" onClick={(event) => { event.stopPropagation(); props.onDeleteRow(rowIndex); }} title="Delete row">
                      <icons.delete size={14} />
                    </button>
                  </td>
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className={props.fieldConfig.wrapped.has(cell.column.id) ? "wrapped-cell" : undefined}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                  <td />
                </tr>
              );
            })}
            {bottomSpacerHeight > 0 ? <tr className="virtual-spacer-row"><td colSpan={tableColumnCount} style={{ height: bottomSpacerHeight }} /></tr> : null}
          </tbody>
        </table>
      </div>
      <button className="new-row-button" onClick={props.onAddRow}>
        <icons.addRow size={16} />
        New row
      </button>
      {columnDragState ? (
        <div
          className="column-drag-ghost"
          style={{
            width: columnDragState.width,
            height: columnDragState.height,
            left: columnDragState.ghostLeft,
            top: columnDragState.ghostTop,
          }}
        >
          <div className="column-drag-ghost-name">{columnDragState.draggingField}</div>
          <div className="column-drag-ghost-type">
            {displayTypeForField(columnDragState.draggingField, rows, props.fieldConfig.displayTypes, nestedFieldSet)}
          </div>
        </div>
      ) : null}
    </section>
  );
}

export const DataTable = memo(DataTableComponent, (previous, next) => {
  return previous.revision === next.revision &&
    previous.sourcePath === next.sourcePath &&
    previous.collectionPath === next.collectionPath &&
    previous.query === next.query &&
    previous.titleField === next.titleField &&
    sameBacklinkColumns(previous.backlinkColumns, next.backlinkColumns) &&
    sameBacklinkValues(previous.backlinkValuesByRowIndex, next.backlinkValuesByRowIndex) &&
    sameRelationOptions(previous.relationOptions, next.relationOptions) &&
    sameRelationConfigs(previous.relationConfigs, next.relationConfigs) &&
    sameFieldConfig(previous.fieldConfig, next.fieldConfig) &&
    sameSort(previous.sort, next.sort);
});

function sameFieldConfig(previous: FieldConfig, next: FieldConfig) {
  return sameRecord(previous.displayTypes, next.displayTypes) &&
    sameSet(previous.hidden, next.hidden) &&
    sameSet(previous.wrapped, next.wrapped) &&
    sameRecord(previous.widths, next.widths) &&
    previous.order.length === next.order.length &&
    previous.order.every((field, index) => next.order[index] === field);
}

function sameSort(previous: DataTableProps["sort"], next: DataTableProps["sort"]) {
  if (previous === next) return true;
  if (!previous || !next) return false;
  return previous.field === next.field && previous.direction === next.direction;
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

function sameRelationConfigs(previous: DataTableProps["relationConfigs"], next: DataTableProps["relationConfigs"]) {
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

function sameBacklinkValues(previous: Record<number, Record<string, RelationBacklink[]>>, next: Record<number, Record<string, RelationBacklink[]>>) {
  const previousRows = Object.keys(previous);
  const nextRows = Object.keys(next);
  if (previousRows.length !== nextRows.length) return false;
  return previousRows.every((rowKey) => {
    const previousFields = previous[Number(rowKey)] ?? {};
    const nextFields = next[Number(rowKey)] ?? {};
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

function displayTypeForField(fieldName: string, rows: DataRecord[], displayTypes: Record<string, FieldDisplayType>, nestedFieldSet: Set<string>) {
  return inferColumnDisplayType(fieldName, rows, nestedFieldSet, displayTypes);
}

function inferColumnDisplayType(
  fieldName: string,
  rows: DataRecord[],
  nestedFieldSet: Set<string>,
  displayTypes: Record<string, FieldDisplayType>,
): FieldDisplayType {
  if (nestedFieldSet.has(fieldName)) return "Nested";
  if (displayTypes[fieldName]) return displayTypes[fieldName];
  const sample = rows.find((row) => row[fieldName] !== undefined && row[fieldName] !== null)?.[fieldName]
    ?? rows.find((row) => row[fieldName] !== undefined)?.[fieldName];
  return defaultTypeFor(sample);
}

function summarizeNestedValue(value: unknown) {
  if (value == null) return "未设置";
  return summarizeNested(value);
}

function getFieldRole(
  sourcePath: string | null,
  collectionPath: string,
  fieldName: string,
  relationConfigs: Record<string, RelationConfig>,
): ResolvedFieldRole {
  if (!sourcePath) return { kind: "normal" };
  return resolveFieldRole({
    sourceFile: sourcePath,
    sourceCollection: collectionPath,
    fieldName,
    viewConfig: {
      fields: {},
      primaryKeys: {},
      backlinks: {},
      relations: relationConfigs,
      relationsVersion: 0,
    },
  }) as ResolvedFieldRole;
}

function applySort(rows: DataRecord[], sort: { field: string; direction: "asc" | "desc" } | null) {
  if (!sort) return rows;
  return [...rows].sort((a, b) => {
    const left = String(a[sort.field] ?? "");
    const right = String(b[sort.field] ?? "");
    const result = left.localeCompare(right, undefined, { numeric: true });
    return sort.direction === "asc" ? result : -result;
  });
}
