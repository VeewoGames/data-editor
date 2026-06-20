const pageContextStorageKey = "data-editor:page-context";
const defaultCollectionPath = "$";

export type PageScrollPosition = {
  scrollTop: number;
  scrollLeft: number;
};

export type ProjectPageContextState = {
  selectedPath: string | null;
  collectionPath: string;
  scrollByView: Record<string, PageScrollPosition>;
  expandedGroupId: string | null;
  lastActiveViewIdByGroupId: Record<string, string>;
};

export type PageContextState = {
  projects: Record<string, ProjectPageContextState>;
};

type PageContextSelectionPatch = {
  selectedPath?: string | null;
  collectionPath?: string | null;
};

type PageContextScrollUpdate = {
  path: string | null;
  collectionPath: string | null;
  viewId: string | null;
  scrollTop: number;
  scrollLeft: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function emptyPageContextState(): PageContextState {
  return { projects: {} };
}

function emptyProjectPageContext(): ProjectPageContextState {
  return {
    selectedPath: null,
    collectionPath: defaultCollectionPath,
    scrollByView: {},
    expandedGroupId: null,
    lastActiveViewIdByGroupId: {},
  };
}

function normalizeProjectId(projectId: unknown): string {
  if (typeof projectId !== "string") return "";
  return projectId.trim();
}

function normalizeSelectedPath(selectedPath: unknown): string | null {
  return typeof selectedPath === "string" ? selectedPath : null;
}

function normalizeCollectionPath(collectionPath: unknown): string {
  if (typeof collectionPath !== "string") return defaultCollectionPath;
  const normalized = collectionPath.trim();
  return normalized || defaultCollectionPath;
}

function normalizeScrollValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function normalizeScrollEntry(entry: unknown): PageScrollPosition | null {
  if (!isRecord(entry)) return null;
  const scrollTop = normalizeScrollValue(entry.scrollTop);
  const scrollLeft = normalizeScrollValue(entry.scrollLeft);
  if (scrollTop == null || scrollLeft == null) return null;
  return { scrollTop, scrollLeft };
}

function normalizeScrollByView(scrollByView: unknown): Record<string, PageScrollPosition> {
  if (!isRecord(scrollByView)) return {};
  const normalized: Record<string, PageScrollPosition> = {};
  for (const [key, value] of Object.entries(scrollByView)) {
    if (!key) continue;
    const nextValue = normalizeScrollEntry(value);
    if (nextValue) normalized[key] = nextValue;
  }
  return normalized;
}

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function normalizeStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const normalized: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    const normalizedKey = normalizeNonEmptyString(key);
    const normalizedValue = normalizeNonEmptyString(item);
    if (!normalizedKey || !normalizedValue) continue;
    normalized[normalizedKey] = normalizedValue;
  }
  return normalized;
}

function normalizeProjectPageContext(projectState: unknown): ProjectPageContextState {
  if (!isRecord(projectState)) return emptyProjectPageContext();
  return {
    selectedPath: normalizeSelectedPath(projectState.selectedPath),
    collectionPath: normalizeCollectionPath(projectState.collectionPath),
    scrollByView: normalizeScrollByView(projectState.scrollByView),
    expandedGroupId: normalizeNonEmptyString(projectState.expandedGroupId),
    lastActiveViewIdByGroupId: normalizeStringRecord(projectState.lastActiveViewIdByGroupId),
  };
}

function normalizePageContextState(state: unknown): PageContextState {
  if (!isRecord(state)) return emptyPageContextState();
  const normalized = emptyPageContextState();
  if (!isRecord(state.projects)) return normalized;
  for (const [projectId, projectState] of Object.entries(state.projects)) {
    const normalizedProjectId = normalizeProjectId(projectId);
    if (!normalizedProjectId) continue;
    normalized.projects[normalizedProjectId] = normalizeProjectPageContext(projectState);
  }
  return normalized;
}

export function readPageContextState(localStorage: Storage): PageContextState {
  const rawValue = localStorage.getItem(pageContextStorageKey);
  if (!rawValue) return emptyPageContextState();
  try {
    return normalizePageContextState(JSON.parse(rawValue) as unknown);
  } catch {
    return emptyPageContextState();
  }
}

export function writePageContextState(localStorage: Storage, state: PageContextState): void {
  const normalized = normalizePageContextState(state);
  if (Object.keys(normalized.projects).length === 0) {
    localStorage.removeItem(pageContextStorageKey);
    return;
  }
  localStorage.setItem(pageContextStorageKey, JSON.stringify(normalized));
}

export function readProjectPageContext(state: PageContextState, projectId: string | null): ProjectPageContextState {
  const normalizedState = normalizePageContextState(state);
  const normalizedProjectId = normalizeProjectId(projectId);
  if (!normalizedProjectId) return emptyProjectPageContext();
  return normalizedState.projects[normalizedProjectId] ?? emptyProjectPageContext();
}

export function buildScrollContextKey(path: string | null, collectionPath: string | null, viewId: string | null): string | null {
  if (typeof path !== "string" || !path) return null;
  if (typeof viewId !== "string" || !viewId.trim()) return null;
  return `${path}:${normalizeCollectionPath(collectionPath)}:${viewId.trim()}`;
}

export function updatePageContextSelection(
  localStorage: Storage,
  projectId: string | null,
  patch: PageContextSelectionPatch,
): void {
  const normalizedProjectId = normalizeProjectId(projectId);
  if (!normalizedProjectId) return;
  const state = readPageContextState(localStorage);
  const current = state.projects[normalizedProjectId] ?? emptyProjectPageContext();
  state.projects[normalizedProjectId] = {
    selectedPath: Object.hasOwn(patch, "selectedPath")
      ? normalizeSelectedPath(patch.selectedPath)
      : current.selectedPath,
    collectionPath: Object.hasOwn(patch, "collectionPath")
      ? normalizeCollectionPath(patch.collectionPath)
      : current.collectionPath,
    scrollByView: { ...current.scrollByView },
    expandedGroupId: current.expandedGroupId,
    lastActiveViewIdByGroupId: { ...current.lastActiveViewIdByGroupId },
  };
  writePageContextState(localStorage, state);
}

export function updatePageContextScroll(
  localStorage: Storage,
  projectId: string | null,
  input: PageContextScrollUpdate,
): void {
  const normalizedProjectId = normalizeProjectId(projectId);
  if (!normalizedProjectId) return;
  const scrollKey = buildScrollContextKey(input.path, input.collectionPath, input.viewId);
  const nextScroll = normalizeScrollEntry({
    scrollTop: input.scrollTop,
    scrollLeft: input.scrollLeft,
  });
  if (!scrollKey || !nextScroll) return;
  const state = readPageContextState(localStorage);
  const current = state.projects[normalizedProjectId] ?? emptyProjectPageContext();
  state.projects[normalizedProjectId] = {
    selectedPath: current.selectedPath,
    collectionPath: current.collectionPath,
    scrollByView: {
      ...current.scrollByView,
      [scrollKey]: nextScroll,
    },
    expandedGroupId: current.expandedGroupId,
    lastActiveViewIdByGroupId: { ...current.lastActiveViewIdByGroupId },
  };
  writePageContextState(localStorage, state);
}

export function updatePageContextViewGrouping(
  localStorage: Storage,
  projectId: string | null,
  input: {
    expandedGroupId: string | null;
    lastActiveViewIdByGroupId: Record<string, string>;
  },
): void {
  const normalizedProjectId = normalizeProjectId(projectId);
  if (!normalizedProjectId) return;
  const state = readPageContextState(localStorage);
  const current = state.projects[normalizedProjectId] ?? emptyProjectPageContext();
  state.projects[normalizedProjectId] = {
    selectedPath: current.selectedPath,
    collectionPath: current.collectionPath,
    scrollByView: { ...current.scrollByView },
    expandedGroupId: normalizeNonEmptyString(input.expandedGroupId),
    lastActiveViewIdByGroupId: normalizeStringRecord(input.lastActiveViewIdByGroupId),
  };
  writePageContextState(localStorage, state);
}
