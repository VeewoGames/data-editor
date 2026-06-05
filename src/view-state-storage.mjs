import {
  emptySharedViewDraftState,
  normalizeSharedViewDraftState,
} from "./view/shared-view-normalize.mjs";

export function emptyCollectionViewState() {
  return {
    hidden: [],
    wrapped: [],
    order: [],
    detailOrder: [],
    widths: {},
  };
}

export function emptyLocalViewState() {
  return {
    ...emptyCollectionViewState(),
    sidebarWidth: null,
    detailPanelWidth: null,
  };
}

export function collectionConfigKey(path, collectionPath) {
  return `${path}:${collectionPath}`;
}

function fieldStorageKey(path, collectionPath, fieldName, suffix) {
  return `data-editor:${path}:${collectionPath}:${fieldName}:${suffix}`;
}

function orderStorageKey(path, collectionPath) {
  return `data-editor:${path}:${collectionPath}:__order`;
}

const sidebarWidthStorageKey = "data-editor:sidebar-width";
const detailPanelWidthStorageKey = "data-editor:detail-panel-width";
const fileOrderStorageKey = "data-editor:__file-order";
const sharedViewDraftsStorageKey = "data-editor:shared-view-drafts";

export function cloneCollectionViewState(state) {
  return {
    hidden: [...(state?.hidden ?? [])],
    wrapped: [...(state?.wrapped ?? [])],
    order: [...(state?.order ?? [])],
    detailOrder: [...(state?.detailOrder ?? [])],
    widths: { ...(state?.widths ?? {}) },
  };
}

export function readCollectionViewState({ mode, path, collectionPath, localState, profile }) {
  if (mode === "profile" && profile) {
    const collection = profile.collections?.[collectionConfigKey(path, collectionPath)] ?? emptyCollectionViewState();
    return {
      ...cloneCollectionViewState(collection),
      sidebarWidth: profile.sidebarWidth ?? null,
      detailPanelWidth: profile.detailPanelWidth ?? null,
    };
  }
  return {
    ...cloneCollectionViewState(localState ?? emptyLocalViewState()),
    sidebarWidth: localState?.sidebarWidth ?? null,
    detailPanelWidth: localState?.detailPanelWidth ?? null,
  };
}

export function readLocalViewState({ path, collectionPath, localStorage }) {
  const state = emptyLocalViewState();
  const prefix = `data-editor:${path}:${collectionPath}:`;
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key?.startsWith(prefix)) continue;
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
    if (key === orderStorageKey(path, collectionPath)) {
      state.order = (localStorage.getItem(key) ?? "").split(",").filter(Boolean);
    }
  }
  const sidebarWidth = Number(localStorage.getItem(sidebarWidthStorageKey));
  state.sidebarWidth = Number.isFinite(sidebarWidth) && sidebarWidth > 0 ? sidebarWidth : null;
  const detailPanelWidth = Number(localStorage.getItem(detailPanelWidthStorageKey));
  state.detailPanelWidth = Number.isFinite(detailPanelWidth) && detailPanelWidth > 0 ? detailPanelWidth : null;
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
  ) {
    localStorage.removeItem(sharedViewDraftsStorageKey);
    return;
  }
  localStorage.setItem(sharedViewDraftsStorageKey, JSON.stringify(normalized));
}

export function writeLocalViewState({ path, collectionPath, state, localStorage }) {
  const prefix = `data-editor:${path}:${collectionPath}:`;
  for (let i = localStorage.length - 1; i >= 0; i -= 1) {
    const key = localStorage.key(i);
    if (key?.startsWith(prefix)) localStorage.removeItem(key);
  }
  for (const fieldName of state.hidden) {
    localStorage.setItem(fieldStorageKey(path, collectionPath, fieldName, "hidden"), "1");
  }
  for (const fieldName of state.wrapped) {
    localStorage.setItem(fieldStorageKey(path, collectionPath, fieldName, "wrapped"), "1");
  }
  for (const [fieldName, width] of Object.entries(state.widths)) {
    localStorage.setItem(fieldStorageKey(path, collectionPath, fieldName, "width"), String(Math.round(width)));
  }
  if (state.order.length) {
    localStorage.setItem(orderStorageKey(path, collectionPath), state.order.join(","));
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

export function resetCollectionViewState({ mode, path, collectionPath, profile, localState }) {
  if (mode === "profile") {
    const nextProfile = {
      sidebarWidth: null,
      detailPanelWidth: null,
      fileOrder: [...(profile?.fileOrder ?? [])],
      lastActiveViews: { ...(profile?.lastActiveViews ?? {}) },
      viewDrafts: { ...(profile?.viewDrafts ?? {}) },
      viewOrderDrafts: { ...(profile?.viewOrderDrafts ?? {}) },
      collections: { ...(profile?.collections ?? {}) },
    };
    delete nextProfile.collections[collectionConfigKey(path, collectionPath)];
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
