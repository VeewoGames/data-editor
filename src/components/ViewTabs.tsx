import * as Popover from "@radix-ui/react-popover";
import { useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { CollectionView } from "../api/client";
import { icons } from "./icons";

export type ViewTabsProps = {
  snapshot: ViewTabsSnapshot;
  onSelectView: (viewId: string) => void;
  onCreateView: () => void;
  onRenameView: (viewId: string, name: string) => void;
  onDeleteView: (viewId: string) => void;
  onDuplicateView: (viewId: string) => void;
  onReorderViews: (viewIds: string[]) => void;
  onToggleFilterBar: () => void;
  onToggleTableTextEditMode: () => void;
  onToggleRowDeleteControls: () => void;
};

export type ViewTabsSnapshot = {
  views: CollectionView[];
  activeViewId: string | null;
  dirtyViewIds: Set<string>;
  commandSaving: boolean;
  filterBarVisible: boolean;
  hasActiveFilters: boolean;
  tableTextEditMode: boolean;
  rowDeleteControlsVisible: boolean;
  viewOrderDirty: boolean;
};

export function ViewTabs({
  snapshot,
  onSelectView,
  onCreateView,
  onRenameView,
  onDeleteView,
  onDuplicateView,
  onReorderViews,
  onToggleFilterBar,
  onToggleTableTextEditMode,
  onToggleRowDeleteControls,
}: ViewTabsProps) {
  const {
    views,
    activeViewId,
    dirtyViewIds,
    commandSaving,
    filterBarVisible,
    hasActiveFilters,
    tableTextEditMode,
    rowDeleteControlsVisible,
    viewOrderDirty,
  } = snapshot;
  const [draggingViewId, setDraggingViewId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ viewId: string; placement: "before" | "after" } | null>(null);
  const [openMenuViewId, setOpenMenuViewId] = useState<string | null>(null);
  const [renamingViewId, setRenamingViewId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [dragGhost, setDragGhost] = useState<null | {
    left: number;
    top: number;
    width: number;
    height: number;
    label: string;
  }>(null);
  const tabShellRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const pointerDragRef = useRef<null | {
    pointerId: number;
    sourceViewId: string;
    startX: number;
    startY: number;
    pointerOffsetX: number;
    shellTop: number;
    shellWidth: number;
    shellHeight: number;
    label: string;
    dragging: boolean;
  }>(null);
  const suppressClickRef = useRef(false);
  const viewIds = useMemo(() => views.map((view) => view.id), [views]);
  const viewTabsDisabled = commandSaving;

  useEffect(() => {
    if (!draggingViewId) return;
    function cancelPointerDrag() {
      pointerDragRef.current = null;
      setDraggingViewId(null);
      setDropTarget(null);
      setDragGhost(null);
    }
    window.addEventListener("pointercancel", cancelPointerDrag);
    return () => window.removeEventListener("pointercancel", cancelPointerDrag);
  }, [draggingViewId]);

  function beginRename(view: CollectionView) {
    if (viewTabsDisabled) return;
    setOpenMenuViewId(view.id);
    setRenamingViewId(view.id);
    setRenameDraft(view.name);
  }

  function submitRename(event: FormEvent<HTMLFormElement>, view: CollectionView) {
    event.preventDefault();
    if (viewTabsDisabled) return;
    const trimmed = renameDraft.trim();
    if (trimmed && trimmed !== view.name) onRenameView(view.id, trimmed);
    setRenamingViewId(null);
    setRenameDraft("");
    setOpenMenuViewId(null);
  }

  function cancelRename() {
    setRenamingViewId(null);
    setRenameDraft("");
  }

  function handleDelete(view: CollectionView) {
    if (viewTabsDisabled) return;
    if (!window.confirm(`删除视图“${view.name}”？`)) return;
    onDeleteView(view.id);
    setOpenMenuViewId(null);
  }

  async function handleCopyLink(view: CollectionView) {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    const url = new URL(window.location.href);
    url.hash = `view=${encodeURIComponent(view.id)}`;
    await navigator.clipboard.writeText(url.toString());
    setOpenMenuViewId(null);
  }

  function handleEditView() {
    const searchInput = document.querySelector<HTMLInputElement>(".search-box input");
    if (searchInput) {
      searchInput.focus();
    } else {
      document.querySelector<HTMLButtonElement>(".search-box .expandable-search-icon")?.click();
    }
    setOpenMenuViewId(null);
  }

  function handleDuplicate(view: CollectionView) {
    if (viewTabsDisabled) return;
    onDuplicateView(view.id);
    setOpenMenuViewId(null);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLButtonElement>, view: CollectionView) {
    if (viewTabsDisabled) return;
    if (event.button !== 0) return;
    const shell = tabShellRefs.current[view.id];
    if (!shell) return;
    const bounds = shell.getBoundingClientRect();
    pointerDragRef.current = {
      pointerId: event.pointerId,
      sourceViewId: view.id,
      startX: event.clientX,
      startY: event.clientY,
      pointerOffsetX: event.clientX - bounds.left,
      shellTop: bounds.top,
      shellWidth: bounds.width,
      shellHeight: bounds.height,
      label: view.name,
      dragging: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const state = pointerDragRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - state.startX;
    const deltaY = event.clientY - state.startY;
    if (!state.dragging) {
      if (Math.abs(deltaX) < 6 && Math.abs(deltaY) < 6) return;
      state.dragging = true;
      setDraggingViewId(state.sourceViewId);
      setDragGhost({
        left: event.clientX - state.pointerOffsetX,
        top: state.shellTop,
        width: state.shellWidth,
        height: state.shellHeight,
        label: state.label,
      });
      suppressClickRef.current = true;
    } else {
      setDragGhost((current) => current ? {
        ...current,
        left: event.clientX - state.pointerOffsetX,
      } : current);
    }
    setDropTarget(resolveDropTarget(viewIds, state.sourceViewId, tabShellRefs.current, event.clientX));
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    const state = pointerDragRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    if (state.dragging) {
      const target = resolveDropTarget(viewIds, state.sourceViewId, tabShellRefs.current, event.clientX);
      if (target) {
        const nextOrder = moveViewId(viewIds, state.sourceViewId, target.viewId, target.placement);
        if (nextOrder.join("\u0000") !== viewIds.join("\u0000")) onReorderViews(nextOrder);
      }
    }
    clearDragState();
  }

  function clearDragState() {
    pointerDragRef.current = null;
    setDraggingViewId(null);
    setDropTarget(null);
    setDragGhost(null);
  }

  return (
    <div className="view-tabs" aria-label="视图">
      <div className="view-tabs-main">
        <div className="view-tabs-list" role="tablist">
          {views.map((view) => {
          const active = view.id === activeViewId;
          const dropBefore = dropTarget?.viewId === view.id && dropTarget.placement === "before";
          const dropAfter = dropTarget?.viewId === view.id && dropTarget.placement === "after";
          return (
            <Popover.Root
              key={view.id}
              open={openMenuViewId === view.id}
              onOpenChange={(open) => {
                if (!open) setOpenMenuViewId(null);
              }}
            >
              <Popover.Anchor asChild>
                <div
                  ref={(node) => { tabShellRefs.current[view.id] = node; }}
                  className={[
                    "view-tab-shell",
                    active ? "active" : "",
                    dirtyViewIds.has(view.id) ? "dirty" : "",
                    draggingViewId === view.id ? "dragging" : "",
                    dropBefore ? "drop-before" : "",
                    dropAfter ? "drop-after" : "",
                  ].filter(Boolean).join(" ")}
                >
                  <button
                    type="button"
                    className="view-tab"
                    role="tab"
                    aria-selected={active}
                    disabled={viewTabsDisabled}
                    onClick={() => {
                      if (suppressClickRef.current) {
                        suppressClickRef.current = false;
                        return;
                      }
                      if (viewTabsDisabled) return;
                      if (active) {
                        setOpenMenuViewId(view.id);
                        return;
                      }
                      setOpenMenuViewId(null);
                      onSelectView(view.id);
                    }}
                    onDoubleClick={() => beginRename(view)}
                    onPointerDown={(event) => handlePointerDown(event, view)}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                  >
                    <icons.table size={17} />
                    <span className="view-tab-name">{view.name}</span>
                    {dirtyViewIds.has(view.id) ? <span className="view-tab-dirty-dot" aria-label="未保存的视图更改" /> : null}
                  </button>
                </div>
              </Popover.Anchor>
              <Popover.Portal>
                <Popover.Content className="menu-content view-tab-menu-content" sideOffset={6} align="start">
                  <div className="view-tab-menu" role="menu" aria-label={`${view.name} 视图操作`}>
                    {renamingViewId === view.id ? (
                      <form className="view-tab-rename-form" onSubmit={(event) => submitRename(event, view)}>
                        <input
                          aria-label="视图名称"
                          autoFocus
                          value={renameDraft}
                          onChange={(event) => setRenameDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") cancelRename();
                          }}
                        />
                        <button type="submit" disabled={!renameDraft.trim() || renameDraft.trim() === view.name}>保存</button>
                        <button type="button" onClick={cancelRename}>取消</button>
                      </form>
                    ) : (
                      <button className="view-tab-menu-item" type="button" onClick={() => beginRename(view)} role="menuitem">
                        <icons.textField size={20} />
                        <span>重命名</span>
                      </button>
                    )}
                    <button className="view-tab-menu-item" type="button" disabled role="menuitem">
                      <icons.table size={20} />
                      <span>显示为</span>
                      <icons.next size={16} className="view-tab-menu-chevron" />
                    </button>
                    <button className="view-tab-menu-item" type="button" onClick={handleEditView} role="menuitem">
                      <icons.filter size={20} />
                      <span>编辑视图</span>
                    </button>
                    <button className="view-tab-menu-item" type="button" disabled role="menuitem">
                      <icons.json size={20} />
                      <span>来源</span>
                      <span className="view-tab-menu-muted">团队共享视图</span>
                      <icons.next size={16} className="view-tab-menu-chevron" />
                    </button>
                    <div className="view-tab-menu-separator" />
                    <button className="view-tab-menu-item" type="button" onClick={() => void handleCopyLink(view)} role="menuitem">
                      <icons.relation size={20} />
                      <span>拷贝视图链接</span>
                    </button>
                    <div className="view-tab-menu-separator" />
                    <button className="view-tab-menu-item" type="button" onClick={() => handleDuplicate(view)} role="menuitem">
                      <icons.addField size={20} />
                      <span>创建视图副本</span>
                    </button>
                    <button className="view-tab-menu-item danger" type="button" onClick={() => handleDelete(view)} role="menuitem">
                      <icons.delete size={20} />
                      <span>删除视图</span>
                    </button>
                  </div>
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
          );
          })}
          <button type="button" className="view-tab-create" disabled={viewTabsDisabled} onClick={onCreateView} aria-label="创建视图">
            +
          </button>
        </div>
        <button
          type="button"
          className={[
            "view-tab-action filter-toggle view-tabs-filter-toggle",
            filterBarVisible ? "visible" : "",
            hasActiveFilters ? "has-filters" : "",
          ].filter(Boolean).join(" ")}
          onClick={onToggleFilterBar}
          aria-pressed={filterBarVisible}
          disabled={viewTabsDisabled}
          title="筛选"
        >
          <icons.filter size={18} />
          <span>筛选</span>
        </button>
        <button
          type="button"
          className={[
            "view-tab-action table-edit-toggle view-tabs-table-edit-toggle",
            tableTextEditMode ? "active" : "",
          ].filter(Boolean).join(" ")}
          onClick={onToggleTableTextEditMode}
          aria-pressed={tableTextEditMode}
          disabled={viewTabsDisabled}
          title="编辑文本单元格"
        >
          <icons.edit size={18} />
          <span>编辑</span>
        </button>
        <button
          type="button"
          className={[
            "view-tab-action row-delete-toggle view-tabs-row-delete-toggle",
            rowDeleteControlsVisible ? "active" : "",
          ].filter(Boolean).join(" ")}
          onClick={onToggleRowDeleteControls}
          aria-pressed={rowDeleteControlsVisible}
          disabled={viewTabsDisabled}
          title="调整显示选项"
        >
          <icons.adjust size={18} />
          <span>调整</span>
        </button>
      </div>
      {viewOrderDirty ? <div className="view-order-dirty">视图顺序有未保存更改</div> : null}
      {dragGhost ? (
        <div
          className="view-tab-drag-ghost"
          aria-hidden="true"
          style={{
            left: dragGhost.left,
            top: dragGhost.top,
            width: dragGhost.width,
            height: dragGhost.height,
          }}
        >
          <icons.table size={17} />
          <span>{dragGhost.label}</span>
        </div>
      ) : null}
    </div>
  );
}

function moveViewId(viewIds: string[], sourceViewId: string, targetViewId: string, placement: "before" | "after") {
  const withoutSource = viewIds.filter((id) => id !== sourceViewId);
  const targetIndex = withoutSource.indexOf(targetViewId);
  if (targetIndex < 0) return viewIds;
  const insertIndex = placement === "before" ? targetIndex : targetIndex + 1;
  return [
    ...withoutSource.slice(0, insertIndex),
    sourceViewId,
    ...withoutSource.slice(insertIndex),
  ];
}

function resolveDropTarget(
  viewIds: string[],
  sourceViewId: string,
  refs: Record<string, HTMLDivElement | null>,
  pointerX: number,
) {
  const otherViewIds = viewIds.filter((viewId) => viewId !== sourceViewId);
  if (otherViewIds.length === 0) return null;
  for (const viewId of otherViewIds) {
    const bounds = refs[viewId]?.getBoundingClientRect();
    if (!bounds) continue;
    if (pointerX < bounds.left + bounds.width / 2) return { viewId, placement: "before" as const };
  }
  const lastViewId = otherViewIds[otherViewIds.length - 1];
  return lastViewId ? { viewId: lastViewId, placement: "after" as const } : null;
}
