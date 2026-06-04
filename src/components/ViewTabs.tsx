import * as Popover from "@radix-ui/react-popover";
import { useMemo, useState, type DragEvent, type FormEvent } from "react";
import type { CollectionView } from "../api/client";
import { ExpandableSearch } from "./ExpandableSearch";
import { icons } from "./icons";

export type ViewTabsProps = {
  views: CollectionView[];
  activeViewId: string | null;
  dirtyViewIds: Set<string>;
  saving: boolean;
  filterBarVisible: boolean;
  hasActiveFilters: boolean;
  viewOrderDirty: boolean;
  searchQuery: string;
  onSelectView: (viewId: string) => void;
  onCreateView: () => void;
  onRenameView: (viewId: string, name: string) => void;
  onDeleteView: (viewId: string) => void;
  onDuplicateView: (viewId: string) => void;
  onReorderViews: (viewIds: string[]) => void;
  onToggleFilterBar: () => void;
  onSearchQueryChange: (query: string) => void;
};

export function ViewTabs({
  views,
  activeViewId,
  dirtyViewIds,
  saving,
  filterBarVisible,
  hasActiveFilters,
  viewOrderDirty,
  searchQuery,
  onSelectView,
  onCreateView,
  onRenameView,
  onDeleteView,
  onDuplicateView,
  onReorderViews,
  onToggleFilterBar,
  onSearchQueryChange,
}: ViewTabsProps) {
  const [draggingViewId, setDraggingViewId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ viewId: string; placement: "before" | "after" } | null>(null);
  const [openMenuViewId, setOpenMenuViewId] = useState<string | null>(null);
  const [renamingViewId, setRenamingViewId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const viewIds = useMemo(() => views.map((view) => view.id), [views]);
  const viewTabsDisabled = saving;

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
    const searchInput = document.querySelector<HTMLInputElement>(".view-tabs-search input");
    if (searchInput) {
      searchInput.focus();
    } else {
      document.querySelector<HTMLButtonElement>(".view-tabs-search .expandable-search-icon")?.click();
    }
    setOpenMenuViewId(null);
  }

  function handleDuplicate(view: CollectionView) {
    if (viewTabsDisabled) return;
    onDuplicateView(view.id);
    setOpenMenuViewId(null);
  }

  function handleDragStart(event: DragEvent<HTMLButtonElement>, viewId: string) {
    if (viewTabsDisabled) return;
    setDraggingViewId(viewId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", viewId);
  }

  function handleDragOver(event: DragEvent<HTMLButtonElement>, viewId: string) {
    if (viewTabsDisabled) return;
    if (!draggingViewId || draggingViewId === viewId) return;
    event.preventDefault();
    const sourceIndex = viewIds.indexOf(draggingViewId);
    const targetIndex = viewIds.indexOf(viewId);
    const bounds = (event.currentTarget.closest(".view-tab-shell") ?? event.currentTarget).getBoundingClientRect();
    const placement = sourceIndex > targetIndex
      ? "before"
      : sourceIndex < targetIndex
        ? "after"
        : event.clientX < bounds.left + bounds.width / 2 ? "before" : "after";
    setDropTarget({ viewId, placement });
  }

  function handleDrop(event: DragEvent<HTMLButtonElement>, viewId: string) {
    if (viewTabsDisabled) return;
    event.preventDefault();
    const sourceViewId = draggingViewId ?? event.dataTransfer.getData("text/plain");
    if (!sourceViewId || sourceViewId === viewId) {
      clearDragState();
      return;
    }
    const placement = dropTarget?.viewId === viewId ? dropTarget.placement : "after";
    const nextOrder = moveViewId(viewIds, sourceViewId, viewId, placement);
    clearDragState();
    if (nextOrder.join("\u0000") !== viewIds.join("\u0000")) onReorderViews(nextOrder);
  }

  function clearDragState() {
    setDraggingViewId(null);
    setDropTarget(null);
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
                    draggable={!viewTabsDisabled}
                    onClick={() => {
                      if (viewTabsDisabled) return;
                      if (active) {
                        setOpenMenuViewId(view.id);
                        return;
                      }
                      setOpenMenuViewId(null);
                      onSelectView(view.id);
                    }}
                    onDoubleClick={() => beginRename(view)}
                    onDragStart={(event) => handleDragStart(event, view.id)}
                    onDragOver={(event) => handleDragOver(event, view.id)}
                    onDrop={(event) => handleDrop(event, view.id)}
                    onDragEnd={clearDragState}
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
          className={hasActiveFilters ? "view-tab-action filter-toggle view-tabs-filter-toggle active" : "view-tab-action filter-toggle view-tabs-filter-toggle"}
          onClick={onToggleFilterBar}
          aria-pressed={filterBarVisible}
          disabled={viewTabsDisabled}
        >
          筛选
        </button>
        <ExpandableSearch className="view-tabs-search" value={searchQuery} onChange={onSearchQueryChange} placeholder="搜索当前视图" />
      </div>
      {viewOrderDirty ? <div className="view-order-dirty">视图顺序有未保存更改</div> : null}
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
