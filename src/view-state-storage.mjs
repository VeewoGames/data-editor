import {
  emptySharedViewDraftState,
  normalizeSharedViewDraftState,
} from "./view/shared-view-normalize.mjs";
import { buildSidebarTreePreferences } from "./sidebar-tree.mjs";

export function emptyCollectionViewState() {
  return {
    hidden: [],
    wrapped: [],
    order: [],
    detailOrder: [],
    widths: {},
  };
}

export const emptyViewLayoutState = emptyCollectionViewState;

export function emptyLocalViewState() {
  return {
    ...emptyCollectionViewState(),
    sidebarWidth: null,
    detailPanelWidth: null,
    detailDocumentPanelOpen: null,
    detailDocumentPanelWidth: null,
  };
}

export function collectionConfigKey(path, collectionPath) {
  return `${path}:${collectionPath}`;
}

function normalizeViewId(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function encodeViewId(viewId) {
  return encodeURIComponent(normalizeViewId(viewId));
}

function viewStoragePrefix(path, collectionPath, viewId) {
  return `data-editor:${path}:${collectionPath}:${encodeViewId(viewId)}:`;
}

function viewFieldStorageKey(path, collectionPath, viewId, fieldName, suffix) {
  return `${viewStoragePrefix(path, collectionPath, viewId)}${fieldName}:${suffix}`;
}

function viewOrderStorageKey(path, collectionPath, viewId) {
  return `${viewStoragePrefix(path, collectionPath, viewId)}__order`;
}

function collectionDetailOrderStorageKey(path, collectionPath) {
  return `data-editor:${path}:${collectionPath}:__detail-order`;
}

const sidebarWidthStorageKey = "data-editor:sidebar-width";
const detailPanelWidthStorageKey = "data-editor:detail-panel-width";
const detailDocumentPanelOpenStorageKey = "data-editor:detail-document-panel-open";
const detailDocumentPanelWidthStorageKey = "data-editor:detail-document-panel-width";
const fileOrderStorageKey = "data-editor:__file-order";
const sidebarTreePrefsStorageKey = "data-editor:__sidebar-tree-prefs";
const sharedViewDraftsStorageKey = "data-editor:shared-view-drafts";

export function cloneCollectionViewState(state) {
  const next = {
    hidden: [...(state?.hidden ?? [])],
    wrapped: [...(state?.wrapped ?? [])],
    order: [...(state?.order ?? [])],
    detailOrder: [...(state?.detailOrder ?? [])],
    widths: { ...(state?.widths ?? {}) },
  };
  const overrides = normalizeLayoutOverrides(state?.overrides);
  if (Object.keys(overrides).length) next.overrides = overrides;
  return next;
}

export const cloneViewLayoutState = cloneCollectionViewState;

export function readCollectionViewState({ mode, path, collectionPath, viewId, localState, profile }) {
  return readViewLayoutState({ mode, path, collectionPath, viewId, localState, profile });
}

export function readViewLayoutState({ mode, path, collectionPath, viewId, localState, profile }) {
  if (mode === "profile" && profile) {
    const collectionKey = collectionConfigKey(path, collectionPath);
    const normalizedViewId = normalizeViewId(viewId);
    const collectionLayouts = profile.viewLayouts?.[collectionKey] ?? null;
    const activeLayout = normalizedViewId
      ? collectionLayouts?.[normalizedViewId]
      : null;
    const baseLayout = normalizedViewId && normalizedViewId !== "all"
      ? collectionLayouts?.all
      : null;
    const layout = mergeCollectionViewState(
      baseLayout ?? profile.collections?.[collectionKey] ?? emptyCollectionViewState(),
      activeLayout,
    );
    if (collectionLayouts?.all?.detailOrder?.length) layout.detailOrder = [...collectionLayouts.all.detailOrder];
    return {
      ...layout,
      sidebarWidth: profile.sidebarWidth ?? null,
      detailPanelWidth: profile.detailPanelWidth ?? null,
      detailDocumentPanelOpen: profile.detailDocumentPanelOpen ?? null,
      detailDocumentPanelWidth: profile.detailDocumentPanelWidth ?? null,
    };
  }
  return {
    ...cloneCollectionViewState(localState ?? emptyLocalViewState()),
    sidebarWidth: localState?.sidebarWidth ?? null,
    detailPanelWidth: localState?.detailPanelWidth ?? null,
    detailDocumentPanelOpen: localState?.detailDocumentPanelOpen ?? null,
    detailDocumentPanelWidth: localState?.detailDocumentPanelWidth ?? null,
  };
}

function mergeCollectionViewState(baseState, overrideState) {
  const base = cloneCollectionViewState(baseState ?? emptyCollectionViewState());
  if (!overrideState) return base;
  const override = cloneCollectionViewState(overrideState);
  return {
    hidden: hasLayoutOverride(override, "hidden") ? override.hidden : base.hidden,
    wrapped: hasLayoutOverride(override, "wrapped") ? override.wrapped : base.wrapped,
    order: hasLayoutOverride(override, "order") ? override.order : base.order,
    detailOrder: hasLayoutOverride(override, "detailOrder") ? override.detailOrder : base.detailOrder,
    widths: { ...base.widths, ...override.widths },
  };
}

function hasLayoutOverride(layout, key) {
  return layout?.overrides?.[key] === true || (layout?.[key]?.length ?? 0) > 0;
}

export function readLocalViewState({ path, collectionPath, viewId, localStorage }) {
  return readLocalViewLayoutState({ path, collectionPath, viewId, localStorage });
}

export function readLocalViewLayoutState({ path, collectionPath, viewId, localStorage }) {
  const state = emptyLocalViewState();
  const normalizedViewId = normalizeViewId(viewId);
  const prefix = normalizedViewId ? viewStoragePrefix(path, collectionPath, normalizedViewId) : null;
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!prefix || !key?.startsWith(prefix)) continue;
    if (key.endsWith(":hidden")) {
      state.hidden.push(key.slice(prefix.length, -":hidden".length));
      continue;
    }
    if (key.endsWith(":wrapped")) {
      state.wrapped.push(key.slice(prefix.length, -":wrapped".length));
      continue;
    }
    if (key.endsWith(":width")) {
      const fieldName = key.slice(prefix.length, -":width".length);
      const width = Number(localStorage.getItem(key));
      if (Number.isFinite(width) && width > 0) state.widths[fieldName] = width;
      continue;
    }
    if (key === viewOrderStorageKey(path, collectionPath, normalizedViewId)) {
      state.order = normalizeStringArray((localStorage.getItem(key) ?? "").split(","));
    }
  }
  state.detailOrder = normalizeStringArray((localStorage.getItem(collectionDetailOrderStorageKey(path, collectionPath)) ?? "").split(","));
  const sidebarWidth = Number(localStorage.getItem(sidebarWidthStorageKey));
  state.sidebarWidth = Number.isFinite(sidebarWidth) && sidebarWidth > 0 ? sidebarWidth : null;
  const detailPanelWidth = Number(localStorage.getItem(detailPanelWidthStorageKey));
  state.detailPanelWidth = Number.isFinite(detailPanelWidth) && detailPanelWidth > 0 ? detailPanelWidth : null;
  const detailDocumentPanelOpen = localStorage.getItem(detailDocumentPanelOpenStorageKey);
  state.detailDocumentPanelOpen = detailDocumentPanelOpen === "1" ? true : detailDocumentPanelOpen === "0" ? false : null;
  const detailDocumentPanelWidth = Number(localStorage.getItem(detailDocumentPanelWidthStorageKey));
  state.detailDocumentPanelWidth = Number.isFinite(detailDocumentPanelWidth) && detailDocumentPanelWidth > 0 ? detailDocumentPanelWidth : null;
  return state;
}

export function readLocalFileOrder(localStorage) {
  return normalizeStringArray((localStorage.getItem(fileOrderStorageKey) ?? "").split(","));
}

export function writeLocalFileOrder(localStorage, fileOrder) {
  const normalized = normalizeStringArray(fileOrder);
  if (normalized.length) {
    localStorage.setItem(fileOrderStorageKey, normalized.join(","));
  } else {
    localStorage.removeItem(fileOrderStorageKey);
  }
}

export function emptyLocalSharedViewDrafts() {
  return emptySharedViewDraftState();
}

export function readLocalSharedViewDrafts(localStorage) {
  const rawValue = localStorage.getItem(sharedViewDraftsStorageKey);
  if (!rawValue) return emptyLocalSharedViewDrafts();
  try {
    return normalizeSharedViewDraftState(JSON.parse(rawValue));
  } catch {
    return emptyLocalSharedViewDrafts();
  }
}

export function writeLocalSharedViewDrafts(localStorage, value) {
  const normalized = normalizeSharedViewDraftState(value);
  if (
    Object.keys(normalized.lastActiveViews).length === 0
    && Object.keys(normalized.viewDrafts).length === 0
    && Object.keys(normalized.viewOrderDrafts).length === 0
    && Object.keys(normalized.structureDrafts).length === 0
  ) {
    localStorage.removeItem(sharedViewDraftsStorageKey);
    return;
  }
  localStorage.setItem(sharedViewDraftsStorageKey, JSON.stringify(normalized));
}

export function writeLocalViewState({ path, collectionPath, viewId, state, localStorage }) {
  return writeLocalViewLayoutState({ path, collectionPath, viewId, state, localStorage });
}

export function writeLocalViewLayoutState({ path, collectionPath, viewId, state, localStorage }) {
  const normalizedViewId = normalizeViewId(viewId);
  if (normalizedViewId) {
    const prefix = viewStoragePrefix(path, collectionPath, normalizedViewId);
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) localStorage.removeItem(key);
    }
    for (const fieldName of normalizeStringArray(state.hidden)) {
      localStorage.setItem(viewFieldStorageKey(path, collectionPath, normalizedViewId, fieldName, "hidden"), "1");
    }
    for (const fieldName of normalizeStringArray(state.wrapped)) {
      localStorage.setItem(viewFieldStorageKey(path, collectionPath, normalizedViewId, fieldName, "wrapped"), "1");
    }
    for (const [fieldName, width] of Object.entries(state.widths ?? {})) {
      if (!Number.isFinite(width) || width <= 0) continue;
      localStorage.setItem(viewFieldStorageKey(path, collectionPath, normalizedViewId, fieldName, "width"), String(Math.round(width)));
    }
    const normalizedOrder = normalizeStringArray(state.order);
    if (normalizedOrder.length) {
      localStorage.setItem(viewOrderStorageKey(path, collectionPath, normalizedViewId), normalizedOrder.join(","));
    }
  }
  const normalizedDetailOrder = normalizeStringArray(state.detailOrder);
  if (normalizedDetailOrder.length) {
    localStorage.setItem(collectionDetailOrderStorageKey(path, collectionPath), normalizedDetailOrder.join(","));
  } else {
    localStorage.removeItem(collectionDetailOrderStorageKey(path, collectionPath));
  }
  if (state.sidebarWidth != null && Number.isFinite(state.sidebarWidth) && state.sidebarWidth > 0) {
    localStorage.setItem(sidebarWidthStorageKey, String(Math.round(state.sidebarWidth)));
  } else {
    localStorage.removeItem(sidebarWidthStorageKey);
  }
  if (state.detailPanelWidth != null && Number.isFinite(state.detailPanelWidth) && state.detailPanelWidth > 0) {
    localStorage.setItem(detailPanelWidthStorageKey, String(Math.round(state.detailPanelWidth)));
  } else {
    localStorage.removeItem(detailPanelWidthStorageKey);
  }
  if (typeof state.detailDocumentPanelOpen === "boolean") {
    localStorage.setItem(detailDocumentPanelOpenStorageKey, state.detailDocumentPanelOpen ? "1" : "0");
  } else {
    localStorage.removeItem(detailDocumentPanelOpenStorageKey);
  }
  if (state.detailDocumentPanelWidth != null && Number.isFinite(state.detailDocumentPanelWidth) && state.detailDocumentPanelWidth > 0) {
    localStorage.setItem(detailDocumentPanelWidthStorageKey, String(Math.round(state.detailDocumentPanelWidth)));
  } else {
    localStorage.removeItem(detailDocumentPanelWidthStorageKey);
  }
}

export function deleteLocalViewState({ path, collectionPath, viewId, localStorage }) {
  return deleteLocalViewLayoutState({ path, collectionPath, viewId, localStorage });
}

export function deleteLocalViewLayoutState({ path, collectionPath, viewId, localStorage }) {
  const normalizedViewId = normalizeViewId(viewId);
  if (!normalizedViewId) return;
  const prefix = viewStoragePrefix(path, collectionPath, normalizedViewId);
  for (let i = localStorage.length - 1; i >= 0; i -= 1) {
    const key = localStorage.key(i);
    if (key?.startsWith(prefix)) localStorage.removeItem(key);
  }
}

export function readLocalSidebarTreePreferences(localStorage) {
  const rawValue = localStorage.getItem(sidebarTreePrefsStorageKey);
  if (!rawValue) return buildSidebarTreePreferences();
  try {
    return buildSidebarTreePreferences(JSON.parse(rawValue));
  } catch {
    return buildSidebarTreePreferences();
  }
}

export function writeLocalSidebarTreePreferences(localStorage, value) {
  const normalized = buildSidebarTreePreferences(value);
  if (Object.keys(normalized.childOrderByParent).length === 0 && normalized.expandedNodeIds.length === 0) {
    localStorage.removeItem(sidebarTreePrefsStorageKey);
    return;
  }
  localStorage.setItem(sidebarTreePrefsStorageKey, JSON.stringify(normalized));
}

export function copyViewLayoutState({
  mode,
  path,
  collectionPath,
  sourceViewId,
  targetViewId,
  profile,
  localStorage,
}) {
  const normalizedSourceViewId = normalizeViewId(sourceViewId);
  const normalizedTargetViewId = normalizeViewId(targetViewId);
  if (!normalizedSourceViewId || !normalizedTargetViewId || normalizedSourceViewId === normalizedTargetViewId) {
    return { profile, copied: false };
  }
  if (mode === "profile") {
    const collectionKey = collectionConfigKey(path, collectionPath);
    const sourceLayout = profile?.viewLayouts?.[collectionKey]?.[normalizedSourceViewId];
    if (!sourceLayout) return { profile, copied: false };
    const nextProfile = {
      sidebarWidth: profile?.sidebarWidth ?? null,
      detailPanelWidth: profile?.detailPanelWidth ?? null,
      detailDocumentPanelOpen: profile?.detailDocumentPanelOpen ?? null,
      detailDocumentPanelWidth: profile?.detailDocumentPanelWidth ?? null,
      fileOrder: [...(profile?.fileOrder ?? [])],
      sidebarTree: buildSidebarTreePreferences(profile?.sidebarTree),
      lastActiveViews: { ...(profile?.lastActiveViews ?? {}) },
      viewDrafts: { ...(profile?.viewDrafts ?? {}) },
      viewOrderDrafts: { ...(profile?.viewOrderDrafts ?? {}) },
      ...(profile?.appearance ? { appearance: profile.appearance } : {}),
      viewLayouts: cloneNestedViewLayouts(profile?.viewLayouts),
      collections: { ...(profile?.collections ?? {}) },
    };
    nextProfile.viewLayouts[collectionKey] ??= {};
    nextProfile.viewLayouts[collectionKey][normalizedTargetViewId] = cloneCollectionViewState(sourceLayout);
    return { profile: nextProfile, copied: true };
  }
  if (!hasLocalViewLayoutState({ path, collectionPath, viewId: normalizedSourceViewId, localStorage })) {
    return { profile, copied: false };
  }
  const nextState = readLocalViewLayoutState({
    path,
    collectionPath,
    viewId: normalizedSourceViewId,
    localStorage,
  });
  writeLocalViewLayoutState({
    path,
    collectionPath,
    viewId: normalizedTargetViewId,
    state: nextState,
    localStorage,
  });
  return { profile, copied: true };
}

export function mutateProfileViewLayoutState({
  profile,
  path,
  collectionPath,
  viewId,
  mutator,
}) {
  const collectionKey = collectionConfigKey(path, collectionPath);
  const normalizedViewId = normalizeViewId(viewId);
  const previousCollectionLayouts = profile?.viewLayouts?.[collectionKey] ?? {};
  const previousSpecificLayout = cloneCollectionViewState(previousCollectionLayouts[normalizedViewId] ?? emptyCollectionViewState());
  const previousGlobalDetailOrder = [...(previousCollectionLayouts.all?.detailOrder ?? [])];
  const nextProfile = {
    sidebarWidth: profile?.sidebarWidth ?? null,
    detailPanelWidth: profile?.detailPanelWidth ?? null,
    detailDocumentPanelOpen: profile?.detailDocumentPanelOpen ?? null,
    detailDocumentPanelWidth: profile?.detailDocumentPanelWidth ?? null,
    fileOrder: [...(profile?.fileOrder ?? [])],
    sidebarTree: buildSidebarTreePreferences(profile?.sidebarTree),
    lastActiveViews: { ...(profile?.lastActiveViews ?? {}) },
    viewDrafts: { ...(profile?.viewDrafts ?? {}) },
    viewOrderDrafts: { ...(profile?.viewOrderDrafts ?? {}) },
    ...(profile?.appearance ? { appearance: profile.appearance } : {}),
    viewLayouts: cloneNestedViewLayouts(profile?.viewLayouts),
    collections: Object.fromEntries(
      Object.entries(profile?.collections ?? {}).map(([key, value]) => [key, cloneCollectionViewState(value)]),
    ),
  };
  const nextLayout = cloneCollectionViewState(readViewLayoutState({
    mode: "profile",
    path,
    collectionPath,
    viewId: normalizedViewId,
    localState: null,
    profile: nextProfile,
  }));
  mutator(nextLayout);
  const nextDetailOrder = normalizeStringArray(nextLayout.detailOrder);
  nextProfile.viewLayouts[collectionKey] ??= {};
  const nextSpecificLayout = cloneCollectionViewState(nextLayout);
  if (normalizedViewId !== "all") {
    const baseLayout = nextProfile.viewLayouts[collectionKey].all
      ?? nextProfile.collections?.[collectionKey]
      ?? emptyCollectionViewState();
    nextSpecificLayout.overrides = buildLayoutOverrides(baseLayout, nextSpecificLayout, previousSpecificLayout.overrides);
    if (Object.keys(nextSpecificLayout.overrides).length === 0) delete nextSpecificLayout.overrides;
  }
  if (normalizedViewId !== "all") nextSpecificLayout.detailOrder = previousSpecificLayout.detailOrder;
  nextProfile.viewLayouts[collectionKey][normalizedViewId] = nextSpecificLayout;
  if (normalizedViewId === "all" || !sameStringArray(previousGlobalDetailOrder, nextDetailOrder)) {
    const nextAllLayout = cloneCollectionViewState(nextProfile.viewLayouts[collectionKey].all ?? emptyCollectionViewState());
    nextAllLayout.detailOrder = nextDetailOrder;
    nextProfile.viewLayouts[collectionKey].all = nextAllLayout;
  }
  if (nextProfile.lastActiveViews?.[collectionKey] === normalizedViewId) {
    nextProfile.collections[collectionKey] = {
      ...cloneCollectionViewState(nextSpecificLayout),
      detailOrder: [...(nextProfile.viewLayouts[collectionKey].all?.detailOrder ?? [])],
    };
  }
  return nextProfile;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) continue;
    const normalized = item.trim();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

export function resetCollectionViewState({ mode, path, collectionPath, viewId, profile, localState }) {
  return resetViewLayoutState({ mode, path, collectionPath, viewId, profile, localState });
}

export function resetViewLayoutState({ mode, path, collectionPath, viewId, profile, localState }) {
  if (mode === "profile") {
    const nextProfile = {
      sidebarWidth: null,
      detailPanelWidth: null,
      detailDocumentPanelOpen: null,
      detailDocumentPanelWidth: null,
      fileOrder: [...(profile?.fileOrder ?? [])],
      sidebarTree: buildSidebarTreePreferences(profile?.sidebarTree),
      lastActiveViews: { ...(profile?.lastActiveViews ?? {}) },
      viewDrafts: { ...(profile?.viewDrafts ?? {}) },
      viewOrderDrafts: { ...(profile?.viewOrderDrafts ?? {}) },
      viewLayouts: cloneNestedViewLayouts(profile?.viewLayouts),
      collections: { ...(profile?.collections ?? {}) },
    };
    const collectionKey = collectionConfigKey(path, collectionPath);
    const normalizedViewId = normalizeViewId(viewId);
    if (normalizedViewId && nextProfile.viewLayouts[collectionKey]) {
      delete nextProfile.viewLayouts[collectionKey][normalizedViewId];
      if (Object.keys(nextProfile.viewLayouts[collectionKey]).length === 0) delete nextProfile.viewLayouts[collectionKey];
    }
    delete nextProfile.collections[collectionKey];
    return {
      profile: nextProfile,
      localState,
    };
  }
  return {
    profile,
    localState: emptyLocalViewState(),
  };
}

function cloneNestedViewLayouts(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).map(([collectionKey, views]) => [
      collectionKey,
      Object.fromEntries(
        Object.entries(views ?? {}).map(([viewId, layout]) => [viewId, cloneCollectionViewState(layout)]),
      ),
    ]),
  );
}

function buildLayoutOverrides(baseLayout, nextLayout, previousOverrides = {}) {
  const overrides = normalizeLayoutOverrides(previousOverrides);
  for (const key of ["hidden", "wrapped", "order", "detailOrder"]) {
    if (!sameStringArray(baseLayout?.[key] ?? [], nextLayout?.[key] ?? [])) {
      overrides[key] = true;
    }
  }
  return overrides;
}

function normalizeLayoutOverrides(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  for (const key of ["hidden", "wrapped", "order", "detailOrder"]) {
    if (value[key] === true) result[key] = true;
  }
  return result;
}

function sameStringArray(left, right) {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function hasLocalViewLayoutState({ path, collectionPath, viewId, localStorage }) {
  const normalizedViewId = normalizeViewId(viewId);
  if (!normalizedViewId) return false;
  const prefix = viewStoragePrefix(path, collectionPath, normalizedViewId);
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key?.startsWith(prefix)) return true;
  }
  return false;
}
