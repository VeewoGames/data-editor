import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { flushSync } from "react-dom";
import type { FieldDisplayType } from "../model/fieldTypes";
import { fieldTypes } from "../model/fieldTypes";
import { icons } from "../components/icons";
import { shouldStartColumnDrag } from "./column-dnd.mjs";

type ColumnHeaderProps = {
  fieldName: string;
  displayType: FieldDisplayType;
  roleKind?: "normal" | "relation" | "backlink";
  allowTypeChange: boolean;
  sortDirection: "asc" | "desc" | null;
  wrapped: boolean;
  width: number;
  pressed: boolean;
  isDragging: boolean;
  relationConfigured: boolean;
  onSort: (direction: "asc" | "desc" | null) => void;
  onAddFilter: () => void;
  onHide: () => void;
  onResize: (width: number) => void;
  onMove: (direction: "left" | "right") => void;
  onDragStart: (fieldName: string, rect: DOMRect, pointerOffsetX: number) => void;
  onDragMove: (fieldName: string, clientX: number) => void;
  onDragEnd: (fieldName: string) => void;
  onPressChange: (fieldName: string, pressed: boolean) => void;
  onToggleWrap: () => void;
  onChangeFieldType: (type: FieldDisplayType) => void;
  onConfigureRelation: () => void;
  onClearRelation: () => void;
  onDeleteField: () => void;
};

const minColumnWidth = 56;
const maxColumnWidth = 560;
const displayTypeLabels: Record<FieldDisplayType, string> = {
  Text: "文本",
  Number: "数字",
  Checkbox: "复选框",
  Select: "单选",
  "Multi-select": "多选",
  Relation: "关联",
  Backlink: "反向关联",
  Date: "日期",
  JSON: "JSON",
  Nested: "嵌套结构",
};

export function ColumnHeader(props: ColumnHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
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

  function beginResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();

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
      props.onPressChange(props.fieldName, false);
      document.body.classList.remove("is-dragging-column");
      pressStateRef.current = null;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
    };

    const onPointerCancel = () => {
      props.onPressChange(props.fieldName, false);
      document.body.classList.remove("is-dragging-column");
      props.onDragEnd(props.fieldName);
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
        className="column-trigger"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setMenuOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setMenuOpen(true);
          }
        }}
        onPointerDown={beginDrag}
        title={props.fieldName}
        type="button"
      >
        <span>{props.fieldName}</span>
        <small>{displayTypeLabels[props.displayType]}</small>
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
          {props.allowTypeChange ? (
            <>
              <div className="menu-separator" />
              {fieldTypes.map((type: FieldDisplayType) => (
                <button
                  className="menu-item"
                  data-field-type={type}
                  key={type}
                  onClick={() => runAfterMenuClose(() => props.onChangeFieldType(type))}
                  type="button"
                >
                  {displayTypeLabels[type]}
                </button>
              ))}
              <div className="menu-separator" />
            </>
          ) : (
            <div className="menu-separator" />
          )}
          {props.roleKind === "backlink" ? null : (
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
          )}
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
