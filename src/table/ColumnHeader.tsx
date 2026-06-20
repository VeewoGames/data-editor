import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal, flushSync } from "react-dom";
import type { FieldDisplayType } from "../model/fieldTypes";
import { FieldTypeIcon } from "../components/FieldTypeIcon";
import { icons } from "../components/icons";
import type { FieldMenuCapabilities } from "./field-capabilities";
import { shouldStartColumnDrag } from "./column-dnd.mjs";

type ColumnHeaderProps = {
  fieldName: string;
  baseDisplayType: FieldDisplayType;
  effectiveDisplayType: FieldDisplayType;
  roleKind?: "normal" | "relation" | "backlink";
  capabilities: FieldMenuCapabilities;
  allowTypeChange: boolean;
  sortDirection: "asc" | "desc" | null;
  isTitleField: boolean;
  isPrimaryKeyField: boolean;
  wrapped: boolean;
  width: number;
  pressed: boolean;
  isDragging: boolean;
  tooltipSuppressed: boolean;
  relationConfigured: boolean;
  documentConfigured: boolean;
  onSort: (direction: "asc" | "desc" | null) => void;
  onAddFilter: () => void;
  onSetTitleField: () => void;
  onSetPrimaryKeyField: () => void;
  onHide: () => void;
  onResize: (width: number) => void;
  onMove: (direction: "left" | "right") => void;
  onDragStart: (fieldName: string, rect: DOMRect, pointerOffsetX: number) => void;
  onDragMove: (fieldName: string, clientX: number) => void;
  onDragEnd: (fieldName: string) => void;
  onDragCancel: (fieldName: string) => void;
  onPressChange: (fieldName: string, pressed: boolean) => void;
  onToggleWrap: () => void;
  onChangeFieldType: (type: FieldDisplayType) => void;
  onConfigureRelation: () => void;
  onClearRelation: () => void;
  onConfigureDocument: () => void;
  onClearDocument: () => void;
  onDeleteField: () => void;
};

const minColumnWidth = 56;
const maxColumnWidth = 560;
const displayTypeLabels: Record<FieldDisplayType, string> = {
  Text: "文本",
  Number: "数字",
  Checkbox: "复选框",
  Select: "单选",
  Document: "关联文档",
  "Multi-select": "多选",
  Relation: "关联",
  Backlink: "反向关联",
  Date: "日期",
  JSON: "JSON",
  Nested: "嵌套结构",
};

export function ColumnHeader(props: ColumnHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [isPointerPressActive, setIsPointerPressActive] = useState(false);
  const [isTruncated, setIsTruncated] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ left: 12, top: 0 });
  const headerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const titleRef = useRef<HTMLSpanElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const widthRef = useRef(props.width);
  const pressStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    moved: boolean;
    dragging: boolean;
    startRect: DOMRect;
    pointerOffsetX: number;
  } | null>(null);
  const dragState = useRef<{
    startX: number;
    startWidth: number;
    frame: number | null;
    lastWidth: number;
  } | null>(null);

  useEffect(() => {
    widthRef.current = props.width;
  }, [props.width]);

  useEffect(() => {
    const measureTitle = () => {
      const titleElement = titleRef.current;
      if (!titleElement) {
        setIsTruncated(false);
        return;
      }
      setIsTruncated(titleElement.scrollWidth - titleElement.clientWidth > 1);
    };
    measureTitle();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measureTitle());
    if (titleRef.current) observer.observe(titleRef.current);
    if (triggerRef.current) observer.observe(triggerRef.current);
    return () => observer.disconnect();
  }, [props.fieldName, props.width]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (headerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const shouldShowTooltip = (hovered || focused) &&
    isTruncated &&
    !menuOpen &&
    !isResizing &&
    !isPointerPressActive &&
    !props.isDragging &&
    !props.tooltipSuppressed;
  const showTypeActions = props.capabilities.allowedTypeTargets.length > 0;
  const showTitleAction = props.capabilities.canBeTitle;
  const showPrimaryKeyAction = props.capabilities.canBePrimaryKey;
  const showDocumentActions = props.capabilities.canConfigureDocument;
  const showRelationActions = props.relationConfigured || props.capabilities.canConfigureRelation;
  const showFieldSemanticSection = showTitleAction || showPrimaryKeyAction || showDocumentActions || showRelationActions;

  useEffect(() => {
    if (!shouldShowTooltip) return;
    const updateTooltipPosition = () => {
      const anchor = headerRef.current?.closest("th[data-column-field]") ?? headerRef.current;
      if (!(anchor instanceof HTMLElement)) return;
      const anchorRect = anchor.getBoundingClientRect();
      const tooltipWidth = tooltipRef.current?.offsetWidth ?? 0;
      const tooltipHeight = tooltipRef.current?.offsetHeight ?? 0;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const maxLeft = Math.max(12, viewportWidth - tooltipWidth - 12);
      const maxTop = Math.max(12, viewportHeight - tooltipHeight - 12);
      const preferredTop = anchorRect.top - tooltipHeight - 6;
      const fallbackTop = anchorRect.bottom + 6;
      const nextLeft = Math.min(Math.max(anchorRect.left, 12), maxLeft);
      setTooltipPosition({
        left: nextLeft,
        top: preferredTop >= 12 ? preferredTop : Math.min(Math.max(fallbackTop, 12), maxTop),
      });
    };
    updateTooltipPosition();
    const frame = window.requestAnimationFrame(updateTooltipPosition);
    window.addEventListener("resize", updateTooltipPosition);
    window.addEventListener("scroll", updateTooltipPosition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updateTooltipPosition);
      window.removeEventListener("scroll", updateTooltipPosition, true);
    };
  }, [shouldShowTooltip, props.fieldName, props.width]);

  function beginResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setIsResizing(true);

    dragState.current = {
      startX: event.clientX,
      startWidth: widthRef.current,
      frame: null,
      lastWidth: widthRef.current,
    };

    document.body.classList.add("is-resizing-column");
    updateResizeGuide(event.clientX);

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (!dragState.current) return;
      const nextWidth = clampColumnWidth(dragState.current.startWidth + moveEvent.clientX - dragState.current.startX);
      if (Math.abs(nextWidth - dragState.current.lastWidth) < 4) return;
      dragState.current.lastWidth = nextWidth;
      updateResizeGuide(moveEvent.clientX);
    };

    const onPointerUp = () => {
      const state = dragState.current;
      if (state?.frame != null) window.cancelAnimationFrame(state.frame);
      if (state) commitColumnWidth(state.lastWidth);
      dragState.current = null;
      setIsResizing(false);
      document.body.classList.remove("is-resizing-column");
      document.body.style.removeProperty("--column-resize-guide-x");
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  }

  function commitColumnWidth(width: number) {
    widthRef.current = width;
    updateTableColumnWidth(headerRef.current, props.fieldName, width);
    props.onResize(width);
  }

  function runAfterMenuClose(action: () => void) {
    action();
    setMenuOpen(false);
  }

  async function copyFieldText() {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    await navigator.clipboard.writeText(props.fieldName);
    setMenuOpen(false);
  }

  function runDialogAction(action: () => void) {
    flushSync(() => {
      action();
    });
    setMenuOpen(false);
  }

  function beginDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    setIsPointerPressActive(true);
    setMenuOpen(false);
    const startRect = headerRef.current?.getBoundingClientRect() ?? event.currentTarget.getBoundingClientRect();
    pressStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      dragging: false,
      startRect,
      pointerOffsetX: event.clientX - startRect.left,
    };

    const onPointerMove = (moveEvent: PointerEvent) => {
      const state = pressStateRef.current;
      if (!state || moveEvent.pointerId !== state.pointerId) return;
      if (shouldStartColumnDrag(moveEvent.clientX - state.startX, moveEvent.clientY - state.startY)) {
        state.moved = true;
      }
      if (state.moved && !state.dragging) {
        state.dragging = true;
        props.onPressChange(props.fieldName, true);
        document.body.classList.add("is-dragging-column");
        props.onDragStart(props.fieldName, state.startRect, state.pointerOffsetX);
      }
      if (state.dragging) props.onDragMove(props.fieldName, moveEvent.clientX);
    };

    const onPointerUp = (upEvent: PointerEvent) => {
      const state = pressStateRef.current;
      if (!state || upEvent.pointerId !== state.pointerId) return;
      if (state.dragging) props.onDragEnd(props.fieldName);
      else if (!state.moved) setMenuOpen(true);
      setIsPointerPressActive(false);
      props.onPressChange(props.fieldName, false);
      document.body.classList.remove("is-dragging-column");
      pressStateRef.current = null;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
    };

    const onPointerCancel = () => {
      setIsPointerPressActive(false);
      props.onPressChange(props.fieldName, false);
      document.body.classList.remove("is-dragging-column");
      props.onDragCancel(props.fieldName);
      pressStateRef.current = null;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
  }

  return (
    <div
      className={`column-header ${props.pressed ? "is-column-pressed" : ""} ${props.isDragging ? "is-column-dragging" : ""}`}
      ref={headerRef}
    >
      <button
        aria-label={props.fieldName}
        className="column-trigger"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setMenuOpen(true);
        }}
        onBlur={() => setFocused(false)}
        onFocus={() => setFocused(true)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setMenuOpen(true);
          }
        }}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onPointerDown={beginDrag}
        ref={triggerRef}
        type="button"
      >
        <span ref={titleRef}>{props.fieldName}</span>
        <small>{displayTypeLabels[props.effectiveDisplayType]}</small>
      </button>
      {menuOpen ? (
        <div className="menu-content column-menu-popup" ref={menuRef}>
          <button className="menu-item" onClick={() => runAfterMenuClose(() => props.onSort("asc"))} type="button">
            <icons.sortAscending size={15} /> 升序排序
          </button>
          <button className="menu-item" onClick={() => runAfterMenuClose(() => props.onSort("desc"))} type="button">
            <icons.sortDescending size={15} /> 降序排序
          </button>
          <button className="menu-item" onClick={() => runAfterMenuClose(() => props.onSort(null))} type="button">
            <icons.close size={15} /> 清除排序
          </button>
          {props.roleKind === "backlink" ? null : (
            <button className="menu-item" data-column-action="add-filter" onClick={() => runAfterMenuClose(props.onAddFilter)} type="button">
              <icons.filter size={15} /> 添加筛选
            </button>
          )}
          <div className="menu-separator" />
          <button className="menu-item" onClick={() => runAfterMenuClose(props.onToggleWrap)} type="button">
            <icons.wrapText size={15} /> {props.wrapped ? "取消内容自动换行" : "内容自动换行"}
          </button>
          <button className="menu-item" onClick={copyFieldText} type="button">
            <icons.copy size={15} /> 复制字段文本
          </button>
          {showTypeActions ? (
            <>
              <div className="menu-separator" />
              {props.capabilities.allowedTypeTargets.map((type) => (
                <button
                  className="menu-item"
                  data-field-type={type}
                  key={type}
                  onClick={() => runAfterMenuClose(() => props.onChangeFieldType(type))}
                  type="button"
                >
                  <FieldTypeIcon fieldType={type} size={15} strokeWidth={2.2} />
                  {displayTypeLabels[type]}
                </button>
              ))}
            </>
          ) : null}
          {showFieldSemanticSection ? (
            <>
              {showTypeActions ? <div className="menu-separator" /> : null}
              {showTitleAction ? (
                <button
                  className={`menu-item${props.isTitleField ? " active" : ""}`}
                  data-column-action="set-title"
                  disabled={props.isTitleField}
                  onClick={() => runAfterMenuClose(props.onSetTitleField)}
                  type="button"
                >
                  <icons.textField size={15} /> {props.isTitleField ? "已设为标题字段" : "设为标题"}
                </button>
              ) : null}
              {showPrimaryKeyAction ? (
                <button
                  className={`menu-item${props.isPrimaryKeyField ? " active" : ""}`}
                  data-column-action="set-primary-key"
                  disabled={props.isPrimaryKeyField}
                  onClick={() => runAfterMenuClose(props.onSetPrimaryKeyField)}
                  type="button"
                >
                  <icons.numberField size={15} /> {props.isPrimaryKeyField ? "已设为主键ID" : "设为主键ID"}
                </button>
              ) : null}
              {showDocumentActions ? (
                <>
                  <button
                    className={`menu-item${props.documentConfigured ? " active" : ""}`}
                    data-document-action="configure"
                    onClick={() => runDialogAction(props.onConfigureDocument)}
                    type="button"
                  >
                    <icons.jsonFile size={15} /> {props.documentConfigured ? "已设为关联文档字段" : "设为关联文档字段"}
                  </button>
                  {props.documentConfigured ? (
                    <button
                      className="menu-item"
                      data-document-action="clear"
                      onClick={() => runAfterMenuClose(props.onClearDocument)}
                      type="button"
                    >
                      <icons.close size={15} /> 取消关联文档字段
                    </button>
                  ) : null}
                </>
              ) : null}
              {showRelationActions ? (
                props.relationConfigured ? (
                  <>
                    <button className="menu-item" data-relation-action="edit" onClick={() => runDialogAction(props.onConfigureRelation)} type="button">
                      <icons.relation size={15} /> 编辑关联配置
                    </button>
                    <button className="menu-item" data-relation-action="clear" onClick={() => runAfterMenuClose(props.onClearRelation)} type="button">
                      <icons.relationOff size={15} /> 取消关联字段
                    </button>
                  </>
                ) : (
                  <button className="menu-item" data-relation-action="create" onClick={() => runDialogAction(props.onConfigureRelation)} type="button">
                    <icons.relation size={15} /> 设为关联字段
                  </button>
                )
              ) : null}
            </>
          ) : null}
          <div className="menu-separator" />
          <button className="menu-item" onClick={() => runAfterMenuClose(props.onHide)} type="button">
            <icons.hidden size={15} /> 隐藏字段
          </button>
          <button className="menu-item" data-column-action="move-left" onClick={() => runAfterMenuClose(() => props.onMove("left"))} type="button">
            <icons.previous size={15} /> 向左移动
          </button>
          <button className="menu-item" data-column-action="move-right" onClick={() => runAfterMenuClose(() => props.onMove("right"))} type="button">
            <icons.next size={15} /> 向右移动
          </button>
          <button className="menu-item" onClick={() => runAfterMenuClose(() => commitColumnWidth(180))} type="button">
            <icons.reset size={15} /> 重置列宽
          </button>
          {props.roleKind === "backlink" ? null : (
            <button className="menu-item danger" onClick={() => runAfterMenuClose(props.onDeleteField)} type="button">
              <icons.delete size={15} /> 删除字段
            </button>
          )}
        </div>
      ) : null}
      <div
        aria-label={`Resize ${props.fieldName} column`}
        aria-valuemax={maxColumnWidth}
        aria-valuemin={minColumnWidth}
        aria-valuenow={widthRef.current}
        className="column-resize-handle"
        onDoubleClick={() => commitColumnWidth(180)}
        onPointerDown={beginResize}
        role="separator"
        title="Drag to resize column"
      />
      {shouldShowTooltip && typeof document !== "undefined"
        ? createPortal(
          <div
            className="column-header-full-title-tooltip"
            ref={tooltipRef}
            style={{
              left: `${tooltipPosition.left}px`,
              top: `${tooltipPosition.top}px`,
            }}
          >
            {props.fieldName}
          </div>,
          document.body,
        )
        : null}
    </div>
  );
}

function clampColumnWidth(width: number) {
  return Math.max(minColumnWidth, Math.min(maxColumnWidth, Math.round(width)));
}

function updateResizeGuide(clientX: number) {
  document.body.style.setProperty("--column-resize-guide-x", `${Math.round(clientX)}px`);
}

function updateTableColumnWidth(headerElement: HTMLElement | null, fieldName: string, width: number) {
  const table = headerElement?.closest("table");
  if (!table) return;
  const column = [...table.querySelectorAll<HTMLTableColElement>("col[data-column-field]")]
    .find((item) => item.dataset.columnField === fieldName);
  if (!column) return;
  const next = `${width}px`;
  column.style.width = next;
  column.style.minWidth = next;
  updateTableWidth(table);
}

function updateTableWidth(table: HTMLTableElement) {
  const total = [...table.querySelectorAll<HTMLTableColElement>("col")]
    .reduce((sum, column) => {
      const width = Number.parseFloat(column.style.width || getComputedStyle(column).width);
      return sum + (Number.isFinite(width) ? width : 0);
    }, 0);
  if (!total) return;
  const next = `${Math.round(total)}px`;
  table.style.width = next;
  table.style.minWidth = next;
}
