import { saveDocumentsWith } from "./save-documents.mjs";
import { createSaveIdempotencyKey } from "./save-idempotency-key.mjs";
import type { DocumentModel } from "../model/documentModel";
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
  dataSources: DataSourceDefinition[];
  filePolicy: { includeExtensions: string[] };
};
export type EntryActionRule = {
  id: string;
  label: string;
  icon: SharedViewIconId;
  enabled: boolean;
  targets: EntryActionTarget[];
  payload: {
    includeRow: boolean;
    includeNeighbors: boolean;
  };
  runtime?: {
    model?: string;
    reasoning?: "none" | "low" | "medium" | "high" | "xhigh";
    verbosity?: "low" | "medium" | "high";
    timeoutMs?: number;
  };
};
export type EntryActionTarget = {
  file: string;
  collection: string;
  textArtifact?: {
    pathTemplate: string;
    sourceField: string;
    allowCreate: boolean;
    allowUpdate: boolean;
    maxBytes: number;
  };
};
export type UserAutomationProfile = {
  rules: EntryActionRule[];
  etag?: string | null;
};
export type EntryActionBinding = {
  provider: "codex";
  skill: string;
  enabled: boolean;
};
export type DeviceEntryActionBindings = {
  defaults: {
    model?: string;
    reasoning?: "none" | "low" | "medium" | "high" | "xhigh";
    verbosity?: "low" | "medium" | "high";
    timeoutMs?: number;
  };
  bindings: Record<string, EntryActionBinding>;
  bindingStatuses?: Record<string, {
    status: "ready" | "missing" | "invalid";
    reason: string | null;
    message: string | null;
    codexCliPath?: string | null;
    skillPath?: string | null;
    model?: string | null;
  }>;
};
type EntryActionRuntime = NonNullable<EntryActionRule["runtime"]>;
type EntryActionReasoning = NonNullable<EntryActionRuntime["reasoning"]>;
type EntryActionVerbosity = NonNullable<EntryActionRuntime["verbosity"]>;
type DeviceEntryActionBindingStatus = NonNullable<DeviceEntryActionBindings["bindingStatuses"]>[string];
export type AutomationSkillCatalogItem = {
  id: string;
  label: string;
  source?: string;
};
export type AutomationSkillCatalog = {
  provider: "codex";
  loadedAt: string;
  skills: AutomationSkillCatalogItem[];
};
export type ProjectRegistry = {
  version: number;
  activeProjectId: string | null;
  projects: ProjectDefinition[];
};
export type PendingDocumentSave = { path: string; root: unknown; documentEtag: string; idempotencyKey?: string };
export type SaveDocumentResult = { ok: true; documentEtag?: string };
export type SaveDocumentsResult = {
  ok: boolean;
  savedPaths: string[];
  failedPath: string | null;
  errorMessage: string | null;
  errorCode: string | null;
  errorField: string | null;
  documentEtags: Record<string, string>;
};
export type ProjectCapabilityStatus = "generic_absent" | "active" | "manifest_invalid" | "binding_degraded" | "contract_invalid";
export type ProjectCapabilityBindings = {
  nestedSchemas: Array<{ id: string; engine: "nested-schema-v1"; match: Record<string, unknown>; manifest: string }>;
  documentContracts: Array<{ id: string; engine: "document-contract-v1"; match: Record<string, unknown>; contract: string; contractSchema: string }>;
  identityPolicies: Array<{ id: string; engine: "identity-policy-v1"; match: Record<string, unknown>; provider: { kind: "embedded-v1" | "declared-key-v1"; field?: string }; protectedIdentityFields: string[] }>;
};
export type ProjectCapabilities = {
  status: ProjectCapabilityStatus;
  projectId: string;
  generation: number;
  manifestDigest: string | null;
  bindings: ProjectCapabilityBindings;
  error?: { code: string; message?: string; details?: unknown };
};
export type LoadedNestedSchemaCapabilities = {
  projectId: string;
  generation: number;
  bindings: Array<{ id: string; match: Record<string, unknown>; definition: unknown }>;
};
export type RunEntryActionRequest = {
  projectId: string;
  actionId: string;
  sourcePath: string;
  collectionPath: string;
  rowId?: string | null;
  sourceRowIndex: number;
  expectedRowDigest?: string;
  idempotencyKey: string;
};
export type StartedEntryActionResponse = {
  ok: true;
  status: "started" | "completed";
  runId: string;
  handoffPath: string;
  outputPath?: string | null;
  message?: string | null;
};
export type PendingEntryActionPromotionResponse = {
  ok: true;
  status: "promotion_pending";
  pendingActionToken: string;
  receipt: { durableId: string; documentEtag: string; canonicalRowDigest: string };
  root: unknown;
  format: string;
  documentEtag: string;
};
export type RunEntryActionResponse = StartedEntryActionResponse | PendingEntryActionPromotionResponse;
export type EntryActionRunResult = {
  version?: number;
  runId: string;
  actionId?: string | null;
  createdAt?: string | null;
  startedAt?: string | null;
  phase: "queued" | "running" | "proposal_ready" | "committing" | "terminal";
  outcome?: "completed_with_writeback" | "completed_without_changes" | "conflicted" | "rejected" | "failed" | "timed_out" | "failed_needs_recovery" | null;
  /** @deprecated The legacy protocol remains readable only for historical artifacts. */
  finishedAt?: string;
  outputPath?: string | null;
  reason?: string | null;
  message?: string | null;
  artifacts?: Record<"proposal" | "reply" | "diagnostics", { path: string; available: boolean }>;
  writebackCheck?: {
    available: boolean;
    fileChanged: boolean;
    targetRowChanged: boolean;
    changedFields: string[];
    reason?: string;
  };
};

export type EntryActionOutput = {
  runId: string;
  output: string;
};

export type LoadLatestEntryActionResultRequest = {
  actionId: string;
  sourcePath: string;
  collectionPath: string;
  rowId?: string | null;
  sourceRowIndex?: number | null;
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
type DocumentRequestOptions = {
  refresh?: boolean;
};
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
  overrides?: Partial<Record<"hidden" | "wrapped" | "order" | "detailOrder", boolean>>;
};
export type SidebarTreePreferences = {
  childOrderByParent: Record<string, string[]>;
  expandedNodeIds: string[];
};
export type SharedViewCollaborationMode = "team" | "personal";
export type UserViewProfile = {
  sidebarWidth: number | null;
  detailPanelWidth: number | null;
  detailDocumentPanelOpen: boolean | null;
  detailDocumentPanelWidth: number | null;
  favoriteSharedViewIconIds?: SharedViewIconId[];
  fileOrder: string[];
  sidebarTree: SidebarTreePreferences;
  lastActiveViews: Record<string, string>;
  viewDrafts: Record<string, Record<string, Partial<CollectionView>>>;
  viewOrderDrafts: Record<string, string[]>;
  structureDrafts?: Record<string, SharedViewStructureDraft>;
  sharedViewCollaborationMode?: SharedViewCollaborationMode;
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
    | { kind: "group"; groupId: string; name?: string; icon?: SharedViewIconId; viewIds: string[] }
  >;
};
type TablerSharedViewIconId = (typeof import("../generated/tabler-shared-view-icons.mjs").tablerSharedViewIconIds)[number];
type StreamlineSharedViewIconId = (typeof import("../generated/streamline-shared-view-icons.mjs").streamlineSharedViewIconIds)[number];
export type SharedViewIconId =
  | "borderAll"
  | TablerSharedViewIconId
  | StreamlineSharedViewIconId
  | "folder"
  | "folders"
  | "folderOpen"
  | "bookmark"
  | "bookmarkStack"
  | "book"
  | "star"
  | "stars"
  | "search"
  | "settings"
  | "mapPin"
  | "json"
  | "edit"
  | "list"
  | "listCheck"
  | "listDetails"
  | "calendar"
  | "calendarEvent"
  | "clock"
  | "flag"
  | "bell"
  | "briefcase"
  | "tag"
  | "table"
  | "layoutGrid"
  | "database"
  | "file"
  | "files"
  | "fileText"
  | "fileCode"
  | "fileAnalytics"
  | "tags"
  | "filter"
  | "filters"
  | "home"
  | "home2"
  | "building"
  | "school"
  | "hospital"
  | "heart"
  | "mug"
  | "bottle"
  | "apple"
  | "pizza"
  | "salad"
  | "car"
  | "bus"
  | "bike"
  | "motorbike"
  | "plane"
  | "shoppingCart"
  | "gift"
  | "mail"
  | "phone"
  | "camera"
  | "world"
  | "cloud"
  | "bed"
  | "bath"
  | "bulb"
  | "gamepad"
  | "gamepad2"
  | "gamepad3"
  | "puzzle"
  | "cards"
  | "layoutCards"
  | "dice"
  | "chess"
  | "chessKing"
  | "chessQueen"
  | "chessKnight"
  | "chessBishop"
  | "chessRook"
  | "crown"
  | "sparkles"
  | "sparkles2"
  | "shield"
  | "shieldCheck"
  | "shieldCheckered"
  | "shieldHalf"
  | "shieldLock"
  | "bolt"
  | "flame"
  | "bomb"
  | "sword"
  | "swords"
  | "axe"
  | "hammer"
  | "wand"
  | "helmet"
  | "backpack"
  | "archeryArrow"
  | "shieldBolt"
  | "targetArrow"
  | "arrowBigRight"
  | "arrowBigLeft"
  | "arrowBigUp"
  | "arrowBigDown"
  | "spider"
  | "biohazard"
  | "radioactive"
  | "bone"
  | "bug"
  | "alertCircle"
  | "alertHexagon"
  | "alertOctagon"
  | "alertSquare"
  | "alertSquareRounded"
  | "alertTriangle"
  | "bow"
  | "blade"
  | "flask"
  | "flask2"
  | "cross"
  | "medicalCross"
  | "heartBroken"
  | "droplet"
  | "dropletHalf"
  | "dropletHalf2"
  | "droplets"
  | "sunHigh"
  | "sunLow"
  | "sunrise"
  | "sunset"
  | "meteor"
  | "atom2"
  | "mushroom"
  | "clover"
  | "yinYang"
  | "pennant"
  | "compass"
  | "moon"
  | "sun"
  | "alien"
  | "ghost"
  | "ghost2"
  | "ghost3"
  | "ufo"
  | "user"
  | "campfire"
  | "mountain"
  | "library"
  | "libraryPlus"
  | "palette"
  | "paint"
  | "toolsKitchen2"
  | "key"
  | "circleKey"
  | "lock"
  | "archive"
  | "asset"
  | "container"
  | "basket"
  | "giftCard"
  | "ticket"
  | "briefcase2"
  | "badge"
  | "badges"
  | "award"
  | "rosette"
  | "laurel"
  | "trophy"
  | "diamond"
  | "diamonds"
  | "coin"
  | "fileStar"
  | "tagsField"
  | "refresh"
  ;
export type SharedViewLeafItem = {
  kind: "view";
  icon?: SharedViewIconId;
  view: CollectionView;
};
export type SharedViewGroupItem = {
  kind: "group";
  id: string;
  name: string;
  icon?: SharedViewIconId;
  views: SharedViewLeafItem[];
};
export type SharedViewItem = SharedViewLeafItem | SharedViewGroupItem;
export type SharedViewsConfig = {
  version: 1;
  collections: Record<string, { items: SharedViewItem[]; defaultViewId: string | null }>;
};

function createKeepaliveJsonRequest(payload: unknown) {
  const body = JSON.stringify(payload);
  const keepalive = typeof TextEncoder !== "undefined"
    ? new TextEncoder().encode(body).byteLength <= 60_000
    : body.length <= 60_000;
  return { body, keepalive };
}

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

export async function loadDocument(path: string, projectId?: string | null): Promise<DocumentModel> {
  return fetchJson(withProjectId(`/api/document?path=${encodeURIComponent(path)}`, projectId));
}

export async function loadProjectCapabilities(projectId?: string | null): Promise<ProjectCapabilities> {
  return fetchJson(withProjectId("/api/project-capabilities", projectId));
}

export async function loadNestedSchemaCapabilities(projectId?: string | null): Promise<LoadedNestedSchemaCapabilities> {
  return fetchJson(withProjectId("/api/nested-schema-capabilities", projectId));
}

export async function loadDocumentContracts(projectId: string, path: string) {
  return fetchJson(`/api/document-contracts?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent(path)}`);
}

export async function saveDocument(path: string, root: unknown, projectId?: string | null, documentEtag?: string, idempotencyKey = createSaveIdempotencyKey()): Promise<SaveDocumentResult> {
  const result = await saveDocumentsWith(
    [{ path, root }],
    (savePath: string, saveRoot: unknown, contractGate: Record<string, unknown>) => (
      postDocumentSave(savePath, saveRoot, projectId, contractGate, documentEtag, idempotencyKey)
    ),
    { projectId, loadDocumentContracts },
  );
  if (!result.ok) throw saveDocumentsError(result);
  return { ok: true, documentEtag: result.documentEtags?.[path] };
}

function postDocumentSave(
  path: string,
  root: unknown,
  projectId?: string | null,
  contractGate: Record<string, unknown> = {},
  documentEtag?: string,
  idempotencyKey?: string,
): Promise<SaveDocumentResult> {
  return fetchJson("/api/save", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId, path, root, ...(contractGate ?? {}), ...(documentEtag ? { documentEtag } : {}), ...(idempotencyKey ? { idempotencyKey } : {}) }),
  });
}

export async function saveDocuments(items: PendingDocumentSave[], projectId?: string | null): Promise<SaveDocumentsResult> {
  return saveDocumentsWith(
    items,
    (path: string, root: unknown, contractGate: Record<string, unknown>, documentEtag: string, idempotencyKey: string) => (
      postDocumentSave(path, root, projectId, contractGate, documentEtag, idempotencyKey)
    ),
    { projectId, loadDocumentContracts },
  );
}

function saveDocumentsError(result: SaveDocumentsResult) {
  const error = new Error(result.errorMessage ?? "Document save failed.");
  Object.assign(error, { code: result.errorCode, field: result.errorField });
  return error;
}

export async function loadViewConfig(projectId?: string | null): Promise<ViewConfig> {
  return normalizeFetchedViewConfig(await fetchJson(withProjectId("/api/view-config", projectId))) as ViewConfig;
}

export async function loadDocumentIndex(path: string, projectId?: string | null, options?: DocumentRequestOptions): Promise<DocumentIndexResponse> {
  return fetchJson(withProjectId(buildDocumentRequestPath("/api/document-index", path, options), projectId));
}

export async function loadDocumentContent(path: string, id: string, projectId?: string | null, options?: DocumentRequestOptions): Promise<DocumentContentResponse> {
  return fetchJson(withProjectId(buildDocumentRequestPath("/api/document-content", path, options, id), projectId));
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
  const { body, keepalive } = createKeepaliveJsonRequest({ projectId, config });
  return fetchJson("/api/shared-views", {
    method: "POST",
    keepalive,
    headers: { "content-type": "application/json" },
    body,
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

function buildDocumentRequestPath(basePath: string, path: string, options?: DocumentRequestOptions, id?: string) {
  const searchParams = new URLSearchParams({ path });
  if (id) searchParams.set("id", id);
  if (options?.refresh === true) searchParams.set("refresh", "1");
  return `${basePath}?${searchParams.toString()}`;
}

export async function loadAutomationProfile(projectId?: string | null): Promise<UserAutomationProfile> {
  return normalizeFetchedAutomationProfile(await fetchJson(withProjectId("/api/automation-profile", projectId))) as UserAutomationProfile;
}

export async function saveAutomationProfile(profile: UserAutomationProfile, projectId?: string | null) {
  return fetchJson("/api/automation-profile", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId, profile: normalizeFetchedAutomationProfile(profile), ...(profile.etag ? { etag: profile.etag } : {}) }),
  });
}

export async function loadAutomationBindings(projectId?: string | null): Promise<DeviceEntryActionBindings> {
  return normalizeFetchedAutomationBindings(await fetchJson(withProjectId("/api/automation-bindings", projectId)));
}

export async function loadAutomationSkillCatalog(projectId?: string | null): Promise<AutomationSkillCatalog> {
  return fetchJson(withProjectId("/api/automation-skill-catalog", projectId));
}

export async function saveAutomationBindings(bindings: DeviceEntryActionBindings, projectId?: string | null) {
  return fetchJson("/api/automation-bindings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId, bindings }),
  });
}

export async function validateAutomationBindings(bindings: DeviceEntryActionBindings, projectId?: string | null) {
  return fetchJson("/api/automation-bindings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId, bindings, validateOnly: true }),
  });
}

export async function runEntryAction(request: RunEntryActionRequest): Promise<RunEntryActionResponse> {
  return fetchJson("/api/entry-actions/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
}

export async function loadEntryActionResult(runId: string, projectId?: string | null): Promise<EntryActionRunResult> {
  return fetchJson(withProjectId(`/api/entry-actions/result?runId=${encodeURIComponent(runId)}`, projectId));
}

export async function ackStartEntryAction(request: { projectId: string; pendingActionToken: string }): Promise<StartedEntryActionResponse> {
  return fetchJson("/api/entry-actions/ack-start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
}

export async function loadLatestEntryActionResult(
  request: LoadLatestEntryActionResultRequest,
  projectId?: string | null,
): Promise<{ run: EntryActionRunResult | null }> {
  const params = new URLSearchParams({
    actionId: request.actionId,
    sourcePath: request.sourcePath,
    collectionPath: request.collectionPath,
  });
  if (request.rowId) params.set("rowId", request.rowId);
  if (request.sourceRowIndex != null) params.set("sourceRowIndex", String(request.sourceRowIndex));
  return fetchJson(withProjectId(`/api/entry-actions/latest?${params.toString()}`, projectId));
}

export async function loadEntryActionOutput(runId: string, projectId?: string | null): Promise<EntryActionOutput> {
  return fetchJson(withProjectId(`/api/entry-actions/output?runId=${encodeURIComponent(runId)}`, projectId));
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
  return url === "/api/save"
    || url === "/api/view-config"
    || url === "/api/view-profile"
    || url === "/api/automation-profile"
    || url === "/api/automation-bindings";
}

function normalizeFetchedAutomationProfile(value: unknown): UserAutomationProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { rules: [] };
  const rules = Array.isArray((value as { rules?: unknown }).rules) ? (value as { rules: unknown[] }).rules : [];
  return {
    rules: rules.map((rule) => normalizeFetchedEntryActionRule(rule)).filter(Boolean) as EntryActionRule[],
    etag: typeof (value as { etag?: unknown }).etag === "string" ? (value as { etag: string }).etag : null,
  };
}

function normalizeFetchedEntryActionRule(value: unknown): EntryActionRule | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const rule = value as Record<string, unknown>;
  const id = typeof rule.id === "string" ? rule.id.trim() : "";
  if (!id) return null;
  return {
    id,
    label: typeof rule.label === "string" ? rule.label.trim() : "",
    icon: typeof rule.icon === "string" ? rule.icon.trim() as SharedViewIconId : "wand",
    enabled: typeof rule.enabled === "boolean" ? rule.enabled : true,
    targets: normalizeFetchedEntryActionTargets(rule.targets),
    payload: {
      includeRow: typeof (rule.payload as { includeRow?: unknown } | null)?.includeRow === "boolean"
        ? Boolean((rule.payload as { includeRow?: boolean }).includeRow)
        : true,
      includeNeighbors: typeof (rule.payload as { includeNeighbors?: unknown } | null)?.includeNeighbors === "boolean"
        ? Boolean((rule.payload as { includeNeighbors?: boolean }).includeNeighbors)
        : true,
    },
    runtime: normalizeFetchedEntryActionRuntime(rule.runtime),
  };
}

function normalizeFetchedEntryActionRuntime(value: unknown): EntryActionRule["runtime"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const runtime = value as { model?: unknown; reasoning?: unknown; verbosity?: unknown; timeoutMs?: unknown };
  const model = typeof runtime.model === "string" && runtime.model.trim() ? runtime.model.trim() : undefined;
  const reasoning = normalizeFetchedReasoning(runtime.reasoning);
  const verbosity = normalizeFetchedVerbosity(runtime.verbosity);
  const timeoutMs = Number.isInteger(runtime.timeoutMs) && Number(runtime.timeoutMs) > 0
    ? Number(runtime.timeoutMs)
    : undefined;
  if (model == null && reasoning == null && verbosity == null && timeoutMs == null) return undefined;
  return {
    ...(model != null ? { model } : {}),
    ...(reasoning != null ? { reasoning } : {}),
    ...(verbosity != null ? { verbosity } : {}),
    ...(timeoutMs != null ? { timeoutMs } : {}),
  };
}

function normalizeFetchedEntryActionTargets(value: unknown): EntryActionTarget[] {
  if (Array.isArray(value)) {
    return dedupeFetchedEntryActionTargets(value.map((item) => ({
      file: typeof (item as { file?: unknown } | null)?.file === "string" ? (item as { file: string }).file.trim() : "",
      collection: typeof (item as { collection?: unknown } | null)?.collection === "string" ? (item as { collection: string }).collection.trim() : "",
      ...normalizeFetchedTextArtifact((item as { textArtifact?: unknown } | null)?.textArtifact),
    })));
  }
  if (value && typeof value === "object") {
    const legacy = value as { files?: unknown; collections?: unknown };
    const files = normalizeFetchedStringArray(legacy.files);
    const collections = normalizeFetchedStringArray(legacy.collections);
    return dedupeFetchedEntryActionTargets(files.flatMap((file) => collections.map((collection) => ({ file, collection }))));
  }
  return [];
}

function normalizeFetchedTextArtifact(value: unknown): Pick<EntryActionTarget, "textArtifact"> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const artifact = value as Partial<NonNullable<EntryActionTarget["textArtifact"]>>;
  if (typeof artifact.pathTemplate !== "string" || typeof artifact.sourceField !== "string"
    || typeof artifact.allowCreate !== "boolean" || typeof artifact.allowUpdate !== "boolean"
    || !Number.isInteger(artifact.maxBytes) || Number(artifact.maxBytes) < 1) return {};
  return { textArtifact: {
    pathTemplate: artifact.pathTemplate,
    sourceField: artifact.sourceField,
    allowCreate: artifact.allowCreate,
    allowUpdate: artifact.allowUpdate,
    maxBytes: Number(artifact.maxBytes),
  } };
}

function normalizeFetchedStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => typeof item === "string" ? item.trim() : "")
    .filter(Boolean);
}

function dedupeFetchedEntryActionTargets(value: EntryActionTarget[]) {
  const seen = new Set<string>();
  return value.filter((target) => {
    if (!target.file || !target.collection) return false;
    const key = `${target.file}\u0000${target.collection}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeFetchedAutomationBindings(value: unknown): DeviceEntryActionBindings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { defaults: {}, bindings: {} };
  }
  const raw = value as {
    defaults?: { model?: unknown; reasoning?: unknown; verbosity?: unknown; timeoutMs?: unknown };
    bindings?: Record<string, EntryActionBinding>;
    bindingStatuses?: DeviceEntryActionBindings["bindingStatuses"];
  };
  const model = typeof raw.defaults?.model === "string" && raw.defaults.model.trim() ? raw.defaults.model.trim() : undefined;
  const reasoning = normalizeFetchedReasoning(raw.defaults?.reasoning);
  const verbosity = normalizeFetchedVerbosity(raw.defaults?.verbosity);
  const timeoutMs = Number.isInteger(raw.defaults?.timeoutMs) && Number(raw.defaults?.timeoutMs) > 0
    ? Number(raw.defaults?.timeoutMs)
    : undefined;
  return {
    defaults: {
      ...(model != null ? { model } : {}),
      ...(reasoning != null ? { reasoning } : {}),
      ...(verbosity != null ? { verbosity } : {}),
      ...(timeoutMs != null ? { timeoutMs } : {}),
    },
    bindings: raw.bindings && typeof raw.bindings === "object" ? raw.bindings : {},
    bindingStatuses: raw.bindingStatuses,
  };
}

function normalizeFetchedReasoning(value: unknown): EntryActionReasoning | undefined {
  return typeof value === "string" && ["none", "low", "medium", "high", "xhigh"].includes(value.trim())
    ? value.trim() as EntryActionReasoning
    : undefined;
}

function normalizeFetchedVerbosity(value: unknown): EntryActionVerbosity | undefined {
  return typeof value === "string" && ["low", "medium", "high"].includes(value.trim())
    ? value.trim() as EntryActionVerbosity
    : undefined;
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
  if (!res.ok) {
    const error = new Error(data.error ?? `HTTP ${res.status}`);
    Object.assign(error, {
      code: typeof data.code === "string" ? data.code : null,
      field: typeof data.field === "string" ? data.field : null,
      status: res.status,
      details: data.details ?? null,
    });
    throw error;
  }
  return data;
}

function withProjectId(url: string, projectId?: string | null) {
  if (!projectId) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}projectId=${encodeURIComponent(projectId)}`;
}
