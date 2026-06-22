import * as Popover from "@radix-ui/react-popover";
import { useEffect, useMemo, useRef, useState, type FocusEvent as ReactFocusEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { CollectionView, SharedViewGroupItem, SharedViewIconId, SharedViewLeafItem } from "../api/client";
import { ExpandableSearch } from "./ExpandableSearch";
import {
  icons,
  readRecentSharedViewIconIds,
  sharedViewDefaultIconId,
  sharedViewIconGroups,
  sharedViewIconIds,
  sharedViewIconRegistry,
  sharedViewIconSearchAliases,
  sharedViewRecentIconStorageKey,
} from "./icons";
import { TableSettingsPopover } from "./TableSettingsPopover";

export type ViewTabsProps = {
  snapshot: ViewTabsSnapshot;
  onSelectView: (viewId: string) => void;
  onAddRow: () => void;
  onManualSave: () => void;
  onCreateTopLevelView: () => void;
  onCreateViewGroup: () => void;
  onCreateViewInGroup: (groupId: string) => void;
  onRenameGroup: (groupId: string, name: string) => void;
  onDuplicateGroup: (groupId: string) => void;
  onDeleteGroup: (groupId: string) => void;
  onRenameView: (viewId: string, name: string) => void;
  onDeleteView: (viewId: string) => void;
  onDuplicateView: (viewId: string) => void;
  onUpdateViewIcon: (viewId: string, icon: SharedViewIconId) => void;
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
    | SharedViewLeafItem
    | SharedViewGroupItem
  >;
  activeViewId: string | null;
  activeGroupId: string | null;
  expandedGroupId: string | null;
  lastActiveViewIdByGroupId: Record<string, string>;
  dirtyViewIds: Set<string>;
  commandSaving: boolean;
  manualSaveDirty: boolean;
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
  onAddRow,
  onManualSave,
  onCreateTopLevelView,
  onCreateViewGroup,
  onCreateViewInGroup,
  onRenameGroup,
  onDuplicateGroup,
  onDeleteGroup,
  onRenameView,
  onDeleteView,
  onDuplicateView,
  onUpdateViewIcon,
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
    manualSaveDirty,
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
  const [renameDraftByViewId, setRenameDraftByViewId] = useState<Record<string, string>>({});
  const [groupRenameDraftByGroupId, setGroupRenameDraftByGroupId] = useState<Record<string, string>>({});
  const [iconPickerOpenForViewId, setIconPickerOpenForViewId] = useState<string | null>(null);
  const [iconPickerSearchQuery, setIconPickerSearchQuery] = useState("");
  const [activeIconGroupId, setActiveIconGroupId] = useState<(typeof sharedViewIconGroups)[number]["id"]>("recent");
  const [recentIconIds, setRecentIconIds] = useState<SharedViewIconId[]>([]);
  const [optimisticIconByViewId, setOptimisticIconByViewId] = useState<Record<string, SharedViewIconId>>({});
  const [groupTabFilter, setGroupTabFilter] = useState("");
  const [groupRowHasOverflow, setGroupRowHasOverflow] = useState(false);
  const [dragGhost, setDragGhost] = useState<null | {
    left: number;
    top: number;
    width: number;
    height: number;
    label: string;
    icon: SharedViewIconId;
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
    icon: SharedViewIconId;
    dragging: boolean;
  }>(null);
  const suppressClickRef = useRef(false);
  const viewTabsDisabled = commandSaving;
  const expandedGroup = useMemo(
    () => topLevelItems.find((item): item is Extract<ViewTabsSnapshot["topLevelItems"][number], { kind: "group" }> => item.kind === "group" && item.id === expandedGroupId) ?? null,
    [topLevelItems, expandedGroupId],
  );
  const filteredGroupViews = useMemo(() => {
    if (!expandedGroup) return [];
    const normalizedFilter = normalizeGroupTabFilter(groupTabFilter);
    if (!normalizedFilter) return expandedGroup.views;
    return expandedGroup.views.filter((item) => item.view.id === activeViewId || normalizeGroupTabFilter(item.view.name).includes(normalizedFilter));
  }, [activeViewId, expandedGroup, groupTabFilter]);
  const visibleExpandedGroup = useMemo(
    () => (expandedGroup ? { ...expandedGroup, views: filteredGroupViews } : null),
    [expandedGroup, filteredGroupViews],
  );

  useEffect(() => {
    setGroupTabFilter("");
  }, [expandedGroupId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setRecentIconIds(readRecentSharedViewIconIds(window.localStorage) as SharedViewIconId[]);
  }, []);

  useEffect(() => {
    if (!iconPickerOpenForViewId) {
      setIconPickerSearchQuery("");
      setActiveIconGroupId("recent");
    }
  }, [iconPickerOpenForViewId]);

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
  }, [expandedGroup, filteredGroupViews, groupTabFilter]);

  function persistRecentIconIds(nextIconIds: SharedViewIconId[]) {
    setRecentIconIds(nextIconIds);
    if (typeof window === "undefined") return;
    window.localStorage.setItem(sharedViewRecentIconStorageKey, JSON.stringify(nextIconIds));
  }

  function rememberRecentIcon(iconId: SharedViewIconId) {
    const nextIconIds = [iconId, ...recentIconIds.filter((value) => value !== iconId)].slice(0, 12);
    persistRecentIconIds(nextIconIds);
  }

  function seedViewRenameDraft(viewId: string, name: string) {
    setRenameDraftByViewId((current) => current[viewId] === undefined ? { ...current, [viewId]: name } : current);
  }

  function seedGroupRenameDraft(groupId: string, name: string) {
    setGroupRenameDraftByGroupId((current) => current[groupId] === undefined ? { ...current, [groupId]: name } : current);
  }

  function resetViewRenameDraft(viewId: string, name: string) {
    setRenameDraftByViewId((current) => ({ ...current, [viewId]: name }));
  }

  function resetGroupRenameDraft(groupId: string, name: string) {
    setGroupRenameDraftByGroupId((current) => ({ ...current, [groupId]: name }));
  }

  function clearViewRenameDraft(viewId: string) {
    setRenameDraftByViewId((current) => {
      const next = { ...current };
      delete next[viewId];
      return next;
    });
  }

  function clearGroupRenameDraft(groupId: string) {
    setGroupRenameDraftByGroupId((current) => {
      const next = { ...current };
      delete next[groupId];
      return next;
    });
  }

  function commitViewRename(view: CollectionView) {
    if (viewTabsDisabled) return;
    const draft = (renameDraftByViewId[view.id] ?? view.name).trim();
    if (draft && draft !== view.name) onRenameView(view.id, draft);
  }

  function commitGroupRename(groupId: string, name: string) {
    if (viewTabsDisabled) return;
    const draft = (groupRenameDraftByGroupId[groupId] ?? name).trim();
    if (draft && draft !== name) onRenameGroup(groupId, draft);
  }

  function handleViewTitleEscape(view: CollectionView) {
    if (iconPickerOpenForViewId === view.id) {
      setIconPickerOpenForViewId(null);
      return;
    }
    resetViewRenameDraft(view.id, view.name);
    setOpenMenuViewId(null);
  }

  function handleGroupTitleEscape(groupId: string, name: string) {
    resetGroupRenameDraft(groupId, name);
    setOpenMenuGroupId(null);
  }

  function shouldSuppressBlurCommit(relatedTarget: EventTarget | null) {
    return relatedTarget instanceof HTMLElement
      && !!relatedTarget.closest(".view-tab-menu-icon-trigger, .view-tab-icon-picker-content");
  }

  function resolveViewTitleBlur(event: ReactFocusEvent<HTMLInputElement>, view: CollectionView) {
    if (shouldSuppressBlurCommit(event.relatedTarget)) return;
    commitViewRename(view);
  }

  function resolveGroupTitleBlur(event: ReactFocusEvent<HTMLInputElement>, groupId: string, name: string) {
    if (shouldSuppressBlurCommit(event.relatedTarget)) return;
    commitGroupRename(groupId, name);
  }

  function handleViewTitleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>, view: CollectionView) {
    if (event.key === "Enter") {
      event.preventDefault();
      commitViewRename(view);
      event.currentTarget.blur();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      handleViewTitleEscape(view);
    }
  }

  function handleGroupTitleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>, groupId: string, name: string) {
    if (event.key === "Enter") {
      event.preventDefault();
      commitGroupRename(groupId, name);
      event.currentTarget.blur();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      handleGroupTitleEscape(groupId, name);
    }
  }

  function resolveSearchIconIds(query: string) {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return [];
    return sharedViewIconIds.filter((iconId) => {
      if (iconId === sharedViewDefaultIconId) return false;
      if (iconId.toLowerCase().includes(normalizedQuery)) return true;
      const matchingGroup = sharedViewIconGroups.find((group) => (group.iconIds as readonly string[]).includes(iconId));
      if (matchingGroup?.label.toLowerCase().includes(normalizedQuery)) return true;
      const aliases = matchingGroup ? sharedViewIconSearchAliases[matchingGroup.id as keyof typeof sharedViewIconSearchAliases] : undefined;
      return !!aliases?.some((alias) => alias.toLowerCase().includes(normalizedQuery));
    });
  }

  function resolvePickerIconIds() {
    if (iconPickerSearchQuery.trim()) return resolveSearchIconIds(iconPickerSearchQuery);
    if (activeIconGroupId === "recent") return recentIconIds.filter((iconId) => iconId !== sharedViewDefaultIconId);
    return [...sharedViewIconGroups.find((group) => group.id === activeIconGroupId)?.iconIds ?? []] as SharedViewIconId[];
  }

  function updateViewIcon(view: CollectionView, iconId: SharedViewIconId) {
    if (viewTabsDisabled) return;
    setOptimisticIconByViewId((current) => ({ ...current, [view.id]: iconId }));
    onUpdateViewIcon(view.id, iconId);
    rememberRecentIcon(iconId);
    setIconPickerOpenForViewId(null);
  }

  function closeViewMenu(view: CollectionView) {
    commitViewRename(view);
    clearViewRenameDraft(view.id);
    setOpenMenuViewId(null);
    if (iconPickerOpenForViewId === view.id) setIconPickerOpenForViewId(null);
  }

  function closeGroupMenu(groupId: string, name: string) {
    commitGroupRename(groupId, name);
    clearGroupRenameDraft(groupId);
    setOpenMenuGroupId(null);
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

  function handlePointerDown(event: ReactPointerEvent<HTMLButtonElement>, item: SharedViewLeafItem) {
    if (viewTabsDisabled) return;
    if (event.button !== 0) return;
    const shell = dragShellRefs.current[item.view.id];
    if (!shell) return;
    const bounds = shell.getBoundingClientRect();
    pointerDragRef.current = {
      pointerId: event.pointerId,
      sourceViewId: item.view.id,
      startX: event.clientX,
      startY: event.clientY,
      pointerOffsetX: event.clientX - bounds.left,
      shellTop: bounds.top,
      shellWidth: bounds.width,
      shellHeight: bounds.height,
      label: item.view.name,
      icon: item.icon ?? "borderAll",
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
        icon: state.icon,
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
      expandedGroup: visibleExpandedGroup,
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
        expandedGroup: visibleExpandedGroup,
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

  function handleSelectGroup(groupId: string, groupViews: SharedViewLeafItem[]) {
    if (viewTabsDisabled || groupViews.length === 0) return;
    const nextViewId = lastActiveViewIdByGroupId[groupId] ?? groupViews[0]?.view.id ?? null;
    if (!nextViewId) return;
    setGroupTabFilter("");
    setOpenMenuGroupId(null);
    setOpenMenuViewId(null);
    onSelectView(nextViewId);
  }

  function renderViewTab(item: SharedViewLeafItem, location: { kind: "top-level" } | { kind: "group"; groupId: string }) {
    const view = item.view;
    const iconId = optimisticIconByViewId[view.id] ?? item.icon ?? sharedViewDefaultIconId;
    const ViewIcon = sharedViewIconRegistry[iconId];
    const pickerIconIds = resolvePickerIconIds();
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
          if (!open) closeViewMenu(view);
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
                  seedViewRenameDraft(view.id, view.name);
                  setOpenMenuViewId(view.id);
                  return;
                }
                clearViewRenameDraft(view.id);
                setOpenMenuViewId(null);
                onSelectView(view.id);
              }}
              onPointerDown={(event) => handlePointerDown(event, item)}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
            >
              <span className="view-tab-icon" data-view-icon={iconId}>
                <ViewIcon size={17} />
              </span>
              <span className="view-tab-name">{view.name}</span>
              {dirtyViewIds.has(view.id) ? <span className="view-tab-dirty-dot" aria-label="未保存的视图更改" /> : null}
            </button>
          </div>
        </Popover.Anchor>
        <Popover.Portal>
          <Popover.Content
            className="menu-content view-tab-menu-content"
            sideOffset={6}
            align="start"
            onInteractOutside={(event) => {
              const target = event.target as HTMLElement | null;
              if (target?.closest(".view-tab-menu-icon-trigger") || target?.closest(".view-tab-icon-picker-content")) {
                event.preventDefault();
              }
            }}
          >
            <div className="view-tab-menu" role="menu" aria-label={`${view.name} 视图操作`}>
              <div className="view-tab-menu-header">
                <Popover.Root
                  open={iconPickerOpenForViewId === view.id}
                  onOpenChange={(open) => setIconPickerOpenForViewId(open ? view.id : null)}
                >
                  <Popover.Trigger asChild>
                    <button
                      type="button"
                      className="view-tab-menu-icon-trigger"
                      data-view-icon-trigger="view"
                      aria-label="打开图标选择器"
                    >
                      <span className="view-tab-icon" data-view-icon={iconId}>
                        <ViewIcon size={18} />
                      </span>
                    </button>
                  </Popover.Trigger>
                  <Popover.Portal>
                    <Popover.Content className="view-tab-icon-picker-content" sideOffset={8} align="start">
                      <div className="view-tab-icon-picker-search-row">
                        <input
                          className="view-tab-icon-picker-search"
                          autoFocus
                          placeholder="筛选..."
                          value={iconPickerSearchQuery}
                          onChange={(event) => setIconPickerSearchQuery(event.target.value)}
                        />
                      </div>
                      <div className="view-tab-icon-picker-tabs" role="tablist" aria-label="图标分组">
                        {sharedViewIconGroups.map((group) => (
                          <button
                            key={group.id}
                            type="button"
                            className={["view-tab-icon-picker-tab", activeIconGroupId === group.id ? "is-active" : ""].filter(Boolean).join(" ")}
                            aria-pressed={activeIconGroupId === group.id}
                            onClick={() => setActiveIconGroupId(group.id)}
                          >
                            {group.label}
                          </button>
                        ))}
                      </div>
                      {pickerIconIds.length ? (
                        <div className="view-tab-icon-picker-grid">
                          {pickerIconIds.map((candidate) => {
                            const CandidateIcon = sharedViewIconRegistry[candidate];
                            return (
                              <button
                                key={candidate}
                                type="button"
                                className={["view-tab-icon-picker-option", candidate === iconId ? "is-selected" : ""].filter(Boolean).join(" ")}
                                data-view-icon={candidate}
                                onClick={() => updateViewIcon(view, candidate)}
                              >
                                <span className="view-tab-icon">
                                  <CandidateIcon size={18} />
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="view-tab-icon-picker-empty">未找到匹配图标</div>
                      )}
                    </Popover.Content>
                  </Popover.Portal>
                </Popover.Root>
                <input
                  className="view-tab-menu-title-input"
                  aria-label="视图名称"
                  autoFocus
                  value={renameDraftByViewId[view.id] ?? view.name}
                  onChange={(event) => setRenameDraftByViewId((current) => ({ ...current, [view.id]: event.target.value }))}
                  onKeyDown={(event) => handleViewTitleKeyDown(event, view)}
                  onBlur={(event) => resolveViewTitleBlur(event, view)}
                />
              </div>
              <button className="view-tab-menu-item" type="button" disabled role="menuitem">
                <icons.borderAll size={20} />
                <span>显示为</span>
                <icons.next size={16} className="view-tab-menu-chevron" />
              </button>
              <button className="view-tab-menu-item" type="button" onClick={handleEditView} role="menuitem">
                <icons.filter size={20} />
                <span>编辑视图</span>
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
                      if (!open) closeGroupMenu(item.id, item.name);
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
                              seedGroupRenameDraft(item.id, item.name);
                              setOpenMenuGroupId(item.id);
                              return;
                            }
                            clearGroupRenameDraft(item.id);
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
                          <div className="view-group-menu-header">
                            <button
                              type="button"
                              className="view-tab-menu-icon-trigger is-disabled"
                              aria-label="视图组图标暂不可编辑"
                              disabled
                            >
                              <span className="view-tab-icon">
                                <icons.folder size={18} />
                              </span>
                            </button>
                            <input
                              className="view-tab-menu-title-input"
                              aria-label="视图组名称"
                              autoFocus
                              value={groupRenameDraftByGroupId[item.id] ?? item.name}
                              onChange={(event) => setGroupRenameDraftByGroupId((current) => ({ ...current, [item.id]: event.target.value }))}
                              onKeyDown={(event) => handleGroupTitleKeyDown(event, item.id, item.name)}
                              onBlur={(event) => resolveGroupTitleBlur(event, item.id, item.name)}
                            />
                          </div>
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
                          <button
                            className="view-tab-menu-item"
                            type="button"
                            onClick={() => {
                              setOpenMenuGroupId(null);
                              onDuplicateGroup(item.id);
                            }}
                            role="menuitem"
                          >
                            <icons.copy size={20} />
                            <span>复制组</span>
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
              return renderViewTab(item, { kind: "top-level" });
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
              className="view-tab-action view-tabs-add-row primary"
              onClick={onAddRow}
              disabled={viewTabsDisabled}
              title="新建条目"
            >
              <icons.addField size={18} />
              <span>新建</span>
            </button>
            <button
              type="button"
              className={[
                "view-tab-action view-tabs-manual-save",
                manualSaveDirty ? "has-unsaved" : "",
              ].filter(Boolean).join(" ")}
              onClick={onManualSave}
              disabled={viewTabsDisabled}
              title="保存当前更改"
            >
              <icons.save size={18} />
              <span>保存</span>
            </button>
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
            className={[
              "view-tabs-group-row",
              groupRowHasOverflow ? "has-horizontal-scroll" : "",
            ].filter(Boolean).join(" ")}
          >
            <ExpandableSearch
              key={expandedGroup.id}
              className="group-tab-search"
              iconAriaLabel="筛选当前组标签"
              inputClassName="group-tab-search-input"
              placeholder="筛选当前组标签"
              value={groupTabFilter}
              onChange={setGroupTabFilter}
              onEscape={() => setGroupTabFilter("")}
            />
            <div
              ref={groupRowRef}
              className={[
                "view-tabs-group-tabs",
                dropTarget?.type === "group" && dropTarget.groupId === expandedGroup.id && dropTarget.placement === "append" ? "drop-append" : "",
              ].filter(Boolean).join(" ")}
              role="tablist"
            >
              {filteredGroupViews.map((item) => renderViewTab(item, { kind: "group", groupId: expandedGroup.id }))}
            </div>
            <div className="view-tabs-group-create">
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
          <span className="view-tab-icon" data-view-icon={dragGhost.icon}>
            {(() => {
              const DragGhostIcon = sharedViewIconRegistry[dragGhost.icon];
              return <DragGhostIcon size={17} />;
            })()}
          </span>
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
  const siblingViews = expandedGroup.views.filter((item) => item.view.id !== sourceViewId);
  for (const item of siblingViews) {
    const bounds = groupRefs[item.view.id]?.getBoundingClientRect();
    if (!bounds) continue;
    if (pointerX < bounds.left + bounds.width / 2) {
      return { type: "group", sourceViewId, groupId: expandedGroup.id, targetViewId: item.view.id, placement: "before" as const };
    }
    if (pointerX <= bounds.right) {
      return { type: "group", sourceViewId, groupId: expandedGroup.id, targetViewId: item.view.id, placement: "after" as const };
    }
  }
  return { type: "group", sourceViewId, groupId: expandedGroup.id, placement: "append" as const };
}

function normalizeGroupTabFilter(value: string) {
  return value.trim().toLowerCase();
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
