import * as Popover from "@radix-ui/react-popover";
import { useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { CollectionView } from "../api/client";
import { icons } from "./icons";
import { TableSettingsPopover } from "./TableSettingsPopover";

export type ViewTabsProps = {
  snapshot: ViewTabsSnapshot;
  onSelectView: (viewId: string) => void;
  onCreateTopLevelView: () => void;
  onCreateViewGroup: () => void;
  onCreateViewInGroup: (groupId: string) => void;
  onRenameGroup: (groupId: string, name: string) => void;
  onDeleteGroup: (groupId: string) => void;
  onRenameView: (viewId: string, name: string) => void;
  onDeleteView: (viewId: string) => void;
  onDuplicateView: (viewId: string) => void;
  onReorderViews: (operation: ViewTabReorderOperation) => void;
  onToggleFilterBar: () => void;
  onToggleTableTextEditMode: () => void;
  onToggleRowDeleteControls: () => void;
  onSetDocumentFieldEnabled: (fieldName: string, enabled: boolean) => void;
  onSaveDocumentRoot: (value: string) => void;
  onRefreshDocumentIndex: () => void;
};

export type ViewTabsSnapshot = {
  views: CollectionView[];
  topLevelItems: Array<
    | { kind: "view"; view: CollectionView }
    | { kind: "group"; id: string; name: string; views: CollectionView[] }
  >;
  activeViewId: string | null;
  activeGroupId: string | null;
  expandedGroupId: string | null;
  lastActiveViewIdByGroupId: Record<string, string>;
  dirtyViewIds: Set<string>;
  commandSaving: boolean;
  filterBarVisible: boolean;
  hasActiveFilters: boolean;
  tableTextEditMode: boolean;
  rowDeleteControlsVisible: boolean;
  viewOrderDirty: boolean;
  selectedFilePath: string | null;
  documentRoot: string;
  documentFields: Array<{ fieldName: string; enabled: boolean }>;
  documentResolvedCount: number;
  documentConflictCount: number;
  documentIndexError: string | null;
};

export type ViewTabReorderOperation =
  | { type: "top-level"; sourceViewId: string; targetItemId: string; placement: "before" | "after" }
  | { type: "group"; sourceViewId: string; groupId: string; placement: "before" | "after"; targetViewId: string }
  | { type: "group"; sourceViewId: string; groupId: string; placement: "append" };

export function ViewTabs({
  snapshot,
  onSelectView,
  onCreateTopLevelView,
  onCreateViewGroup,
  onCreateViewInGroup,
  onRenameGroup,
  onDeleteGroup,
  onRenameView,
  onDeleteView,
  onDuplicateView,
  onReorderViews,
  onToggleFilterBar,
  onToggleTableTextEditMode,
  onToggleRowDeleteControls,
  onSetDocumentFieldEnabled,
  onSaveDocumentRoot,
  onRefreshDocumentIndex,
}: ViewTabsProps) {
  const {
    views,
    topLevelItems,
    activeViewId,
    activeGroupId,
    expandedGroupId,
    lastActiveViewIdByGroupId,
    dirtyViewIds,
    commandSaving,
    filterBarVisible,
    hasActiveFilters,
    tableTextEditMode,
    rowDeleteControlsVisible,
    viewOrderDirty,
    selectedFilePath,
    documentRoot,
    documentFields,
    documentResolvedCount,
    documentConflictCount,
    documentIndexError,
  } = snapshot;
  const [draggingViewId, setDraggingViewId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<ViewTabReorderOperation | null>(null);
  const [openMenuViewId, setOpenMenuViewId] = useState<string | null>(null);
  const [openMenuGroupId, setOpenMenuGroupId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [renamingViewId, setRenamingViewId] = useState<string | null>(null);
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [groupRowHasOverflow, setGroupRowHasOverflow] = useState(false);
  const [dragGhost, setDragGhost] = useState<null | {
    left: number;
    top: number;
    width: number;
    height: number;
    label: string;
  }>(null);
  const dragShellRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const topLevelItemRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const groupViewRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const topLevelRowRef = useRef<HTMLDivElement | null>(null);
  const groupRowRef = useRef<HTMLDivElement | null>(null);
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
  const viewTabsDisabled = commandSaving;
  const expandedGroup = useMemo(
    () => topLevelItems.find((item): item is Extract<ViewTabsSnapshot["topLevelItems"][number], { kind: "group" }> => item.kind === "group" && item.id === expandedGroupId) ?? null,
    [topLevelItems, expandedGroupId],
  );

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

  useEffect(() => {
    const node = groupRowRef.current;
    if (!node || !expandedGroup) {
      setGroupRowHasOverflow(false);
      return;
    }
    const updateOverflowState = () => {
      setGroupRowHasOverflow(node.scrollWidth > node.clientWidth + 1);
    };
    updateOverflowState();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => updateOverflowState());
    observer.observe(node);
    for (const child of Array.from(node.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [expandedGroup]);

  function beginRename(view: CollectionView) {
    if (viewTabsDisabled) return;
    setOpenMenuViewId(view.id);
    setRenamingViewId(view.id);
    setRenamingGroupId(null);
    setRenameDraft(view.name);
  }

  function beginRenameGroup(groupId: string, name: string) {
    if (viewTabsDisabled) return;
    setOpenMenuGroupId(groupId);
    setRenamingGroupId(groupId);
    setRenamingViewId(null);
    setRenameDraft(name);
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
    setRenamingGroupId(null);
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

  function handleDeleteGroup(groupId: string, name: string) {
    if (viewTabsDisabled) return;
    if (!window.confirm(`删除视图组“${name}”？组内视图会提升到顶层。`)) return;
    onDeleteGroup(groupId);
    setOpenMenuGroupId(null);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLButtonElement>, view: CollectionView) {
    if (viewTabsDisabled) return;
    if (event.button !== 0) return;
    const shell = dragShellRefs.current[view.id];
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
    setDropTarget(resolveDropTarget({
      topLevelItems,
      expandedGroup,
      sourceViewId: state.sourceViewId,
      pointerX: event.clientX,
      pointerY: event.clientY,
      topLevelRow: topLevelRowRef.current,
      topLevelRefs: topLevelItemRefs.current,
      groupRow: groupRowRef.current,
      groupRefs: groupViewRefs.current,
    }));
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    const state = pointerDragRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    if (state.dragging) {
      const target = resolveDropTarget({
        topLevelItems,
        expandedGroup,
        sourceViewId: state.sourceViewId,
        pointerX: event.clientX,
        pointerY: event.clientY,
        topLevelRow: topLevelRowRef.current,
        topLevelRefs: topLevelItemRefs.current,
        groupRow: groupRowRef.current,
        groupRefs: groupViewRefs.current,
      });
      if (target) onReorderViews(target);
    }
    clearDragState();
  }

  function clearDragState() {
    pointerDragRef.current = null;
    setDraggingViewId(null);
    setDropTarget(null);
    setDragGhost(null);
  }

  function handleSelectGroup(groupId: string, groupViews: CollectionView[]) {
    if (viewTabsDisabled || groupViews.length === 0) return;
    const nextViewId = lastActiveViewIdByGroupId[groupId] ?? groupViews[0]?.id ?? null;
    if (!nextViewId) return;
    setOpenMenuGroupId(null);
    setOpenMenuViewId(null);
    onSelectView(nextViewId);
  }

  function renderViewTab(view: CollectionView, location: { kind: "top-level" } | { kind: "group"; groupId: string }) {
    const active = view.id === activeViewId;
    const dropBefore = location.kind === "top-level"
      ? dropTarget?.type === "top-level" && dropTarget.targetItemId === view.id && dropTarget.placement === "before"
      : dropTarget?.type === "group" && dropTarget.groupId === location.groupId && dropTarget.placement === "before" && dropTarget.targetViewId === view.id;
    const dropAfter = location.kind === "top-level"
      ? dropTarget?.type === "top-level" && dropTarget.targetItemId === view.id && dropTarget.placement === "after"
      : dropTarget?.type === "group" && dropTarget.groupId === location.groupId && dropTarget.placement === "after" && dropTarget.targetViewId === view.id;
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
            ref={(node) => {
              dragShellRefs.current[view.id] = node;
              if (location.kind === "top-level") {
                topLevelItemRefs.current[view.id] = node;
                delete groupViewRefs.current[view.id];
              } else {
                groupViewRefs.current[view.id] = node;
                delete topLevelItemRefs.current[view.id];
              }
            }}
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
  }

  return (
    <div className="view-tabs" aria-label="视图">
      <div className="view-tabs-main">
        <div className="view-tabs-primary-row">
          <div ref={topLevelRowRef} className="view-tabs-top-level" role="tablist">
            {topLevelItems.map((item) => {
              if (item.kind === "group") {
                const active = activeGroupId === item.id;
                const expanded = expandedGroupId === item.id;
                const dropBefore = dropTarget?.type === "top-level" && dropTarget.targetItemId === item.id && dropTarget.placement === "before";
                const dropAfter = dropTarget?.type === "top-level" && dropTarget.targetItemId === item.id && dropTarget.placement === "after";
                const dropInto = dropTarget?.type === "group" && dropTarget.groupId === item.id;
                return (
                  <Popover.Root
                    key={item.id}
                    open={openMenuGroupId === item.id}
                    onOpenChange={(open) => {
                      if (!open) setOpenMenuGroupId(null);
                    }}
                  >
                    <Popover.Anchor asChild>
                      <div
                        ref={(node) => { topLevelItemRefs.current[item.id] = node; }}
                        className={[
                          "view-tab-shell",
                          "view-tab-group-shell",
                          active ? "active" : "",
                          expanded ? "expanded" : "",
                          dropBefore ? "drop-before" : "",
                          dropAfter ? "drop-after" : "",
                          dropInto ? "drop-into" : "",
                        ].filter(Boolean).join(" ")}
                      >
                        <button
                          type="button"
                          className="view-tab view-tab-group"
                          role="tab"
                          aria-selected={active}
                          disabled={viewTabsDisabled}
                          onClick={() => {
                            if (viewTabsDisabled) return;
                            if (active) {
                              setOpenMenuGroupId(item.id);
                              return;
                            }
                            handleSelectGroup(item.id, item.views);
                          }}
                        >
                          <icons.folder size={17} />
                          <span className="view-tab-name">{item.name}</span>
                        </button>
                      </div>
                    </Popover.Anchor>
                    <Popover.Portal>
                      <Popover.Content className="menu-content view-tab-menu-content" sideOffset={6} align="start">
                        <div className="view-tab-menu" role="menu" aria-label={`${item.name} 视图组操作`}>
                          {renamingGroupId === item.id ? (
                            <form
                              className="view-tab-rename-form"
                              onSubmit={(event) => {
                                event.preventDefault();
                                if (viewTabsDisabled) return;
                                const trimmed = renameDraft.trim();
                                if (trimmed && trimmed !== item.name) onRenameGroup(item.id, trimmed);
                                setRenamingGroupId(null);
                                setRenameDraft("");
                                setOpenMenuGroupId(null);
                              }}
                            >
                              <input
                                aria-label="视图组名称"
                                autoFocus
                                value={renameDraft}
                                onChange={(event) => setRenameDraft(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === "Escape") cancelRename();
                                }}
                              />
                              <button type="submit" disabled={!renameDraft.trim() || renameDraft.trim() === item.name}>保存</button>
                              <button type="button" onClick={cancelRename}>取消</button>
                            </form>
                          ) : (
                            <button className="view-tab-menu-item" type="button" onClick={() => beginRenameGroup(item.id, item.name)} role="menuitem">
                              <icons.textField size={20} />
                              <span>重命名组</span>
                            </button>
                          )}
                          <button
                            className="view-tab-menu-item"
                            type="button"
                            onClick={() => {
                              setOpenMenuGroupId(null);
                              onCreateViewInGroup(item.id);
                            }}
                            role="menuitem"
                          >
                            <icons.addField size={20} />
                            <span>在组内创建视图</span>
                          </button>
                          <div className="view-tab-menu-separator" />
                          <button className="view-tab-menu-item danger" type="button" onClick={() => handleDeleteGroup(item.id, item.name)} role="menuitem">
                            <icons.delete size={20} />
                            <span>删除组</span>
                          </button>
                        </div>
                      </Popover.Content>
                    </Popover.Portal>
                  </Popover.Root>
                );
              }
              return renderViewTab(item.view, { kind: "top-level" });
            })}
            <Popover.Root open={createMenuOpen} onOpenChange={setCreateMenuOpen}>
              <Popover.Trigger asChild>
                <button
                  type="button"
                  className="view-tab-create view-tab-create-top-level"
                  disabled={viewTabsDisabled}
                  aria-label="创建顶层视图或视图组"
                >
                  +
                </button>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content className="menu-content view-tab-create-menu" sideOffset={6} align="start">
                  <div className="view-tab-menu" role="menu" aria-label="创建视图">
                    <button
                      className="view-tab-menu-item"
                      type="button"
                      onClick={() => {
                        setCreateMenuOpen(false);
                        onCreateTopLevelView();
                      }}
                      role="menuitem"
                    >
                      <icons.table size={20} />
                      <span>创建视图</span>
                    </button>
                    <button
                      className="view-tab-menu-item"
                      type="button"
                      onClick={() => {
                        setCreateMenuOpen(false);
                        onCreateViewGroup();
                      }}
                      role="menuitem"
                    >
                      <icons.folder size={20} />
                      <span>创建视图组</span>
                    </button>
                  </div>
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
          </div>
          <div className="view-tabs-actions">
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
            <Popover.Root open={settingsOpen} onOpenChange={setSettingsOpen}>
              <Popover.Trigger asChild>
                <button
                  type="button"
                  className={[
                    "view-tab-action row-delete-toggle view-tabs-row-delete-toggle",
                    settingsOpen ? "active" : "",
                  ].filter(Boolean).join(" ")}
                  aria-expanded={settingsOpen}
                  disabled={viewTabsDisabled}
                  title="调整显示选项"
                >
                  <icons.adjust size={18} />
                  <span>调整</span>
                </button>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content align="end" className="table-settings-popover-shell" sideOffset={6}>
                  <TableSettingsPopover
                    conflictCount={documentConflictCount}
                    documentFields={documentFields}
                    documentRoot={documentRoot}
                    indexError={documentIndexError}
                    onRefreshDocumentIndex={onRefreshDocumentIndex}
                    onSaveDocumentRoot={onSaveDocumentRoot}
                    onSetDocumentFieldEnabled={onSetDocumentFieldEnabled}
                    onToggleRowDeleteControls={onToggleRowDeleteControls}
                    resolvedCount={documentResolvedCount}
                    rowDeleteControlsVisible={rowDeleteControlsVisible}
                    selectedFilePath={selectedFilePath}
                  />
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
          </div>
        </div>
        {expandedGroup ? (
          <div
            ref={groupRowRef}
            className={[
              "view-tabs-group-row",
              groupRowHasOverflow ? "has-horizontal-scroll" : "",
              dropTarget?.type === "group" && dropTarget.groupId === expandedGroup.id && dropTarget.placement === "append" ? "drop-append" : "",
            ].filter(Boolean).join(" ")}
            role="tablist"
          >
            {expandedGroup.views.map((view) => renderViewTab(view, { kind: "group", groupId: expandedGroup.id }))}
            <button
              type="button"
              className="view-tab-create view-tab-create-in-group"
              disabled={viewTabsDisabled}
              onClick={() => onCreateViewInGroup(expandedGroup.id)}
              aria-label="在当前组内创建视图"
            >
              +
            </button>
          </div>
        ) : null}
      </div>
      {viewOrderDirty ? <div className="view-order-dirty">视图顺序有未保存更改</div> : null}
      {topLevelItems.length && (expandedGroupId || activeGroupId) ? (
        <div className="view-tabs-group-state" hidden>
          {expandedGroupId}:{activeGroupId}
        </div>
      ) : null}
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

function resolveDropTarget({
  topLevelItems,
  expandedGroup,
  sourceViewId,
  pointerX,
  pointerY,
  topLevelRow,
  topLevelRefs,
  groupRow,
  groupRefs,
}: {
  topLevelItems: ViewTabsSnapshot["topLevelItems"];
  expandedGroup: Extract<ViewTabsSnapshot["topLevelItems"][number], { kind: "group" }> | null;
  sourceViewId: string;
  pointerX: number;
  pointerY: number;
  topLevelRow: HTMLDivElement | null;
  topLevelRefs: Record<string, HTMLDivElement | null>;
  groupRow: HTMLDivElement | null;
  groupRefs: Record<string, HTMLDivElement | null>;
}) {
  const groupTarget = resolveGroupDropTarget(expandedGroup, sourceViewId, pointerX, pointerY, groupRow, groupRefs);
  if (groupTarget) return groupTarget;
  return resolveTopLevelDropTarget(topLevelItems, sourceViewId, pointerX, pointerY, topLevelRow, topLevelRefs);
}

function resolveGroupDropTarget(
  expandedGroup: Extract<ViewTabsSnapshot["topLevelItems"][number], { kind: "group" }> | null,
  sourceViewId: string,
  pointerX: number,
  pointerY: number,
  groupRow: HTMLDivElement | null,
  groupRefs: Record<string, HTMLDivElement | null>,
): ViewTabReorderOperation | null {
  if (!expandedGroup || !groupRow) return null;
  const rowBounds = groupRow.getBoundingClientRect();
  if (pointerY < rowBounds.top || pointerY > rowBounds.bottom) return null;
  const siblingViews = expandedGroup.views.filter((view) => view.id !== sourceViewId);
  for (const view of siblingViews) {
    const bounds = groupRefs[view.id]?.getBoundingClientRect();
    if (!bounds) continue;
    if (pointerX < bounds.left + bounds.width / 2) {
      return { type: "group", sourceViewId, groupId: expandedGroup.id, targetViewId: view.id, placement: "before" as const };
    }
    if (pointerX <= bounds.right) {
      return { type: "group", sourceViewId, groupId: expandedGroup.id, targetViewId: view.id, placement: "after" as const };
    }
  }
  return { type: "group", sourceViewId, groupId: expandedGroup.id, placement: "append" as const };
}

function resolveTopLevelDropTarget(
  topLevelItems: ViewTabsSnapshot["topLevelItems"],
  sourceViewId: string,
  pointerX: number,
  pointerY: number,
  topLevelRow: HTMLDivElement | null,
  topLevelRefs: Record<string, HTMLDivElement | null>,
): ViewTabReorderOperation | null {
  if (!topLevelRow) return null;
  const rowBounds = topLevelRow.getBoundingClientRect();
  if (pointerY < rowBounds.top || pointerY > rowBounds.bottom) return null;
  const candidateItems = topLevelItems.filter((item) => item.kind === "group" || item.view.id !== sourceViewId);
  for (const item of candidateItems) {
    const itemId = item.kind === "group" ? item.id : item.view.id;
    const bounds = topLevelRefs[itemId]?.getBoundingClientRect();
    if (!bounds) continue;
    if (item.kind === "group") {
      const leftThreshold = bounds.left + bounds.width * 0.25;
      const rightThreshold = bounds.right - bounds.width * 0.25;
      if (pointerX >= leftThreshold && pointerX <= rightThreshold) {
        return { type: "group", sourceViewId, groupId: item.id, placement: "append" as const };
      }
    }
    if (pointerX < bounds.left + bounds.width / 2) {
      return { type: "top-level", sourceViewId, targetItemId: itemId, placement: "before" as const };
    }
    if (pointerX <= bounds.right) {
      return { type: "top-level", sourceViewId, targetItemId: itemId, placement: "after" as const };
    }
  }
  const lastItem = candidateItems.at(-1);
  if (!lastItem) return null;
  return {
    type: "top-level",
    sourceViewId,
    targetItemId: lastItem.kind === "group" ? lastItem.id : lastItem.view.id,
    placement: "after" as const,
  };
}
