import { saveDocumentsWith } from "./save-documents.mjs";

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
    type?: "Text" | "Select";
    selectOptions: Record<string, {
      label: string;
      color: "default" | "gray" | "brown" | "orange" | "yellow" | "green" | "blue" | "purple" | "pink" | "red" | null;
    }>;
    multiSelectOptions: Record<string, {
      label: string;
      color: "default" | "gray" | "brown" | "orange" | "yellow" | "green" | "blue" | "purple" | "pink" | "red" | null;
    }>;
  }>;
  primaryKeys: Record<string, string>;
  backlinks: Record<string, BacklinkConfig>;
  relations: Record<string, RelationConfig>;
  relationsVersion: number;
};
export type UserViewProfile = {
  sidebarWidth: number | null;
  fileOrder: string[];
  collections: Record<string, {
    hidden: string[];
    wrapped: string[];
    order: string[];
    detailOrder: string[];
    widths: Record<string, number>;
  }>;
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

export async function saveDocument(path: string, root: unknown, projectId?: string | null) {
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
  return fetchJson(withProjectId("/api/view-config", projectId));
}

export async function saveViewConfig(config: ViewConfig, projectId?: string | null) {
  return fetchJson("/api/view-config", {
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

async function fetchJson(url: string, options?: RequestInit, fetchOptions: FetchJsonOptions = {}) {
  const { reportRecoverableRequest = true } = fetchOptions;
  let res: Response;
  try {
    res = await fetch(url, options);
  } catch (error) {
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
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

function withProjectId(url: string, projectId?: string | null) {
  if (!projectId) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}projectId=${encodeURIComponent(projectId)}`;
}
