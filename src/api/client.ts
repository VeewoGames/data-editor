import { saveDocumentsWith } from "./save-documents.mjs";

export const recoverableRequestEventName = "data-editor:recoverable-request";
const defaultRecoveryBridgePort = 8791;

export type RecoverableRequestEventDetail = {
  url: string;
  status: "success" | "failure";
  message?: string;
};

export type DataFile = { path: string; size: number; modifiedAt: string };
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
  collections: Record<string, {
    hidden: string[];
    wrapped: string[];
    order: string[];
    detailOrder: string[];
    widths: Record<string, number>;
  }>;
};

export async function listFiles(): Promise<DataFile[]> {
  return fetchJson("/api/files");
}

export async function loadDocument(path: string) {
  return fetchJson(`/api/document?path=${encodeURIComponent(path)}`);
}

export async function saveDocument(path: string, root: unknown) {
  return fetchJson("/api/save", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path, root }),
  });
}

export async function saveDocuments(items: PendingDocumentSave[]): Promise<SaveDocumentsResult> {
  return saveDocumentsWith(items, saveDocument);
}

export async function loadViewConfig(): Promise<ViewConfig> {
  return fetchJson("/api/view-config");
}

export async function saveViewConfig(config: ViewConfig) {
  return fetchJson("/api/view-config", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(config),
  });
}

export async function listViewProfiles(): Promise<string[]> {
  return fetchJson("/api/view-profiles");
}

export async function loadViewProfile(name: string): Promise<UserViewProfile> {
  return fetchJson(`/api/view-profile?name=${encodeURIComponent(name)}`);
}

export async function saveViewProfile(name: string, profile: UserViewProfile) {
  return fetchJson("/api/view-profile", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, profile }),
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
