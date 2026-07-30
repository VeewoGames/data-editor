import * as Popover from "@radix-ui/react-popover";
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import type { SharedViewIconId } from "../api/client";
import {
  formatSharedViewIconLabel,
  hydratePersistedSharedViewIconPacks,
  icons,
  isSharedViewIconLoaded,
  isSharedViewIconPackLoaded,
  loadSharedViewIconPack,
  readLoadedSharedViewIconPackIds,
  readRecentSharedViewIconIds,
  readSharedViewIconComponent,
  readSharedViewIconIdsForPack,
  resolveSharedViewIconPackId,
  sharedViewDefaultIconId,
  sharedViewFallbackIcon,
  sharedViewFavoriteFilledIcon,
  sharedViewFavoriteOutlineIcon,
  sharedViewGeneratedIconSearchText,
  sharedViewIconGroups,
  sharedViewIconPackLabels,
  sharedViewIconSearchAliases,
  sharedViewRecentIconStorageKey,
  type SharedViewIconPackId,
  unloadSharedViewIconPack,
} from "./icons";

type SharedViewIconPickerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: SharedViewIconId;
  trigger: ReactElement;
  onSelectIcon: (iconId: SharedViewIconId) => void | Promise<void>;
  favoriteIconIds: SharedViewIconId[];
  favoritesEnabled: boolean;
  onToggleFavoriteIcon: (iconId: SharedViewIconId) => void;
  protectedIconPackIds: string[];
  align?: "start" | "center" | "end";
  sideOffset?: number;
  searchPlaceholder?: string;
};

const managedIconPackIds: SharedViewIconPackId[] = ["micro-solid", "core-solid", "tabler-filled", "micro-line", "tabler-outline", "legacy"];

export function SharedViewIconPicker({
  open,
  onOpenChange,
  value,
  trigger,
  onSelectIcon,
  favoriteIconIds,
  favoritesEnabled,
  onToggleFavoriteIcon,
  protectedIconPackIds,
  align = "start",
  sideOffset = 8,
  searchPlaceholder = "筛选...",
}: SharedViewIconPickerProps) {
  const iconId = value || sharedViewDefaultIconId;
  const [iconPickerSearchQuery, setIconPickerSearchQuery] = useState("");
  const [iconPickerGlobalSearchEnabled, setIconPickerGlobalSearchEnabled] = useState(false);
  const [activeIconGroupId, setActiveIconGroupId] = useState<(typeof sharedViewIconGroups)[number]["id"]>("recent");
  const [iconPackOptionsOpen, setIconPackOptionsOpen] = useState(false);
  const [iconPackBusyId, setIconPackBusyId] = useState<SharedViewIconPackId | null>(null);
  const [loadedIconPackIds, setLoadedIconPackIds] = useState<SharedViewIconPackId[]>(() => readLoadedSharedViewIconPackIds());
  const [, setIconPickerVersion] = useState(0);
  const [hoverPreviewIconId, setHoverPreviewIconId] = useState<SharedViewIconId | null>(null);
  const [hoverTooltip, setHoverTooltip] = useState<null | {
    iconId: SharedViewIconId;
    label: string;
    left: number;
    top: number;
  }>(null);
  const [recentIconIds, setRecentIconIds] = useState<SharedViewIconId[]>([]);
  const iconOptionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const hoverPreviewResetTimeoutRef = useRef<number | null>(null);
  const hoverTooltipDelayTimeoutRef = useRef<number | null>(null);
  const favoriteIconIdSet = useMemo(() => new Set(favoriteIconIds), [favoriteIconIds]);
  const protectedIconPackIdSet = useMemo(() => new Set(protectedIconPackIds), [protectedIconPackIds]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setRecentIconIds(readRecentSharedViewIconIds(window.localStorage) as SharedViewIconId[]);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await hydratePersistedSharedViewIconPacks();
      if (!cancelled) syncLoadedIconPacks();
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const missingProtectedPackIds = protectedIconPackIds.filter((packId) => !readLoadedSharedViewIconPackIds().includes(packId as SharedViewIconPackId));
    if (!missingProtectedPackIds.length) return;
    let cancelled = false;
    void (async () => {
      await Promise.all(
        missingProtectedPackIds.map((packId) => loadSharedViewIconPack(packId as SharedViewIconPackId)),
      );
      if (!cancelled) syncLoadedIconPacks();
    })();
    return () => {
      cancelled = true;
    };
  }, [protectedIconPackIds]);

  useEffect(() => {
    if (open) return;
    setIconPickerSearchQuery("");
    setIconPickerGlobalSearchEnabled(false);
    setActiveIconGroupId("recent");
    setIconPackOptionsOpen(false);
    setHoverPreviewIconId(null);
    setHoverTooltip(null);
  }, [open]);

  useEffect(() => () => {
    if (hoverPreviewResetTimeoutRef.current !== null && typeof window !== "undefined") {
      window.clearTimeout(hoverPreviewResetTimeoutRef.current);
    }
    if (hoverTooltipDelayTimeoutRef.current !== null && typeof window !== "undefined") {
      window.clearTimeout(hoverTooltipDelayTimeoutRef.current);
    }
  }, []);

  function syncLoadedIconPacks() {
    setLoadedIconPackIds(readLoadedSharedViewIconPackIds());
    setIconPickerVersion((current) => current + 1);
  }

  function persistRecentIconIds(nextIconIds: SharedViewIconId[]) {
    setRecentIconIds(nextIconIds);
    if (typeof window === "undefined") return;
    window.localStorage.setItem(sharedViewRecentIconStorageKey, JSON.stringify(nextIconIds));
  }

  function rememberRecentIcon(nextIconId: SharedViewIconId) {
    const nextIconIds = [nextIconId, ...recentIconIds.filter((current) => current !== nextIconId)].slice(0, 12);
    persistRecentIconIds(nextIconIds);
  }

  function resolveSearchIconIds(query: string, searchPool: readonly SharedViewIconId[]) {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return [];
    return searchPool.filter((candidateIconId) => {
      if (candidateIconId === sharedViewDefaultIconId) return false;
      if (candidateIconId.toLowerCase().includes(normalizedQuery)) return true;
      if (sharedViewGeneratedIconSearchText[candidateIconId]?.includes(normalizedQuery)) return true;
      const matchingGroup = sharedViewIconGroups.find((group) => group.id === resolveSharedViewIconPackId(candidateIconId));
      if (matchingGroup?.label.toLowerCase().includes(normalizedQuery)) return true;
      const aliases = matchingGroup ? sharedViewIconSearchAliases[matchingGroup.id as keyof typeof sharedViewIconSearchAliases] : undefined;
      return !!aliases?.some((alias) => alias.toLowerCase().includes(normalizedQuery));
    });
  }

  function resolveActiveGroupIconIds() {
    if (activeIconGroupId === "recent") return recentIconIds.filter((candidateIconId) => candidateIconId !== sharedViewDefaultIconId);
    if (activeIconGroupId === "favorites") return [...favoriteIconIdSet] as SharedViewIconId[];
    if (!isSharedViewIconPackLoaded(activeIconGroupId)) return [];
    return readSharedViewIconIdsForPack(activeIconGroupId) as SharedViewIconId[];
  }

  const pickerIconIds = useMemo(() => {
    const activeGroupIconIds = resolveActiveGroupIconIds();
    if (iconPickerSearchQuery.trim()) {
      const searchableIconIds = Array.from(new Set([
        ...recentIconIds,
        ...favoriteIconIds,
        ...readSharedViewIconIdsForPack("legacy"),
        ...managedIconPackIds.flatMap((packId) => (
          packId === "legacy" || !loadedIconPackIds.includes(packId)
            ? []
            : readSharedViewIconIdsForPack(packId)
        )),
      ])) as SharedViewIconId[];
      return resolveSearchIconIds(
        iconPickerSearchQuery,
        iconPickerGlobalSearchEnabled ? searchableIconIds : activeGroupIconIds,
      );
    }
    return activeGroupIconIds;
  }, [activeIconGroupId, favoriteIconIdSet, favoriteIconIds, iconPickerGlobalSearchEnabled, iconPickerSearchQuery, loadedIconPackIds, recentIconIds]);

  function showHoverPreview(nextIconId: SharedViewIconId) {
    if (hoverPreviewResetTimeoutRef.current !== null && typeof window !== "undefined") {
      window.clearTimeout(hoverPreviewResetTimeoutRef.current);
      hoverPreviewResetTimeoutRef.current = null;
    }
    setHoverPreviewIconId(nextIconId);
    if (typeof window === "undefined") return;
    if (hoverTooltipDelayTimeoutRef.current !== null) {
      window.clearTimeout(hoverTooltipDelayTimeoutRef.current);
    }
    setHoverTooltip((current) => current?.iconId === nextIconId ? current : null);
    hoverTooltipDelayTimeoutRef.current = window.setTimeout(() => {
      hoverTooltipDelayTimeoutRef.current = null;
      const optionNode = iconOptionRefs.current[nextIconId];
      if (!optionNode) return;
      const bounds = optionNode.getBoundingClientRect();
      setHoverTooltip({
        iconId: nextIconId,
        label: formatSharedViewIconLabel(nextIconId),
        left: bounds.left + bounds.width / 2,
        top: Math.max(12, bounds.top - 10),
      });
    }, 500);
  }

  function hideHoverPreview(nextIconId: SharedViewIconId) {
    if (hoverTooltipDelayTimeoutRef.current !== null && typeof window !== "undefined") {
      window.clearTimeout(hoverTooltipDelayTimeoutRef.current);
      hoverTooltipDelayTimeoutRef.current = null;
    }
    setHoverTooltip((current) => current?.iconId === nextIconId ? null : current);
    if (typeof window === "undefined") {
      setHoverPreviewIconId((current) => current === nextIconId ? null : current);
      return;
    }
    if (hoverPreviewResetTimeoutRef.current !== null) {
      window.clearTimeout(hoverPreviewResetTimeoutRef.current);
    }
    hoverPreviewResetTimeoutRef.current = window.setTimeout(() => {
      setHoverPreviewIconId((current) => current === nextIconId ? null : current);
      hoverPreviewResetTimeoutRef.current = null;
    }, 180);
  }

  function resolveManagedPackSummary(packId: SharedViewIconPackId) {
    const loaded = loadedIconPackIds.includes(packId);
    const unloadProtected = loaded && protectedIconPackIdSet.has(packId);
    if (unloadProtected) {
      return {
        loaded,
        unloadProtected,
        detail: `当前配置正在使用，暂不可卸载 · ${readSharedViewIconIdsForPack(packId).length} 个图标`,
      };
    }
    if (loaded) {
      return {
        loaded,
        unloadProtected,
        detail: `已加载，可卸载 · ${readSharedViewIconIdsForPack(packId).length} 个图标`,
      };
    }
    return {
      loaded,
      unloadProtected,
      detail: "未加载，加载后才会浏览和搜索该图标包",
    };
  }

  async function ensureIconPackLoaded(nextIconId: SharedViewIconId) {
    const packId = resolveSharedViewIconPackId(nextIconId);
    if (isSharedViewIconLoaded(nextIconId)) return;
    setIconPackBusyId(packId);
    try {
      await loadSharedViewIconPack(packId);
      syncLoadedIconPacks();
    } finally {
      setIconPackBusyId((current) => current === packId ? null : current);
    }
  }

  async function handleSelectIcon(nextIconId: SharedViewIconId) {
    await ensureIconPackLoaded(nextIconId);
    await onSelectIcon(nextIconId);
    rememberRecentIcon(nextIconId);
    onOpenChange(false);
  }

  async function handleToggleIconPack(packId: SharedViewIconPackId) {
    setIconPackBusyId(packId);
    try {
      if (loadedIconPackIds.includes(packId)) {
        unloadSharedViewIconPack(packId);
      } else {
        await loadSharedViewIconPack(packId);
      }
      syncLoadedIconPacks();
    } finally {
      setIconPackBusyId((current) => current === packId ? null : current);
    }
  }

  function renderSharedViewIcon(nextIconId: SharedViewIconId, size: number) {
    const IconComponent = readSharedViewIconComponent(nextIconId) ?? sharedViewFallbackIcon;
    return <IconComponent size={size} />;
  }

  const activePackLabel = activeIconGroupId in sharedViewIconPackLabels
    ? sharedViewIconPackLabels[activeIconGroupId as keyof typeof sharedViewIconPackLabels]
    : null;
  const showPackLoadEmptyState = iconPickerSearchQuery.trim().length === 0
    && activeIconGroupId !== "recent"
    && activeIconGroupId !== "favorites"
    && !loadedIconPackIds.includes(activeIconGroupId);

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        {trigger}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="view-tab-icon-picker-content" sideOffset={sideOffset} align={align}>
          <div className="view-tab-icon-picker-search-row">
            <input
              className="view-tab-icon-picker-search"
              autoFocus
              placeholder={searchPlaceholder}
              value={iconPickerSearchQuery}
              onChange={(event) => setIconPickerSearchQuery(event.target.value)}
            />
            <label className="view-tab-icon-picker-search-scope">
              <input
                type="checkbox"
                aria-label="全局搜索图标"
                checked={iconPickerGlobalSearchEnabled}
                onChange={(event) => setIconPickerGlobalSearchEnabled(event.target.checked)}
              />
              <span>全局</span>
            </label>
            <Popover.Root open={iconPackOptionsOpen} onOpenChange={setIconPackOptionsOpen}>
              <Popover.Trigger asChild>
                <button
                  type="button"
                  className="view-tab-icon-picker-options-trigger"
                  aria-label="图标包选项"
                >
                  <icons.settings size={16} />
                </button>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content className="view-tab-icon-pack-options" sideOffset={6} align="end">
                  <div className="view-tab-icon-pack-options-title">图标包</div>
                  {managedIconPackIds.map((packId) => {
                    const summary = resolveManagedPackSummary(packId);
                    return (
                      <div key={packId} className="view-tab-icon-pack-row">
                        <span className="view-tab-icon-pack-copy">
                          <span className="view-tab-icon-pack-name">{sharedViewIconPackLabels[packId]}</span>
                          <span className="view-tab-icon-pack-detail">{summary.detail}</span>
                        </span>
                        <button
                          type="button"
                          className="view-tab-icon-pack-toggle"
                          disabled={iconPackBusyId === packId || summary.unloadProtected}
                          onClick={() => void handleToggleIconPack(packId)}
                        >
                          {iconPackBusyId === packId ? "处理中..." : summary.loaded ? (summary.unloadProtected ? "已使用" : "卸载") : "加载"}
                        </button>
                      </div>
                    );
                  })}
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
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
          {showPackLoadEmptyState ? (
            <div className="view-tab-icon-picker-empty">
              <div>{activePackLabel} 未加载</div>
              <button
                type="button"
                className="view-tab-icon-pack-toggle"
                onClick={() => void handleToggleIconPack(activeIconGroupId as SharedViewIconPackId)}
              >
                加载 {activePackLabel}
              </button>
            </div>
          ) : pickerIconIds.length ? (
            <div
              className="view-tab-icon-picker-grid"
              onWheelCapture={(event) => event.stopPropagation()}
            >
              {pickerIconIds.map((candidateIconId) => {
                const candidateLoaded = isSharedViewIconLoaded(candidateIconId);
                const candidateFavorite = favoriteIconIdSet.has(candidateIconId);
                const candidatePackId = resolveSharedViewIconPackId(candidateIconId);
                const FavoriteIcon = candidateFavorite ? sharedViewFavoriteFilledIcon : sharedViewFavoriteOutlineIcon;
                return (
                  <div
                    key={candidateIconId}
                    ref={(node) => {
                      iconOptionRefs.current[candidateIconId] = node;
                    }}
                    className={[
                      "view-tab-icon-picker-option",
                      candidateIconId === iconId ? "is-selected" : "",
                      candidateLoaded ? "" : "is-unloaded",
                      candidateFavorite ? "is-favorite" : "",
                      hoverPreviewIconId === candidateIconId ? "is-hover-preview" : "",
                    ].filter(Boolean).join(" ")}
                    data-view-icon={candidateIconId}
                    onPointerEnter={() => showHoverPreview(candidateIconId)}
                    onPointerLeave={() => hideHoverPreview(candidateIconId)}
                  >
                    <button
                      type="button"
                      className="view-tab-icon-picker-option-main"
                      onClick={() => void handleSelectIcon(candidateIconId)}
                    >
                      <span className="view-tab-icon">
                        {renderSharedViewIcon(candidateIconId, 18)}
                      </span>
                      {!candidateLoaded ? <span className="view-tab-icon-picker-option-hint">需先加载 {sharedViewIconPackLabels[candidatePackId]}</span> : null}
                    </button>
                    <span className="view-tab-icon-picker-option-star-shell">
                      <button
                        type="button"
                        className="view-tab-icon-picker-option-star"
                        aria-label={candidateFavorite ? "取消收藏图标" : "收藏图标"}
                        disabled={!favoritesEnabled}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          onToggleFavoriteIcon(candidateIconId);
                        }}
                      >
                        <FavoriteIcon size={14} />
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="view-tab-icon-picker-empty">未找到匹配图标</div>
          )}
          {hoverTooltip ? (
            <div
              className="view-tab-icon-picker-tooltip"
              style={{
                left: `${hoverTooltip.left}px`,
                top: `${hoverTooltip.top}px`,
              }}
            >
              {hoverTooltip.label}
            </div>
          ) : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
