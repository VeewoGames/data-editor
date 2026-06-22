import { saveDocumentsWith } from "./save-documents.mjs";
import normalizeFetchedViewConfig from "../view-config-client.mjs";
import { recordWindowAutosaveDebugEvent } from "../autosave-debug.mjs";

export const recoverableRequestEventName = "data-editor:recoverable-request";
const defaultRecoveryBridgePort = 8791;

export type RecoverableRequestEventDetail = {
  url: string;
  status: "success" | "failure";
  message?: string;
};

export type DataFile = { path: string; displayPath?: string; dataSourceId?: string; dataSourceLabel?: string; size: number; modifiedAt: string };
export type DataSourceDefinition = {
  id: string;
  label: string;
  path: string;
  kind: "relative" | "absolute";
};
export type ProjectDefinition = {
  id: string;
  name: string;
  root: string;
  adapter: string;
  dataSources: DataSourceDefinition[];
  filePolicy: { includeExtensions: string[] };
};
export type ProjectRegistry = {
  version: number;
  activeProjectId: string | null;
  projects: ProjectDefinition[];
};
export type PendingDocumentSave = { path: string; root: unknown };
export type SaveDocumentResult = { ok: true };
export type SaveDocumentsResult = {
  ok: boolean;
  savedPaths: string[];
  failedPath: string | null;
  errorMessage: string | null;
};
export type RelationConfig = {
  targetFile: string;
  targetCollection: string;
  targetKey: string;
  mode: "single" | "multi";
  titleFields: string[];
  allowMissing: boolean;
};
export type BacklinkConfig = {
  sourceRelation: string;
  displayMode: "list";
};
export type ViewConfig = {
  fields: Record<string, {
    type?: "Text" | "Select" | "Document";
    selectOptions: Record<string, {
      label: string;
      color: "default" | "gray" | "brown" | "orange" | "yellow" | "green" | "blue" | "teal" | "cyan" | "lime" | "indigo" | "rose" | "amber" | "purple" | "pink" | "red" | "mid_gray" | "mid_brown" | "mid_orange" | "mid_yellow" | "mid_green" | "mid_blue" | "mid_teal" | "mid_cyan" | "mid_lime" | "mid_indigo" | "mid_purple" | "mid_pink" | "mid_red" | "mid_rose" | "mid_amber" | "dark_gray" | "dark_brown" | "dark_orange" | "dark_yellow" | "dark_green" | "dark_blue" | "dark_teal" | "dark_cyan" | "dark_lime" | "dark_indigo" | "dark_purple" | "dark_pink" | "dark_red" | "dark_rose" | "dark_amber" | null;
    }>;
    multiSelectOptions: Record<string, {
      label: string;
      color: "default" | "gray" | "brown" | "orange" | "yellow" | "green" | "blue" | "teal" | "cyan" | "lime" | "indigo" | "rose" | "amber" | "purple" | "pink" | "red" | "mid_gray" | "mid_brown" | "mid_orange" | "mid_yellow" | "mid_green" | "mid_blue" | "mid_teal" | "mid_cyan" | "mid_lime" | "mid_indigo" | "mid_purple" | "mid_pink" | "mid_red" | "mid_rose" | "mid_amber" | "dark_gray" | "dark_brown" | "dark_orange" | "dark_yellow" | "dark_green" | "dark_blue" | "dark_teal" | "dark_cyan" | "dark_lime" | "dark_indigo" | "dark_purple" | "dark_pink" | "dark_red" | "dark_rose" | "dark_amber" | null;
    }>;
  }>;
  titleFields: Record<string, string>;
  documentFiles: Record<string, {
    docRoot: string;
  }>;
  documentFields: Record<string, {
    enabled: true;
  }>;
  primaryKeys: Record<string, string>;
  backlinks: Record<string, BacklinkConfig>;
  relations: Record<string, RelationConfig>;
  relationsVersion: number;
};
export type DocumentIndexEntry =
  | { status: "resolved"; id: string; relativePath: string; title: string | null }
  | { status: "conflict"; id: string; matches: string[] };
export type DocumentIndexResponse = {
  docRoot: string | null;
  entries: Record<string, DocumentIndexEntry>;
};
export type DocumentContentResponse =
  | { status: "resolved"; id: string; relativePath: string; title: string | null; content: string }
  | { status: "conflict"; id: string; matches: string[] }
  | { status: "missing"; id: string };
export type UserThemeId = "light" | "dark";
export type UserBaseFontSize = 14 | 14.5 | 15 | 16;
export type UserThemeOverrides = {
  light?: Record<string, string>;
  dark?: Record<string, string>;
};
export type UserAppearancePreferences = {
  activeThemeId: UserThemeId;
  baseFontSize: UserBaseFontSize;
  themeOverrides?: UserThemeOverrides;
};
export type UserViewLayoutState = {
  hidden: string[];
  wrapped: string[];
  order: string[];
  detailOrder: string[];
  widths: Record<string, number>;
};
export type SidebarTreePreferences = {
  childOrderByParent: Record<string, string[]>;
  expandedNodeIds: string[];
};
export type UserViewProfile = {
  sidebarWidth: number | null;
  detailPanelWidth: number | null;
  detailDocumentPanelOpen: boolean | null;
  detailDocumentPanelWidth: number | null;
  fileOrder: string[];
  sidebarTree: SidebarTreePreferences;
  lastActiveViews: Record<string, string>;
  viewDrafts: Record<string, Record<string, Partial<CollectionView>>>;
  viewOrderDrafts: Record<string, string[]>;
  structureDrafts?: Record<string, SharedViewStructureDraft>;
  appearance?: UserAppearancePreferences;
  viewLayouts: Record<string, Record<string, UserViewLayoutState>>;
  collections?: Record<string, UserViewLayoutState>;
};
export type FilterOperator = "is" | "is_not" | "contains" | "does_not_contain" | "is_empty" | "is_not_empty";
export type FilterJoin = "and" | "or";
export type FilterRule = { kind: "rule"; id: string; field: string; operator: FilterOperator; value?: unknown; join?: FilterJoin };
export type FilterGroupNode = { kind: "group"; id: string; op: FilterJoin; join?: FilterJoin; children: FilterNode[] };
export type FilterNode = FilterRule | FilterGroupNode;
export type FilterGroup = { topLevelRules: FilterRule[]; advancedRoot: FilterGroupNode | null };
export type SortRule = { id: string; field: string; direction: "asc" | "desc" };
export type CollectionView = {
  id: string;
  name: string;
  type: "table";
  query: string;
  filters: FilterGroup;
  sorts: SortRule[];
  hidden: string[];
  wrapped: string[];
  order: string[];
  detailOrder: string[];
  widths: Record<string, number>;
};
export type SharedViewStructureDraft = {
  items: Array<
    | { kind: "view"; viewId: string }
    | { kind: "group"; groupId: string; name?: string; viewIds: string[] }
  >;
};
export type SharedViewLeafItem = {
  kind: "view";
  view: CollectionView;
};
export type SharedViewGroupItem = {
  kind: "group";
  id: string;
  name: string;
  views: CollectionView[];
};
export type SharedViewItem = SharedViewLeafItem | SharedViewGroupItem;
export type SharedViewsConfig = {
  version: 1;
  collections: Record<string, { items: SharedViewItem[]; defaultViewId: string | null }>;
};

export async function listProjects(): Promise<ProjectRegistry> {
  return fetchJson("/api/projects");
}

export async function createProject(project: Partial<ProjectDefinition> & { root: string }) {
  return fetchJson("/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(project),
  });
}

export async function updateProject(project: Partial<ProjectDefinition> & { id: string }) {
  return fetchJson("/api/project-update", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(project),
  });
}

export async function deleteProject(projectId: string) {
  return fetchJson("/api/project-delete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId }),
  });
}

export async function activateProject(projectId: string) {
  return fetchJson("/api/project-activate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId }),
  });
}

export async function listFiles(projectId?: string | null): Promise<DataFile[]> {
  return fetchJson(withProjectId("/api/files", projectId));
}

export async function loadDocument(path: string, projectId?: string | null) {
  return fetchJson(withProjectId(`/api/document?path=${encodeURIComponent(path)}`, projectId));
}

export async function saveDocument(path: string, root: unknown, projectId?: string | null): Promise<SaveDocumentResult> {
  return fetchJson("/api/save", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId, path, root }),
  });
}

export async function saveDocuments(items: PendingDocumentSave[], projectId?: string | null): Promise<SaveDocumentsResult> {
  return saveDocumentsWith(items, (path: string, root: unknown) => saveDocument(path, root, projectId));
}

export async function loadViewConfig(projectId?: string | null): Promise<ViewConfig> {
  return normalizeFetchedViewConfig(await fetchJson(withProjectId("/api/view-config", projectId))) as ViewConfig;
}

export async function loadDocumentIndex(path: string, projectId?: string | null): Promise<DocumentIndexResponse> {
  return fetchJson(withProjectId(`/api/document-index?path=${encodeURIComponent(path)}`, projectId));
}

export async function loadDocumentContent(path: string, id: string, projectId?: string | null): Promise<DocumentContentResponse> {
  return fetchJson(withProjectId(`/api/document-content?path=${encodeURIComponent(path)}&id=${encodeURIComponent(id)}`, projectId));
}

export async function saveViewConfig(config: ViewConfig, projectId?: string | null) {
  return fetchJson("/api/view-config", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId, config }),
  });
}

export async function loadSharedViews(projectId?: string | null): Promise<SharedViewsConfig> {
  return fetchJson(withProjectId("/api/shared-views", projectId));
}

export async function saveSharedViews(config: SharedViewsConfig, projectId?: string | null) {
  return fetchJson("/api/shared-views", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId, config }),
  });
}

export async function listViewProfiles(projectId?: string | null): Promise<string[]> {
  return fetchJson(withProjectId("/api/view-profiles", projectId));
}

export async function loadViewProfile(name: string, projectId?: string | null): Promise<UserViewProfile> {
  return fetchJson(withProjectId(`/api/view-profile?name=${encodeURIComponent(name)}`, projectId));
}

export async function saveViewProfile(name: string, profile: UserViewProfile, projectId?: string | null) {
  return fetchJson("/api/view-profile", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId, name, profile }),
  });
}

export async function shutdownServer() {
  const res = await fetch("/api/shutdown", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  let data: unknown = null;
  try {
    const text = await res.text();
    if (text) data = JSON.parse(text);
  } catch (error) {
    if (res.ok) return { ok: true };
    throw error;
  }
  if (!res.ok) {
    const message = data && typeof data === "object" && "error" in data ? String(data.error) : `HTTP ${res.status}`;
    throw new Error(message);
  }
  return data ?? { ok: true };
}

export async function rebuildFrontend() {
  return fetchJson(
    "/api/rebuild",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    },
    { reportRecoverableRequest: false },
  );
}

export async function checkEditorHealth(): Promise<{ ok: true; bridgePort: number }> {
  return fetchJson("/api/health", undefined, { reportRecoverableRequest: false });
}

export async function checkRecoveryBridgeHealth(port = defaultRecoveryBridgePort): Promise<{ ok: true }> {
  return fetchJson(`http://127.0.0.1:${port}/health`, undefined, { reportRecoverableRequest: false });
}

export async function reopenEditor(port = defaultRecoveryBridgePort): Promise<{ ok: true; message?: string }> {
  return fetchJson(
    `http://127.0.0.1:${port}/reopen`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    },
    { reportRecoverableRequest: false },
  );
}

type FetchJsonOptions = {
  reportRecoverableRequest?: boolean;
};

function isAutosaveDebugRequest(url: string, options?: RequestInit) {
  const method = (options?.method ?? "GET").toUpperCase();
  if (method !== "POST") return false;
  return url === "/api/save" || url === "/api/view-config" || url === "/api/view-profile";
}

async function fetchJson(url: string, options?: RequestInit, fetchOptions: FetchJsonOptions = {}) {
  const { reportRecoverableRequest = true } = fetchOptions;
  const autosaveDebugRequest = isAutosaveDebugRequest(url, options);
  const requestMethod = (options?.method ?? "GET").toUpperCase();
  let res: Response;
  try {
    res = await fetch(url, options);
  } catch (error) {
    if (autosaveDebugRequest) {
      recordWindowAutosaveDebugEvent({
        kind: "request",
        method: requestMethod,
        status: "failure",
        url,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    if (reportRecoverableRequest && typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent<RecoverableRequestEventDetail>(recoverableRequestEventName, {
          detail: {
            url,
            status: "failure",
            message: error instanceof Error ? error.message : String(error),
          },
        }),
      );
    }
    throw error;
  }
  if (reportRecoverableRequest && typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<RecoverableRequestEventDetail>(recoverableRequestEventName, {
        detail: {
          url,
          status: "success",
        },
      }),
    );
  }
  if (autosaveDebugRequest) {
    recordWindowAutosaveDebugEvent({
      kind: "request",
      method: requestMethod,
      status: res.ok ? "success" : "failure",
      url,
      message: res.ok ? undefined : `HTTP ${res.status}`,
    });
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

function withProjectId(url: string, projectId?: string | null) {
  if (!projectId) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}projectId=${encodeURIComponent(projectId)}`;
}
