import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { icons } from "../components/icons";
import { RelationBacklinksPanel } from "../components/RelationBacklinksPanel";
import type { SaveDocumentsResult } from "../api/client";
import type { DataRecord } from "../model/documentModel";
import type { FieldDisplayType } from "../model/fieldTypes";
import { defaultTypeFor } from "../model/fieldTypes";
import type { RelationOption } from "../model/relations";
import { buildRelationKey } from "../model/relationPath";
import { getRecordTitle } from "../model/titleField";
import type { ValidationIssue } from "../model/validation";
import { NestedEditor } from "./NestedEditor";
import { RelationCellEditor } from "../table/RelationCellEditor";
import { SelectCellEditor } from "../table/SelectCellEditor";
import type { FieldViewConfig, MultiSelectOptionColor, MultiSelectOptionView, RelationConfig } from "../model/viewConfig";
import type { PrimaryKeyImpact, PrimaryKeySyncPlan, RelationBacklink } from "../model/relationMaintenance";

type DetailPanelProps = {
  open: boolean;
  panelWidth: number;
  row: DataRecord | null;
  rowIndex: number | null;
  rowCount: number;
  sourcePath: string | null;
  collectionPath: string;
  titleField: string | null;
  detailOrder: string[];
  displayTypes: Record<string, FieldDisplayType>;
  fieldViewConfigs: Record<string, FieldViewConfig>;
  issues: Record<string, ValidationIssue | null>;
  relationOptions: Record<string, RelationOption[]>;
  relationConfigs?: Record<string, RelationConfig>;
  relationBacklinks: RelationBacklink[];
  primaryKeyImpacts: Record<string, PrimaryKeyImpact>;
  primaryKeySyncPlan: PrimaryKeySyncPlan | null;
  primaryKeySyncResult: SaveDocumentsResult | null;
  saving: boolean;
  onRenameSelectOption: (fieldName: string, previousValue: string | number, nextValue: string) => void;
  onDeleteSelectOption: (fieldName: string, optionValue: string | number) => void;
  onSetSelectOptionColor: (fieldName: string, optionValue: string | number, color: MultiSelectOptionColor | null) => void;
  onOpenBacklink: (backlink: RelationBacklink) => void;
  onRequestSyncSave: () => void;
  onOpenRelationTarget: (config: RelationConfig, value: string | number) => void;
  onSelectRow: (rowIndex: number) => void;
  onClose: () => void;
  onPanelWidthChange: (width: number) => void;
  onPanelWidthCommit: (width: number) => void;
  onEditField: (fieldName: string, value: unknown) => void;
  onReorderFields: (nextOrder: string[]) => void;
};

type SelectOptionsByField = Record<string, MultiSelectOptionView[]>;

type NestedPanelState = {
  rootField: string;
  path: Array<string | number>;
  title: string;
  selectedIndex: number | null;
};

export function DetailPanel({
  open,
  panelWidth,
  row,
  rowIndex,
  rowCount,
  sourcePath,
  collectionPath,
  titleField,
  detailOrder,
  displayTypes,
  fieldViewConfigs,
  issues,
  relationOptions,
  relationConfigs,
  relationBacklinks,
  primaryKeyImpacts,
  primaryKeySyncPlan,
  primaryKeySyncResult,
  saving,
  onRenameSelectOption,
  onDeleteSelectOption,
  onSetSelectOptionColor,
  onOpenBacklink,
  onRequestSyncSave,
  onOpenRelationTarget,
  onSelectRow,
  onClose,
  onPanelWidthChange,
  onPanelWidthCommit,
  onEditField,
  onReorderFields,
}: DetailPanelProps) {
  const panelRef = useRef<HTMLElement | null>(null);
  const nestedPanelRef = useRef<HTMLElement | null>(null);
  const propertyItemRefs = useRef<Record<string, HTMLElement | null>>({});
  const [nestedStack, setNestedStack] = useState<NestedPanelState[]>([]);
  const [pressedField, setPressedField] = useState<string | null>(null);
  const [dragState, setDragState] = useState<{
    field: string;
    startOrder: string[];
    targetIndex: number;
    restOrder: string[];
    ghostTop: number;
    ghostLeft: number;
    ghostWidth: number;
    ghostHeight: number;
  } | null>(null);

  useEffect(() => {
    panelRef.current?.scrollTo({ top: 0 });
    nestedPanelRef.current?.scrollTo({ top: 0 });
  }, [rowIndex]);

  useEffect(() => {
    setNestedStack([]);
  }, [rowIndex, open]);

  useEffect(() => {
    setPressedField(null);
    setDragState(null);
  }, [rowIndex, detailOrder]);

  useEffect(() => {
    if (!open) return;

    function handleOutsidePointerDown(event: PointerEvent) {
      if (event.button !== 0) return;
      if (document.body.classList.contains("is-resizing-detail-panel")) return;
      if (document.body.classList.contains("is-dragging-detail-property")) return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target)) return;
      if (nestedPanelRef.current?.contains(target)) return;
      onClose();
    }

    window.addEventListener("pointerdown", handleOutsidePointerDown);
    return () => {
      window.removeEventListener("pointerdown", handleOutsidePointerDown);
    };
  }, [open, onClose]);

  const activeNested = nestedStack.at(-1) ?? null;
  const primaryPanelStyle = useMemo(
    () => ({ "--detail-panel-width": `${panelWidth}px` }) as CSSProperties,
    [panelWidth],
  );
  const activeNestedValue = useMemo(() => {
    if (!row || !activeNested) return null;
    return getValueAtPath(row[activeNested.rootField], activeNested.path);
  }, [row, activeNested]);

  function beginPanelResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = panelWidth;
    document.body.classList.add("is-resizing-detail-panel");

    function onPointerMove(moveEvent: PointerEvent) {
      onPanelWidthChange(startWidth - (moveEvent.clientX - startX));
    }

    function finish() {
      document.body.classList.remove("is-resizing-detail-panel");
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
    }

    function onPointerUp(upEvent: PointerEvent) {
      onPanelWidthCommit(startWidth - (upEvent.clientX - startX));
      finish();
    }

    function onPointerCancel() {
      finish();
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
  }

  if (!row || rowIndex == null) {
    return (
      <>
        <aside className={`detail-panel primary empty ${open ? "open" : ""}`} ref={panelRef} style={primaryPanelStyle}>
          <div className="detail-panel-resize-handle" onPointerDown={beginPanelResize} aria-label="调整详情面板宽度" role="separator" />
          <div className="panel-kicker">Record detail</div>
          <div className="panel-title">No record selected</div>
        </aside>
        <aside className="detail-panel secondary" ref={nestedPanelRef} />
      </>
    );
  }

  const title = getRecordTitle(row, titleField ? [titleField] : [], rowIndex);
  const currentRow = row;
  const canGoPrevious = rowIndex > 0;
  const canGoNext = rowIndex < rowCount - 1;
  const primaryClassName = `detail-panel primary ${open ? "open" : ""} ${activeNested ? "with-secondary" : ""}`;
  const naturalFieldOrder = Object.keys(row).filter((key) => key !== "__rowIndex");
  const orderedFields = dragState?.startOrder ?? orderDetailFields(naturalFieldOrder, detailOrder);
  const selectOptionsByField = useMemo<SelectOptionsByField>(() => {
    const result: SelectOptionsByField = {};
    for (const key of naturalFieldOrder) {
      if (displayTypes[key] !== "Select") continue;
      const options = new Map<string, MultiSelectOptionView>();
      for (const [value, option] of Object.entries(fieldViewConfigs[key]?.selectOptions ?? {})) {
        options.set(value, { value, label: option.label, color: option.color ?? null });
      }
      for (const candidateRow of [row]) {
        const value = candidateRow?.[key];
        if (value == null) continue;
        const normalized = String(value).trim();
        if (!normalized) continue;
        options.set(normalized, { value: normalized, label: normalized, color: null });
      }
      result[key] = [...options.values()];
    }
    return result;
  }, [displayTypes, fieldViewConfigs, naturalFieldOrder, row]);

  function openNestedField(fieldName: string, value: unknown, path: Array<string | number> = [], customTitle?: string) {
    const itemCount = Array.isArray(value) ? value.length : 0;
    setNestedStack((current) => [...current, {
      rootField: fieldName,
      path,
      title: customTitle ?? `${fieldName} - ${itemCount} 条`,
      selectedIndex: null,
    }]);
  }

  function closeNestedPanel() {
    setNestedStack((current) => current.slice(0, -1));
  }

  function updateNestedValue(rootField: string, path: Array<string | number>, nextValue: unknown) {
    const rootValue = currentRow[rootField];
    onEditField(rootField, updateValueAtPath(rootValue, path, nextValue));
  }

  function handlePropertyHandlePointerDown(fieldName: string, event: ReactMouseEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    const source = propertyItemRefs.current[fieldName];
    if (!source) return;
    event.preventDefault();
    event.stopPropagation();
    const startOrder = orderDetailFields(naturalFieldOrder, detailOrder);
    const startIndex = startOrder.indexOf(fieldName);
    if (startIndex < 0) return;
    const restOrder = startOrder.filter((field) => field !== fieldName);
    const startY = event.clientY;
    const startRect = source.getBoundingClientRect();
    let dragging = false;
    let currentTargetIndex = restOrder.findIndex((field) => startOrder.indexOf(field) >= startIndex);
    if (currentTargetIndex < 0) currentTargetIndex = restOrder.length;

    setPressedField(fieldName);

    function finish(nextOrder: string[] | null) {
      setPressedField(null);
      setDragState(null);
      document.body.classList.remove("is-dragging-detail-property");
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onPointerUp);
      if (nextOrder && nextOrder.join("\u0000") !== startOrder.join("\u0000")) {
        onReorderFields(nextOrder);
      }
    }

    function onMouseMove(moveEvent: MouseEvent) {
      const deltaY = moveEvent.clientY - startY;
      if (!dragging && Math.abs(deltaY) < 6) return;
      if (!dragging) {
        dragging = true;
        document.body.classList.add("is-dragging-detail-property");
      }
      currentTargetIndex = findDetailDropIndex(restOrder, moveEvent.clientY, propertyItemRefs.current);
      setDragState({
        field: fieldName,
        startOrder,
        targetIndex: currentTargetIndex,
        restOrder,
        ghostTop: moveEvent.clientY - (startY - startRect.top),
        ghostLeft: startRect.left,
        ghostWidth: startRect.width,
        ghostHeight: startRect.height,
      });
    }

    function onPointerUp() {
      finish(dragging ? insertDraggedField(startOrder, fieldName, currentTargetIndex) : null);
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onPointerUp);
  }

  return (
    <>
      <aside className={primaryClassName} ref={panelRef} style={primaryPanelStyle}>
        <div className="detail-panel-resize-handle" onPointerDown={beginPanelResize} aria-label="调整详情面板宽度" role="separator" />
        <div className="detail-header">
          <div className="detail-title-block">
            <div className="panel-kicker">Record detail</div>
            <div className="panel-title">{String(title)}</div>
            <div className="panel-subtitle">Row {rowIndex + 1} of {rowCount}</div>
          </div>
          <div className="detail-nav">
            <button className="icon-button" disabled={!canGoPrevious} onClick={() => onSelectRow(rowIndex - 1)} title="Previous record">
              <icons.previous size={16} />
            </button>
            <button className="icon-button" disabled={!canGoNext} onClick={() => onSelectRow(rowIndex + 1)} title="Next record">
              <icons.next size={16} />
            </button>
            <button className="icon-button" onClick={onClose} title="Close detail">
              <icons.close size={16} />
            </button>
          </div>
        </div>
        <div className="property-list">
          {orderedFields.map((key, index) => {
            const value = row[key];
            const issue = issues[`${rowIndex}:${key}`];
            const isDragged = dragState?.field === key;
            const visibleIndex = dragState ? dragState.restOrder.indexOf(key) : index;
            return (
              <Fragment key={`${rowIndex}:${key}`}>
                {!isDragged && dragState && dragState.targetIndex === visibleIndex ? (
                  <div className="detail-drop-indicator" />
                ) : null}
                <div
                  className={`detail-property-item ${pressedField === key ? "is-pressed" : ""} ${isDragged ? "is-dragging" : ""}`}
                  ref={(element) => { propertyItemRefs.current[key] = element; }}
                >
                  <button
                    className="detail-property-handle"
                    type="button"
                    title={`Reorder ${key}`}
                    aria-label={`Reorder ${key}`}
                    onMouseDown={(event) => handlePropertyHandlePointerDown(key, event)}
                  >
                    <icons.dragHandle size={16} />
                  </button>
                  {isDragged ? (
                    <div
                      className="detail-property-placeholder"
                      style={{ minHeight: dragState?.ghostHeight ?? 72 }}
                    />
                  ) : (
                    <section className="property-block">
                      <div className="property-heading">
                        <span>{key}</span>
                        {issue ? <small className={issue.severity}>{issue.message}</small> : null}
                      </div>
                      {renderValueEditor({
                        cellId: `detail:${rowIndex}:${key}`,
                        pathParts: [key],
                        fieldName: key,
                        displayType: displayTypes[key] ?? defaultTypeFor(value),
                        value,
                        selectOptions: selectOptionsByField[key] ?? [],
                        relationOptions,
                        relationConfigs,
                        sourcePath,
                        collectionPath,
                        onOpenRelationTarget,
                        onRenameSelectOption,
                        onDeleteSelectOption,
                        onSetSelectOptionColor,
                        onEditField,
                        onOpenNested: (nestedValue, path, customTitle) => openNestedField(key, nestedValue, path, customTitle),
                      })}
                    </section>
                  )}
                </div>
              </Fragment>
            );
          })}
          {dragState && dragState.targetIndex === dragState.restOrder.length ? (
            <div className="detail-drop-indicator" />
          ) : null}
        </div>
        <RelationBacklinksPanel
          backlinks={relationBacklinks}
          impacts={primaryKeyImpacts}
          syncPlan={primaryKeySyncPlan}
          syncResult={primaryKeySyncResult}
          syncing={saving}
          onOpenBacklink={onOpenBacklink}
          onRequestSyncSave={onRequestSyncSave}
        />
      </aside>
      <aside className={`detail-panel secondary ${activeNested ? "open" : ""}`} ref={nestedPanelRef}>
        {activeNested && Array.isArray(activeNestedValue) ? (
          <NestedCollectionPanel
            relationOptions={relationOptions}
            relationConfigs={relationConfigs}
            sourcePath={sourcePath}
            collectionPath={collectionPath}
            title={activeNested.title}
            items={activeNestedValue}
            rootField={activeNested.rootField}
            basePath={activeNested.path}
            selectedIndex={activeNested.selectedIndex}
            onBack={closeNestedPanel}
            onCloseAll={() => setNestedStack([])}
            onSelectItem={(selectedIndex) => {
              setNestedStack((current) => current.map((entry, index) => index === current.length - 1 ? { ...entry, selectedIndex } : entry));
            }}
            onAddItem={() => {
              const nextItem = makeEmptyNestedItem(activeNestedValue[0]);
              updateNestedValue(activeNested.rootField, activeNested.path, [...activeNestedValue, nextItem]);
              setNestedStack((current) => current.map((entry, index) => index === current.length - 1 ? { ...entry, selectedIndex: activeNestedValue.length } : entry));
            }}
            onEditItem={(selectedIndex, nextValue) => updateNestedValue(activeNested.rootField, [...activeNested.path, selectedIndex], nextValue)}
            onOpenNested={(selectedIndex, pathSuffix, nestedValue) => {
              const tail = pathSuffix.at(-1);
              const segmentLabel = typeof tail === "string" && tail ? tail : `item ${selectedIndex + 1}`;
              openNestedField(
                activeNested.rootField,
                nestedValue,
                [...activeNested.path, selectedIndex, ...pathSuffix],
                `${segmentLabel} - ${Array.isArray(nestedValue) ? nestedValue.length : 0} 条`,
              );
            }}
          />
        ) : activeNested && isPlainObjectValue(activeNestedValue) ? (
          <NestedObjectPanel
            title={activeNested.title}
            value={activeNestedValue}
            rootField={activeNested.rootField}
            basePath={activeNested.path}
            relationOptions={relationOptions}
            relationConfigs={relationConfigs}
            sourcePath={sourcePath}
            collectionPath={collectionPath}
            onBack={closeNestedPanel}
            onCloseAll={() => setNestedStack([])}
            onEditValue={(path, nextValue) => updateNestedValue(activeNested.rootField, [...activeNested.path, ...path], nextValue)}
            onOpenNested={(pathSuffix, nestedValue) => {
              const tail = pathSuffix.at(-1);
              const segmentLabel = typeof tail === "string" && tail ? tail : activeNested.rootField;
              openNestedField(
                activeNested.rootField,
                nestedValue,
                [...activeNested.path, ...pathSuffix],
                `${segmentLabel} - ${Array.isArray(nestedValue) ? nestedValue.length : Object.keys(nestedValue ?? {}).length} 条`,
              );
            }}
          />
        ) : null}
      </aside>
      {dragState ? (
        <div
          className="detail-property-ghost"
          style={{
            top: dragState.ghostTop,
            left: dragState.ghostLeft,
            width: dragState.ghostWidth,
            minHeight: dragState.ghostHeight,
          }}
        >
          <span className="detail-property-ghost-label">{dragState.field}</span>
        </div>
      ) : null}
    </>
  );
}

function NestedCollectionPanel(props: {
  title: string;
  items: unknown[];
  rootField: string;
  basePath: Array<string | number>;
  relationOptions: Record<string, RelationOption[]>;
  relationConfigs?: Record<string, RelationConfig>;
  sourcePath?: string | null;
  collectionPath?: string;
  selectedIndex: number | null;
  onBack: () => void;
  onCloseAll: () => void;
  onSelectItem: (index: number) => void;
  onAddItem: () => void;
  onEditItem: (index: number, value: unknown) => void;
  onOpenNested: (selectedIndex: number, pathSuffix: Array<string | number>, nestedValue: unknown[]) => void;
}) {
  const selectedItem = props.selectedIndex == null ? null : props.items[props.selectedIndex] ?? null;

  return (
    <>
      <div className="detail-header">
        <div className="detail-title-block">
          <div className="panel-kicker">Nested detail</div>
          <div className="panel-title">{props.title}</div>
          <div className="panel-subtitle">{props.items.length} items</div>
        </div>
        <div className="detail-nav">
          <button className="icon-button" onClick={props.onBack} title="Back">
            <icons.previous size={16} />
          </button>
          <button className="icon-button" onClick={props.onCloseAll} title="Close nested detail">
            <icons.close size={16} />
          </button>
        </div>
      </div>
      <div className="nested-item-list">
        {props.items.map((item, index) => (
          <button
            className={`nested-item-button ${props.selectedIndex === index ? "selected" : ""}`}
            key={index}
            onClick={() => props.onSelectItem(index)}
          >
            <strong>{getNestedItemSummary(item, index)}</strong>
            <span>{getNestedItemMeta(item)}</span>
          </button>
        ))}
      </div>
      <div className="nested-panel-actions">
        <button className="ghost-button" onClick={props.onAddItem}>Add item</button>
      </div>
      {props.selectedIndex != null ? (
        <div className="property-list nested-property-list">
          {renderNestedItemEditor(
            selectedItem,
            props.rootField,
            props.selectedIndex,
            props.basePath,
            props.relationOptions,
            props.relationConfigs,
            props.sourcePath,
            props.collectionPath,
            props.onEditItem,
            props.onOpenNested,
          )}
        </div>
      ) : null}
    </>
  );
}

function NestedObjectPanel(props: {
  title: string;
  value: Record<string, unknown>;
  rootField: string;
  basePath: Array<string | number>;
  relationOptions: Record<string, RelationOption[]>;
  relationConfigs?: Record<string, RelationConfig>;
  sourcePath?: string | null;
  collectionPath?: string;
  onBack: () => void;
  onCloseAll: () => void;
  onEditValue: (path: Array<string | number>, value: unknown) => void;
  onOpenNested: (path: Array<string | number>, nestedValue: unknown[] | Record<string, unknown>) => void;
}) {
  return (
    <>
      <div className="detail-header">
        <div className="detail-title-block">
          <div className="panel-kicker">Nested detail</div>
          <div className="panel-title">{props.title}</div>
          <div className="panel-subtitle">{Object.keys(props.value).length} fields</div>
        </div>
        <div className="detail-nav">
          <button className="icon-button" onClick={props.onBack} title="Back">
            <icons.previous size={16} />
          </button>
          <button className="icon-button" onClick={props.onCloseAll} title="Close nested detail">
            <icons.close size={16} />
          </button>
        </div>
      </div>
      <div className="property-list nested-property-list">
        {Object.entries(props.value).map(([key, value]) => (
          <section className="property-block" key={`${props.rootField}:${key}`}>
            <div className="property-heading">
              <span>{key}</span>
            </div>
            {renderValueEditor({
              cellId: `nested-object:${props.rootField}:${key}`,
              pathParts: [props.rootField, ...props.basePath, key],
              fieldName: key,
              displayType: defaultTypeFor(value),
              value,
              selectOptions: [],
              relationOptions: props.relationOptions,
              relationConfigs: props.relationConfigs,
              sourcePath: props.sourcePath,
              collectionPath: props.collectionPath,
              onRenameSelectOption: () => {},
              onDeleteSelectOption: () => {},
              onSetSelectOptionColor: () => {},
              onEditField: (_fieldName, nextValue) => props.onEditValue([key], nextValue),
              onOpenNested: (nestedValue, path, customTitle) => props.onOpenNested([key, ...path], Array.isArray(nestedValue) ? nestedValue : nestedValue as Record<string, unknown>),
            })}
          </section>
        ))}
      </div>
    </>
  );
}

function renderNestedItemEditor(
  item: unknown,
  rootField: string,
  index: number,
  basePath: Array<string | number>,
  relationOptions: Record<string, RelationOption[]>,
  relationConfigs: Record<string, RelationConfig> | undefined,
  sourcePath: string | null | undefined,
  collectionPath: string | undefined,
  onEditItem: (index: number, value: unknown) => void,
  onOpenNested: (selectedIndex: number, pathSuffix: Array<string | number>, nestedValue: unknown[]) => void,
) {
  if (Array.isArray(item)) {
    return (
      <section className="property-block">
        <div className="property-heading">
          <span>value</span>
        </div>
        <button className="nested-entry-button" onClick={() => onOpenNested(index, [], item)}>
          <icons.nested size={15} />
          <span>{summarizeArrayValue(item)}</span>
        </button>
      </section>
    );
  }

  if (item && typeof item === "object") {
    return Object.entries(item as Record<string, unknown>).map(([key, value]) => {
      const relation = getRelationConfig([rootField, ...basePath, index, key], relationOptions, relationConfigs, sourcePath, collectionPath);
      const nextPath = [key];
      return (
        <section className="property-block" key={`${index}:${key}`}>
          <div className="property-heading">
            <span>{key}</span>
          </div>
          {relation && isRelationValue(value) ? (
            <RelationCellEditor
              cellId={`nested:${rootField}:${index}:${key}`}
              configured={relation.configured}
              mode={relation.mode}
              options={relation.options}
              value={value as string | number | null | Array<string | number>}
              onEdit={(next) => onEditItem(index, { ...(item as Record<string, unknown>), [key]: next })}
            />
          ) : Array.isArray(value) ? (
            <button className="nested-entry-button" onClick={() => onOpenNested(index, nextPath, value)}>
              <icons.nested size={15} />
              <span>{summarizeArrayValue(value)}</span>
            </button>
          ) : value && typeof value === "object" ? (
            <NestedEditor
              value={value}
              onChange={(next) => onEditItem(index, { ...(item as Record<string, unknown>), [key]: next })}
              onOpenNestedArray={(path, nestedValue) => onOpenNested(index, [key, ...path], nestedValue)}
            />
          ) : shouldUseMultilineEditor(key, value) ? (
            <textarea
              className="detail-input detail-textarea"
              rows={4}
              value={value == null ? "" : String(value)}
              onChange={(event) => onEditItem(index, { ...(item as Record<string, unknown>), [key]: event.target.value })}
            />
          ) : (
            <input
              className="detail-input"
              value={value == null ? "" : String(value)}
              onChange={(event) => onEditItem(index, { ...(item as Record<string, unknown>), [key]: event.target.value })}
            />
          )}
        </section>
      );
    });
  }

  return (
    <section className="property-block">
      <div className="property-heading">
        <span>value</span>
      </div>
      <input
        className="detail-input"
        value={item == null ? "" : String(item)}
        onChange={(event) => onEditItem(index, event.target.value)}
      />
    </section>
  );
}

function renderValueEditor(props: {
  cellId: string;
  pathParts: Array<string | number>;
  fieldName: string;
  displayType: FieldDisplayType;
  value: unknown;
  selectOptions: MultiSelectOptionView[];
  relationOptions: Record<string, RelationOption[]>;
  relationConfigs?: Record<string, RelationConfig>;
  sourcePath?: string | null;
  collectionPath?: string;
  onOpenRelationTarget?: (config: RelationConfig, value: string | number) => void;
  onRenameSelectOption: (fieldName: string, previousValue: string | number, nextValue: string) => void;
  onDeleteSelectOption: (fieldName: string, optionValue: string | number) => void;
  onSetSelectOptionColor: (fieldName: string, optionValue: string | number, color: MultiSelectOptionColor | null) => void;
  onEditField: (fieldName: string, value: unknown) => void;
  onOpenNested: (value: unknown, path: Array<string | number>, customTitle?: string) => void;
}) {
  const relation = getRelationConfig(props.pathParts, props.relationOptions, props.relationConfigs, props.sourcePath, props.collectionPath);
  if (relation && isRelationValue(props.value)) {
    return (
      <RelationCellEditor
        cellId={props.cellId}
        configured={relation.configured}
        mode={relation.mode}
        options={relation.options}
        value={props.value as string | number | null | Array<string | number>}
        onOpenTarget={relation.config && props.onOpenRelationTarget ? (value) => props.onOpenRelationTarget!(relation.config!, value) : undefined}
        onEdit={(next) => props.onEditField(props.fieldName, next)}
      />
    );
  }
  if (props.displayType === "Select" && (props.value == null || typeof props.value === "string" || typeof props.value === "number")) {
    return (
      <SelectCellEditor
        cellId={props.cellId}
        options={props.selectOptions}
        value={props.value as string | number | null}
        onEdit={(next) => props.onEditField(props.fieldName, next)}
        onRenameOption={(previousValue, nextValue) => props.onRenameSelectOption(props.fieldName, previousValue, nextValue)}
        onDeleteOption={(optionValue) => props.onDeleteSelectOption(props.fieldName, optionValue)}
        onSetOptionColor={(optionValue, color) => props.onSetSelectOptionColor(props.fieldName, optionValue, color)}
      />
    );
  }
  if (Array.isArray(props.value)) {
    return (
      <button className="nested-entry-button" onClick={() => props.onOpenNested(props.value as unknown[], [])}>
        <icons.nested size={15} />
        <span>{props.fieldName} - {summarizeArrayValue(props.value)}</span>
      </button>
    );
  }
  if (props.value && typeof props.value === "object") {
    return (
      <button className="nested-entry-button" onClick={() => props.onOpenNested(props.value as Record<string, unknown>, [], `${props.fieldName} - ${Object.keys(props.value as Record<string, unknown>).length} 字段`)}>
        <icons.nested size={15} />
        <span>{props.fieldName} - {summarizeObjectValue(props.value as Record<string, unknown>)}</span>
      </button>
    );
  }
  if (shouldUseMultilineEditor(props.fieldName, props.value)) {
    return (
      <textarea
        key={`${props.fieldName}:${String(props.value ?? "")}`}
        className="detail-input detail-textarea"
        defaultValue={props.value == null ? "" : String(props.value)}
        rows={4}
        onInput={(event) => props.onEditField(props.fieldName, (event.target as HTMLTextAreaElement).value)}
      />
    );
  }
  return (
    <input
      key={`${props.fieldName}:${String(props.value ?? "")}`}
      className="detail-input"
      defaultValue={props.value == null ? "" : String(props.value)}
      onInput={(event) => props.onEditField(props.fieldName, (event.target as HTMLInputElement).value)}
    />
  );
}

function getRelationConfig(
  pathParts: Array<string | number>,
  relationOptions: Record<string, RelationOption[]>,
  relationConfigs: Record<string, RelationConfig> = {},
  sourcePath?: string | null,
  collectionPath?: string,
) {
  if (sourcePath && collectionPath) {
    const relationKey = buildRelationKey({ sourceFile: sourcePath, sourceCollection: collectionPath, fieldPath: pathParts });
    const config = relationConfigs[relationKey];
    if (config) {
      return {
        configured: true,
        config,
        mode: config.mode,
        options: relationOptions[relationKey] ?? [],
      };
    }
  }
  return null;
}

function isRelationValue(value: unknown) {
  if (value == null) return true;
  if (typeof value === "string" || typeof value === "number") return true;
  return Array.isArray(value) && value.every((item) => item == null || typeof item === "string" || typeof item === "number");
}

function summarizeArrayValue(value: unknown[]) {
  if (value.length === 0) return "0 条";
  const kind = value.every((item) => item && typeof item === "object") ? "记录" : "项目";
  return `${value.length} ${kind}`;
}

function summarizeObjectValue(value: Record<string, unknown>) {
  const keys = Object.keys(value);
  if (keys.length === 0) return "0 字段";
  return `${keys.length} 字段`;
}

function getNestedItemSummary(item: unknown, index: number) {
  if (item && typeof item === "object" && !Array.isArray(item)) {
    const record = item as Record<string, unknown>;
    const preferred = ["name", "category", "effect_type", "id", "keyword_id"];
    const first = preferred.map((key) => record[key]).find((value) => value != null && value !== "");
    if (first != null) return String(first);
    return String(getRecordTitle(record, Object.keys(record), index));
  }
  return item == null || item === "" ? `Item ${index + 1}` : String(item);
}

function getNestedItemMeta(item: unknown) {
  if (item && typeof item === "object" && !Array.isArray(item)) {
    const record = item as Record<string, unknown>;
    const metaKeys = ["category", "effect_type", "timing", "name_en"];
    const meta = metaKeys
      .map((key) => record[key])
      .filter((value) => value != null && value !== "")
      .slice(0, 3)
      .map(String);
    return meta.join(" / ") || Object.keys(record).slice(0, 3).join(" / ");
  }
  return "";
}

function makeEmptyNestedItem(sample: unknown) {
  if (Array.isArray(sample)) return [];
  if (sample && typeof sample === "object") {
    return Object.fromEntries(Object.keys(sample as Record<string, unknown>).map((key) => [key, ""]));
  }
  return "";
}

function getValueAtPath(value: unknown, path: Array<string | number>) {
  return path.reduce<unknown>((current, segment) => {
    if (Array.isArray(current) && typeof segment === "number") return current[segment];
    if (current && typeof current === "object" && typeof segment === "string") return (current as Record<string, unknown>)[segment];
    return undefined;
  }, value);
}

function updateValueAtPath(value: unknown, path: Array<string | number>, nextValue: unknown): unknown {
  if (path.length === 0) return nextValue;
  const [head, ...rest] = path;
  if (Array.isArray(value) && typeof head === "number") {
    return value.map((item, index) => index === head ? updateValueAtPath(item, rest, nextValue) : item);
  }
  if (value && typeof value === "object" && typeof head === "string") {
    return {
      ...(value as Record<string, unknown>),
      [head]: updateValueAtPath((value as Record<string, unknown>)[head], rest, nextValue),
    };
  }
  return value;
}

function orderDetailFields(fields: string[], detailOrder: string[]) {
  const known = detailOrder.filter((field) => fields.includes(field));
  const rest = fields.filter((field) => !known.includes(field));
  return [...known, ...rest];
}

function findDetailDropIndex(order: string[], pointerY: number, refs: Record<string, HTMLElement | null>) {
  let targetIndex = order.length;
  for (const fieldName of order) {
    const element = refs[fieldName];
    if (!element) continue;
    const rect = element.getBoundingClientRect();
    const midpoint = rect.top + rect.height / 2;
    const fieldIndex = order.indexOf(fieldName);
    if (pointerY < midpoint) {
      targetIndex = fieldIndex;
      break;
    }
  }
  return Math.max(0, Math.min(order.length, targetIndex));
}

function insertDraggedField(order: string[], draggedField: string, targetIndex: number) {
  const withoutDragged = order.filter((field) => field !== draggedField);
  const next = [...withoutDragged];
  next.splice(Math.max(0, Math.min(withoutDragged.length, targetIndex)), 0, draggedField);
  return next;
}

function shouldUseMultilineEditor(fieldName: string, value: unknown) {
  if (typeof value !== "string") return false;
  const normalized = fieldName.toLowerCase();
  if (value.includes("\n")) return true;
  if (value.length >= 60) return true;
  return /(description|summary|notes?|text|content|body|dialog|dialogue|lore|flavor)/.test(normalized);
}

function isPlainObjectValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
