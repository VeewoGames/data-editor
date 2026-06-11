import { Profiler, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { flushSync } from "react-dom";
import * as Dialog from "@radix-ui/react-dialog";
import * as Select from "@radix-ui/react-select";
import {
  checkEditorHealth,
  checkRecoveryBridgeHealth,
  activateProject,
  createProject,
  listFiles,
  listProjects,
  listViewProfiles,
  loadDocument,
  loadViewConfig,
  loadSharedViews,
  loadViewProfile,
  recoverableRequestEventName,
  reopenEditor,
  rebuildFrontend,
  saveDocument,
  saveDocuments,
  saveSharedViews,
  shutdownServer,
  saveViewConfig,
  saveViewProfile,
  updateProject,
  type DataFile,
  type ProjectDefinition,
  type SaveDocumentsResult,
  type CollectionView,
  type FilterGroup,
  type SharedViewsConfig,
  type SortRule,
  type SidebarTreePreferences,
  type UserViewLayoutState,
  type UserViewProfile,
  type ViewConfig,
} from "./api/client";
import { Sidebar } from "./components/Sidebar";
import { Toolbar, type ToolbarSnapshot } from "./components/Toolbar";
import { ViewTabs, type ViewTabsSnapshot } from "./components/ViewTabs";
import { ViewFilterBar, type ViewFilterBarSnapshot } from "./components/ViewFilterBar";
import type { ActiveTextEditorHandle, ActiveTextEditorRegistrar } from "./editing";
import { RelationConfigDialog } from "./components/RelationConfigDialog";
import { PrimaryKeyCandidateBanner } from "./components/PrimaryKeyCandidateBanner";
import { icons } from "./components/icons";
import type { OptionFieldDraftCommit } from "./table/OptionFieldEditor";
import { DataTable, type FieldConfig, type TableFieldConfig, type TableSnapshot } from "./table/DataTable";
import { DetailPanel, type DetailSnapshot } from "./detail/DetailPanel";
import { buildDetailSelectionState, resolveDetailSelectionSync } from "./detail/selection-state.mjs";
import { stabilizeViewResult } from "./view/stable-view-result.mjs";
import { buildStableViewEngineRows } from "./view/stable-view-engine-rows.mjs";
import type { DataRecord, DocumentModel } from "./model/documentModel";
import { addField, addRow, buildDocumentModel, deleteField, deleteRow, getMainColumns, getNestedFields, getRows, setCellValue } from "./model/documentModel";
import type { FieldDisplayType } from "./model/fieldTypes";
import { defaultTypeFor, isCompatible } from "./model/fieldTypes";
import type { RelationOption } from "./model/relations";
import { buildRelationLookupState } from "./model/relation-lookup.mjs";
import { buildBacklinkLookupState } from "./model/backlink-lookup.mjs";
import { buildMaintenanceLookupState } from "./model/maintenance-lookup.mjs";
import { resolveRelationTargetSelection } from "./model/relation-target-lookup.mjs";
import {
  buildPrimaryKeySyncSaveSnapshot,
  describePrimaryKeySyncBlockingIssues,
  describePrimaryKeySyncSaveResult,
} from "./model/primary-key-sync-save.mjs";
import type { PrimaryKeySyncSaveSnapshot } from "./model/primary-key-sync-save";
import { buildRelationKey } from "./model/relationPath";
import { parseRelationKey, type PrimaryKeyImpact, type PrimaryKeySyncPlan, type RelationBacklink } from "./model/relationMaintenance";
import { deriveBacklinkConfigs, syncBacklinksWithRelations } from "./model/fieldRole";
import { analyzePrimaryKeyCandidates, buildCollectionKey, type FilteredPrimaryKeyCandidate, type PrimaryKeyCandidate, type PrimaryKeyCandidateAnalysis } from "./model/primaryKeyCandidate";
import { findTitleField, getRecordTitle } from "./model/titleField";
import type { BacklinkGridColumn } from "./model/backlinkGrid";
import type { BacklinkConfig, FieldViewConfig, MultiSelectOptionColor, MultiSelectOptionView, RealFieldType, RelationConfig } from "./model/viewConfig";
import { currentRelationsVersion, defaultBacklinkConfigs, defaultPrimaryKeys, defaultRelationConfigs } from "./relation-defaults.mjs";
import { normalizeFileOrder } from "./file-order.mjs";
import {
  buildOptionConfigFromOptions,
  removeMultiSelectOptionFromRows,
  removeSingleSelectOptionFromRows,
  renameMultiSelectOptionInRows,
  renameSingleSelectOptionInRows,
} from "./multiselect-config.mjs";
import {
  buildScrollContextKey,
  readPageContextState,
  readProjectPageContext,
  writePageContextState,
  updatePageContextScroll,
  updatePageContextSelection,
  type ProjectPageContextState,
} from "./page-context-storage";
import {
  applyLocalPathMigrations,
  applyPageContextPathMigrations,
  applyProfilePathMigrations,
  applyViewConfigPathMigrations,
  detectPathMigrations,
  migrateFingerprintCache,
  readFingerprintCache,
  rewriteSharedViewsConfig,
  updateFingerprintCache,
  writeFingerprintCache,
} from "./path-migration.mjs";
import {
  copyViewLayoutState,
  emptyLocalViewState,
  emptyViewLayoutState,
  deleteLocalViewState,
  readLocalFileOrder,
  readViewLayoutState,
  readLocalSharedViewDrafts,
  readLocalViewState,
  writeLocalFileOrder,
  writeLocalSharedViewDrafts,
  resetViewLayoutState,
  writeLocalViewState,
} from "./view-state-storage.mjs";
import {
  cloneUiPreferences,
  defaultUiPreferences,
  normalizeUiPreferences,
  readLocalUiPreferences,
  writeLocalUiPreferences,
  type UiPreferences,
  type UiTheme,
} from "./ui-preferences";
import { createDefaultFilterRule, withRules } from "./view/filter-rules.mjs";
import { updateHeaderSorts } from "./view/sorting.mjs";
import { runView } from "./view/view-engine.mjs";
import type { ViewEngineRow, ViewInput, ViewResult } from "./view/contracts";
import { buildValidationSnapshot, patchValidationSnapshotForField, patchValidationSnapshotForRowField } from "./validation/issue-map.mjs";
import type { ValidationFieldConfig as ValidationFieldConfigType, ValidationRuleConfig as ValidationRuleConfigType, ValidationSnapshot as ValidationSnapshotType } from "./validation/issue-map";
import { createSaveCoordinator, type AutosaveDomain, type AutosaveState } from "./save-coordinator";
import { buildDocumentStore, type CollectionStore, type DocumentStore, type TableRowView } from "./model/document-store";
import { addFieldByRowId, deleteRowByRowId, setCellValueByRowId } from "./model/writeback-adapter";
import { applySidebarTreePreferences, buildSidebarTree, buildSidebarTreePreferences, findSidebarFallbackFilePath } from "./sidebar-tree.mjs";
import {
  applyViewOrderDraft,
  collectionConfigKey,
  createSharedViewConfig,
  deleteSharedViewConfig,
  draftSharedViewOrder,
  hasViewDraft,
  mergeSharedViewWithDraft,
  renameSharedViewConfig,
  resetActiveSharedViewDraft,
  resolveActiveView,
  resolveCollectionViews,
  resolveDefaultViewId,
  saveSharedViewDraftsToConfig,
} from "./view/view-state.mjs";

type ServiceLifecycleState = "running" | "closed" | "recovering" | "disconnected" | "recoveredPendingReload" | "bridgeUnavailable";
type SharedViewDraftState = Pick<UserViewProfile, "lastActiveViews" | "viewDrafts" | "viewOrderDrafts">;
type SidebarTreeNodeLike = {
  id: string;
  kind: string;
  file?: DataFile;
  filePath?: string;
  children?: SidebarTreeNodeLike[];
};
type DeferredTaskHandle = { kind: "idle"; id: number } | { kind: "timeout"; id: number } | null;
const defaultRecoveryBridgePort = 8791;
const detailReorderReactProfilingStorageKey = "data-editor:enable-detail-reorder-profiling";
const emptyFilterGroup: FilterGroup = { op: "and", rules: [] };
const emptySortRules: SortRule[] = [];
const buildDocumentStoreTyped = buildDocumentStore as (input: {
  documentId: string;
  model: DocumentModel;
  previousStore?: DocumentStore | null;
}) => DocumentStore;
const runViewTyped = runView as (input: ViewInput) => ViewResult;
const sidebarTreePrefsStorageKey = "data-editor:__sidebar-tree-prefs";

function markPerf(name: string) {
  if (typeof performance === "undefined" || typeof performance.mark !== "function") return;
  performance.mark(name);
}

function measurePerf(name: string, start: string, end: string) {
  if (typeof performance === "undefined" || typeof performance.measure !== "function") return;
  try {
    performance.measure(name, start, end);
  } catch {
    // Ignore missing marks during ad-hoc profiling.
  }
}

function recordPerfDuration(name: string, duration: number) {
  if (typeof performance === "undefined" || typeof performance.measure !== "function") return;
  try {
    performance.measure(name, {
      start: Math.max(0, performance.now() - duration),
      duration,
    });
  } catch {
    // Ignore unsupported measure options during ad-hoc profiling.
  }
}

function scheduleDeferredTask(handleRef: { current: DeferredTaskHandle }, task: () => void, timeoutMs = 120) {
  cancelDeferredTask(handleRef.current);
  if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
    const idleId = window.requestIdleCallback(() => {
      handleRef.current = null;
      task();
    }, { timeout: timeoutMs });
    handleRef.current = { kind: "idle", id: idleId };
    return;
  }
  const timeoutId = window.setTimeout(() => {
    handleRef.current = null;
    task();
  }, timeoutMs);
  handleRef.current = { kind: "timeout", id: timeoutId };
}

function cancelDeferredTask(handle: DeferredTaskHandle) {
  if (!handle || typeof window === "undefined") return;
  if (handle.kind === "idle" && typeof window.cancelIdleCallback === "function") {
    window.cancelIdleCallback(handle.id);
    return;
  }
  if (handle.kind === "timeout") {
    window.clearTimeout(handle.id);
  }
}

function readRawLocalSidebarTreePreferences(localStorage: Storage) {
  const rawValue = localStorage.getItem(sidebarTreePrefsStorageKey);
  if (!rawValue) return undefined;
  try {
    const parsed = JSON.parse(rawValue);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function writeStoredLocalSidebarTreePreferences(localStorage: Storage, value: unknown) {
  const normalized = cloneSidebarTreePreferences(value);
  const explicitExpandedNodeIds = hasExplicitExpandedNodeIds(value);
  if (Object.keys(normalized.childOrderByParent).length === 0 && !explicitExpandedNodeIds) {
    localStorage.removeItem(sidebarTreePrefsStorageKey);
    return;
  }
  localStorage.setItem(sidebarTreePrefsStorageKey, JSON.stringify(serializeSidebarTreeState(normalized, explicitExpandedNodeIds)));
}

type PathMigration = {
  oldPath: string;
  newPath: string;
  reason: "file-move" | "folder-move" | "rename";
  confidence: "high";
};

type PathRewriteContext = {
  collectionPathsByFile: Record<string, string[]>;
  viewIdsByCollectionKey: Record<string, string[]>;
};

function addUniqueRecordValue(record: Record<string, string[]>, key: string, value: string) {
  if (!key || !value) return;
  record[key] ??= [];
  if (!record[key].includes(value)) record[key].push(value);
}

function addCollectionKeyToRewriteContext(context: PathRewriteContext, collectionKey: string | null | undefined, viewIds: string[] = []) {
  if (!collectionKey) return;
  const separatorIndex = collectionKey.indexOf(":");
  if (separatorIndex <= 0) return;
  const filePath = collectionKey.slice(0, separatorIndex);
  const collectionPath = collectionKey.slice(separatorIndex + 1);
  if (!filePath || !collectionPath) return;
  addUniqueRecordValue(context.collectionPathsByFile, filePath, collectionPath);
  for (const viewId of viewIds) addUniqueRecordValue(context.viewIdsByCollectionKey, collectionKey, viewId);
}

function collectViewIdsFromSharedViews(sharedViewsConfig: SharedViewsConfig, collectionKey: string) {
  const collection = sharedViewsConfig.collections?.[collectionKey];
  return [
    "all",
    collection?.defaultViewId ?? "",
    ...(collection?.views ?? []).map((view) => view.id),
  ].filter(Boolean);
}

function collectCollectionKeyMapContext(context: PathRewriteContext, keys: Iterable<string>, viewIdsByKey?: Record<string, string[]>) {
  for (const key of keys) addCollectionKeyToRewriteContext(context, key, viewIdsByKey?.[key] ?? []);
}

function collectLocalStorageViewIds(context: PathRewriteContext, localStorage: Storage) {
  for (const collectionKey of Object.keys(context.viewIdsByCollectionKey)) {
    const prefix = `data-editor:${collectionKey}:`;
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      const encodedViewId = rest.split(":")[0];
      if (!encodedViewId) continue;
      try {
        addUniqueRecordValue(context.viewIdsByCollectionKey, collectionKey, decodeURIComponent(encodedViewId));
      } catch {
        addUniqueRecordValue(context.viewIdsByCollectionKey, collectionKey, encodedViewId);
      }
    }
  }
}

function isLocalViewStoragePayload(parts: string[]) {
  if (parts.length === 1) return parts[0] === "__order" || parts[0] === "__detail-order";
  return ["width", "hidden", "wrapped"].includes(parts.at(-1) ?? "");
}

function collectLocalOnlyViewLayoutContext(context: PathRewriteContext, migrations: PathMigration[], localStorage: Storage) {
  for (const migration of migrations) {
    const prefix = `data-editor:${migration.oldPath}:`;
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const parts = key.slice(prefix.length).split(":");
      for (let viewIdIndex = 1; viewIdIndex < parts.length; viewIdIndex += 1) {
        const payloadParts = parts.slice(viewIdIndex + 1);
        if (!isLocalViewStoragePayload(payloadParts)) continue;
        const collectionPath = parts.slice(0, viewIdIndex).join(":");
        const encodedViewId = parts[viewIdIndex];
        if (!collectionPath || !encodedViewId) continue;
        const collectionKey = `${migration.oldPath}:${collectionPath}`;
        addCollectionKeyToRewriteContext(context, collectionKey);
        try {
          addUniqueRecordValue(context.viewIdsByCollectionKey, collectionKey, decodeURIComponent(encodedViewId));
        } catch {
          addUniqueRecordValue(context.viewIdsByCollectionKey, collectionKey, encodedViewId);
        }
      }
    }
  }
}

function buildPathRewriteContext(input: {
  migrations: PathMigration[];
  viewConfig: ViewConfig;
  sharedViewsConfig: SharedViewsConfig;
  profile: UserViewProfile | null;
  localSharedViewDrafts: SharedViewDraftState;
  pageContext: ReturnType<typeof readProjectPageContext>;
  localStorage: Storage;
}) {
  const context: PathRewriteContext = { collectionPathsByFile: {}, viewIdsByCollectionKey: {} };
  for (const migration of input.migrations) {
    context.collectionPathsByFile[migration.oldPath] = [];
    context.viewIdsByCollectionKey[`${migration.oldPath}:$`] = ["all"];
  }

  for (const collectionKey of Object.keys(input.sharedViewsConfig.collections ?? {})) {
    addCollectionKeyToRewriteContext(context, collectionKey, collectViewIdsFromSharedViews(input.sharedViewsConfig, collectionKey));
  }
  collectCollectionKeyMapContext(context, Object.keys(input.viewConfig.primaryKeys ?? {}));
  collectCollectionKeyMapContext(context, Object.keys(input.profile?.lastActiveViews ?? {}), input.profile?.lastActiveViews ? Object.fromEntries(Object.entries(input.profile.lastActiveViews).map(([key, viewId]) => [key, [viewId]])) : undefined);
  collectCollectionKeyMapContext(context, Object.keys(input.profile?.viewDrafts ?? {}), Object.fromEntries(Object.entries(input.profile?.viewDrafts ?? {}).map(([key, views]) => [key, Object.keys(views ?? {})])));
  collectCollectionKeyMapContext(context, Object.keys(input.profile?.viewOrderDrafts ?? {}), input.profile?.viewOrderDrafts);
  collectCollectionKeyMapContext(context, Object.keys(input.profile?.viewLayouts ?? {}), Object.fromEntries(Object.entries(input.profile?.viewLayouts ?? {}).map(([key, views]) => [key, Object.keys(views ?? {})])));
  collectCollectionKeyMapContext(context, Object.keys(input.profile?.collections ?? {}));
  collectCollectionKeyMapContext(context, Object.keys(input.localSharedViewDrafts.lastActiveViews ?? {}), Object.fromEntries(Object.entries(input.localSharedViewDrafts.lastActiveViews ?? {}).map(([key, viewId]) => [key, [viewId]])));
  collectCollectionKeyMapContext(context, Object.keys(input.localSharedViewDrafts.viewDrafts ?? {}), Object.fromEntries(Object.entries(input.localSharedViewDrafts.viewDrafts ?? {}).map(([key, views]) => [key, Object.keys(views ?? {})])));
  collectCollectionKeyMapContext(context, Object.keys(input.localSharedViewDrafts.viewOrderDrafts ?? {}), input.localSharedViewDrafts.viewOrderDrafts);

  if (input.pageContext.selectedPath && input.pageContext.collectionPath) {
    addCollectionKeyToRewriteContext(context, `${input.pageContext.selectedPath}:${input.pageContext.collectionPath}`);
  }
  collectLocalOnlyViewLayoutContext(context, input.migrations, input.localStorage);
  collectLocalStorageViewIds(context, input.localStorage);
  return context;
}

async function sha256Text(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hashBuffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function buildSchemaSignature(root: unknown) {
  if (Array.isArray(root)) {
    const firstRecord = root.find((item) => item && typeof item === "object" && !Array.isArray(item)) as Record<string, unknown> | undefined;
    return `json:array:${Object.keys(firstRecord ?? {}).sort().join(",")}`;
  }
  if (root && typeof root === "object") {
    return `json:object:${Object.keys(root as Record<string, unknown>).sort().join(",")}`;
  }
  return `json:${typeof root}`;
}

function extensionForPath(path: string) {
  const fileName = path.split("/").at(-1) ?? path;
  const index = fileName.lastIndexOf(".");
  return index >= 0 ? fileName.slice(index) : "";
}

async function buildDataFileFingerprint(file: DataFile, projectId: string | null) {
  const model = await loadDocument(file.path, projectId) as DocumentModel;
  const serializedRoot = JSON.stringify(model.root ?? null);
  return {
    path: file.path,
    dataSourceId: file.dataSourceId ?? "default",
    extension: extensionForPath(file.path),
    size: file.size,
    modifiedAt: file.modifiedAt,
    contentHash: await sha256Text(serializedRoot),
    schemaSignature: buildSchemaSignature(model.root),
  };
}

async function refreshFingerprintCacheForFiles(cache: unknown, files: DataFile[], projectId: string | null) {
  const normalizedCache = (cache ?? {}) as { version?: number; files?: Record<string, { size: number; modifiedAt: string }> };
  const fingerprints: Array<Awaited<ReturnType<typeof buildDataFileFingerprint>>> = [];
  for (const file of files) {
    const cached = normalizedCache.files?.[file.path];
    if (cached && cached.size === file.size && cached.modifiedAt === file.modifiedAt) continue;
    fingerprints.push(await buildDataFileFingerprint(file, projectId));
  }
  return updateFingerprintCache(cache, files.filter((file) => fingerprints.some((fingerprint: { path: string }) => fingerprint.path === file.path)), fingerprints);
}

export function App() {
  const [files, setFiles] = useState<DataFile[]>([]);
  const [projects, setProjects] = useState<ProjectDefinition[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [model, setModel] = useState<DocumentModel | null>(null);
  const [collectionPath, setCollectionPath] = useState("$");
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);
  const [selectedRowIdState, setSelectedRowIdState] = useState<string | null>(null);
  const [dataDirty, setDataDirty] = useState(false);
  const [viewConfigDirty, setViewConfigDirty] = useState(false);
  const [profileDirty, setProfileDirty] = useState(false);
  const [viewDraftDirty, setViewDraftDirty] = useState(false);
  const [commandSaving, setCommandSaving] = useState(false);
  const [autosaveState, setAutosaveState] = useState<AutosaveState>("idle");
  const [closing, setClosing] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [serviceLifecycleState, setServiceLifecycleState] = useState<ServiceLifecycleState>("running");
  const [disconnectMessage, setDisconnectMessage] = useState("");
  const [flashStatus, setFlashStatus] = useState(() => consumeTransientStatus());
  const [status, setStatus] = useState("");
  const [relationIndexes, setRelationIndexes] = useState<Record<string, Set<string> | null>>({});
  const [dataRevision, bumpDataRevision] = useState(0);
  const [relationOptions, setRelationOptions] = useState<Record<string, RelationOption[]>>({});
  const [relationBacklinks, setRelationBacklinks] = useState<RelationBacklink[]>([]);
  const [backlinkColumns, setBacklinkColumns] = useState<BacklinkGridColumn[]>([]);
  const [backlinkValuesByRowIdState, setBacklinkValuesByRowIdState] = useState<Record<string, Record<string, RelationBacklink[]>>>({});
  const [primaryKeyImpacts, setPrimaryKeyImpacts] = useState<Record<string, PrimaryKeyImpact>>({});
  const [primaryKeySyncPlan, setPrimaryKeySyncPlan] = useState<PrimaryKeySyncPlan | null>(null);
  const [primaryKeySyncDialogOpen, setPrimaryKeySyncDialogOpen] = useState(false);
  const [primaryKeySyncResult, setPrimaryKeySyncResult] = useState<SaveDocumentsResult | null>(null);
  const [addFieldOpen, setAddFieldOpen] = useState(false);
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldType, setNewFieldType] = useState<FieldDisplayType>("Text");
  const [newFieldApplyAll, setNewFieldApplyAll] = useState(false);
  const [pendingDeleteRow, setPendingDeleteRow] = useState<number | null>(null);
  const [pendingDeleteRowId, setPendingDeleteRowId] = useState<string | null>(null);
  const [pendingDeleteField, setPendingDeleteField] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [filterBarVisible, setFilterBarVisible] = useState(true);
  const [tableTextEditMode, setTableTextEditMode] = useState(false);
  const [rowDeleteControlsVisible, setRowDeleteControlsVisible] = useState(false);
  const [pendingOpenFilterRuleId, setPendingOpenFilterRuleId] = useState<string | null>(null);
  const [uiRevision, bumpUiRevision] = useState(0);
  const [layoutRevision, bumpLayoutRevision] = useState(0);
  const [tableRevision, bumpTableRevision] = useState(0);
  const [viewConfig, setViewConfig] = useState<ViewConfig>(emptyProjectViewConfig());
  const [sharedViewsConfig, setSharedViewsConfig] = useState<SharedViewsConfig>(emptySharedViewsConfig());
  const [localSharedViewDrafts, setLocalSharedViewDrafts] = useState<SharedViewDraftState>(() => readLocalSharedViewDrafts(window.localStorage));
  const [viewProfiles, setViewProfiles] = useState<string[]>([]);
  const [selectedViewProfileName, setSelectedViewProfileName] = useState<string | null>(() => localStorage.getItem(selectedViewProfileStorageKey));
  const [selectedViewProfile, setSelectedViewProfile] = useState<UserViewProfile>(emptyUserViewProfile());
  const [uiPreferences, setUiPreferences] = useState<UiPreferences>(() => readLocalUiPreferences(window.localStorage));
  const [scrollRestoreKey, setScrollRestoreKey] = useState<string | null>(null);
  const [initialScrollPosition, setInitialScrollPosition] = useState<{ scrollTop: number; scrollLeft: number } | null>(null);
  const [bridgePort, setBridgePort] = useState(defaultRecoveryBridgePort);
  const [newProfileOpen, setNewProfileOpen] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const [relationConfigField, setRelationConfigField] = useState<string | null>(null);
  const [dismissedCandidateKeys, setDismissedCandidateKeys] = useState<string[]>([]);
  const [primaryKeyCandidateDialogOpen, setPrimaryKeyCandidateDialogOpen] = useState(false);
  const [selectedPrimaryKeyCandidate, setSelectedPrimaryKeyCandidate] = useState<string>("");
  const openRequestRef = useRef(0);
  const maintenanceRequestRef = useRef(0);
  const filesRef = useRef<DataFile[]>([]);
  const activeProjectIdRef = useRef<string | null>(null);
  const modelRef = useRef<DocumentModel | null>(null);
  const savedDocumentRootRef = useRef<unknown | null>(null);
  const selectedPathRef = useRef<string | null>(null);
  const collectionPathRef = useRef("$");
  const selectedRowIdRef = useRef<string | null>(null);
  const selectedSourceRowIndexRef = useRef<number | null>(null);
  const titleFieldRef = useRef<string | null>(null);
  const dataDirtyRef = useRef(false);
  const viewConfigRef = useRef<ViewConfig>(emptyProjectViewConfig());
  const viewConfigDirtyRef = useRef(false);
  const profileDirtyRef = useRef(false);
  const relationIndexRequestRef = useRef(0);
  const backlinkRequestRef = useRef(0);
  const relationWarmupHandleRef = useRef<DeferredTaskHandle>(null);
  const backlinkWarmupHandleRef = useRef<DeferredTaskHandle>(null);
  const deferRelationWarmupRef = useRef(false);
  const deferBacklinkWarmupRef = useRef(false);
  const selectedViewProfileNameRef = useRef<string | null>(null);
  const selectedViewProfileRef = useRef<UserViewProfile>(emptyUserViewProfile());
  const bridgePortRef = useRef(defaultRecoveryBridgePort);
  const serviceLifecycleStateRef = useRef<ServiceLifecycleState>("running");
  const detailOpenRef = useRef(false);
  const documentStoreRef = useRef<DocumentStore | null>(null);
  const prebuiltDocumentStoreRef = useRef<{ documentId: string; model: DocumentModel; store: DocumentStore } | null>(null);
  const validationSnapshotRef = useRef<{
    snapshot: ValidationSnapshotType;
    fieldConfig: ValidationFieldConfigType | null;
    ruleConfig: ValidationRuleConfigType | null;
    relationIndexes: Record<string, Set<string> | null> | null;
    sourcePath: string | null;
    collectionPath: string | null;
  } | null>(null);
  const validationInvalidationRef = useRef<
    { type: "full" }
    | { type: "row-field"; rowId: string | null; rowIndex: number | null; fieldName: string }
    | { type: "field"; fieldName: string }
  >({ type: "full" });
  const autoRecoverAttemptedRef = useRef(false);
  const disconnectFlowPromiseRef = useRef<Promise<void> | null>(null);
  const healthFailureCountRef = useRef(0);
  const disconnectConfirmTimerRef = useRef<number | null>(null);
  const manualClosedRef = useRef(false);
  const [sidebarWidth, setSidebarWidth] = useState(() => readSidebarWidth());
  const [detailPanelWidth, setDetailPanelWidth] = useState(() => readDetailPanelWidth());
  const primaryKeySyncSnapshotRef = useRef<PrimaryKeySyncSaveSnapshot | null>(null);
  const primaryKeySyncPlanRef = useRef<PrimaryKeySyncPlan | null>(null);
  const autosaveStateRef = useRef<AutosaveState>("idle");
  const autosaveInFlightRef = useRef(false);
  const commandSavingRef = useRef(false);
  const activeTextEditorRef = useRef<ActiveTextEditorHandle | null>(null);
  const closingRef = useRef(false);
  const rebuildingRef = useRef(false);
  const profileSavePromiseRef = useRef<Promise<void> | null>(null);
  const loadedProjectIdRef = useRef<string | null>(null);
  const viewDraftDirtyRef = useRef(false);
  const detailReorderPerfRef = useRef({
    active: false,
    awaitingRows: false,
    awaitingFieldConfig: false,
    awaitingViewRows: false,
    awaitingIssues: false,
    awaitingBacklinks: false,
    awaitingMaintenance: false,
    awaitingMainContentRender: false,
    awaitingTableRender: false,
    awaitingDetailPanelRender: false,
    awaitingViewTabsRender: false,
    awaitingFilterBarRender: false,
    awaitingPrimaryKeyBannerRender: false,
  });
  const toolbarDirty = dataDirty || viewConfigDirty || profileDirty;
  const globalDirty = toolbarDirty || viewDraftDirty;
  const statusText = status || flashStatus;
  const detailReorderReactProfilingEnabled = typeof window !== "undefined"
    && window.localStorage.getItem(detailReorderReactProfilingStorageKey) === "1";
  const saveCoordinator = useMemo(
    () => createSaveCoordinator({
      delayMs: 800,
      getSnapshot: () => ({
        dirtyDomains: collectAutosaveDirtyDomains(),
      }),
      flush: async (reason, snapshot) => flushAutosaveTargets(reason, snapshot.dirtyDomains),
      onStatusChange: (nextState) => {
        setAutosaveState(nextState);
      },
    }),
    [],
  );
  const registerActiveTextEditor = useCallback<ActiveTextEditorRegistrar>((handle, sourceHandle) => {
    if (!handle) {
      if (!sourceHandle || activeTextEditorRef.current === sourceHandle) {
        activeTextEditorRef.current = null;
      }
      return;
    }
    activeTextEditorRef.current = handle;
  }, []);
  const flushActiveTextEditorDraft = useCallback(() => {
    activeTextEditorRef.current?.flushDraft();
  }, []);
  const selectedCollectionKey = selectedPath ? buildCollectionKey(selectedPath, collectionPath) : null;
  const activeCollectionKey = selectedPath ? collectionConfigKey(selectedPath, collectionPath) : null;
  const activeSidebarPreferences = useMemo(() => (
    resolveActiveSidebarPreferences(files, selectedViewProfileName, selectedViewProfile, window.localStorage)
  ), [files, selectedViewProfileName, selectedViewProfile.sidebarTree, selectedViewProfile.fileOrder, uiRevision]);
  const orderedFiles = useMemo(() => {
    const sidebarTree = applySidebarTreePreferences(buildSidebarTree(files), activeSidebarPreferences.sidebarTree) as SidebarTreeNodeLike[];
    return flattenSidebarTreeFiles(sidebarTree);
  }, [activeSidebarPreferences.sidebarTree, files]);

  useEffect(() => { modelRef.current = model; }, [model]);
  useEffect(() => { filesRef.current = files; }, [files]);
  useEffect(() => { activeProjectIdRef.current = activeProjectId; }, [activeProjectId]);
  useEffect(() => { selectedPathRef.current = selectedPath; }, [selectedPath]);
  useEffect(() => { collectionPathRef.current = collectionPath; }, [collectionPath]);
  useEffect(() => { dataDirtyRef.current = dataDirty; }, [dataDirty]);
  useEffect(() => { viewConfigRef.current = viewConfig; }, [viewConfig]);
  useEffect(() => { viewConfigDirtyRef.current = viewConfigDirty; }, [viewConfigDirty]);
  useEffect(() => { profileDirtyRef.current = profileDirty; }, [profileDirty]);
  useEffect(() => { viewDraftDirtyRef.current = viewDraftDirty; }, [viewDraftDirty]);
  useEffect(() => { selectedViewProfileNameRef.current = selectedViewProfileName; }, [selectedViewProfileName]);
  useEffect(() => { selectedViewProfileRef.current = selectedViewProfile; }, [selectedViewProfile]);
  useEffect(() => { bridgePortRef.current = bridgePort; }, [bridgePort]);
  useEffect(() => { serviceLifecycleStateRef.current = serviceLifecycleState; }, [serviceLifecycleState]);
  useEffect(() => { detailOpenRef.current = detailOpen; }, [detailOpen]);
  useEffect(() => { primaryKeySyncPlanRef.current = primaryKeySyncPlan; }, [primaryKeySyncPlan]);
  useEffect(() => { autosaveStateRef.current = autosaveState; }, [autosaveState]);
  useEffect(() => { commandSavingRef.current = commandSaving; }, [commandSaving]);
  useEffect(() => { closingRef.current = closing; }, [closing]);
  useEffect(() => { rebuildingRef.current = rebuilding; }, [rebuilding]);
  useEffect(() => {
    document.documentElement.dataset.theme = uiPreferences.activeThemeId;
    document.documentElement.dataset.fontSizeBase = String(uiPreferences.baseFontSize);
    document.documentElement.style.setProperty("--font-size-base", `${uiPreferences.baseFontSize}px`);
  }, [uiPreferences]);
  useEffect(() => {
    if (!flashStatus) return;
    window.sessionStorage.removeItem(transientStatusStorageKey);
    const timer = window.setTimeout(() => setFlashStatus(""), 4000);
    return () => window.clearTimeout(timer);
  }, [flashStatus]);
  useEffect(() => {
    if (!selectedCollectionKey) return;
    setDismissedCandidateKeys((current) => current.filter((key) => key !== selectedCollectionKey));
  }, [viewConfig.primaryKeys, selectedCollectionKey]);
  useEffect(() => () => saveCoordinator.cancel(), [saveCoordinator]);

  useEffect(() => {
    listProjects()
      .then((registry) => {
        setProjects(registry.projects);
        setActiveProjectId(registry.activeProjectId);
      })
      .catch((error) => setStatus(error.message));
  }, []);

  useEffect(() => {
    if (!activeProjectId) return;
    const resetProfile = loadedProjectIdRef.current !== null && loadedProjectIdRef.current !== activeProjectId;
    void reloadProjectWorkspace(activeProjectId, { resetProfile });
  }, [activeProjectId]);

  useEffect(() => {
    if (!selectedViewProfileName) {
      setSelectedViewProfile(emptyUserViewProfile());
      localStorage.removeItem(selectedViewProfileStorageKey);
      setSidebarWidth(readSidebarWidth());
      setDetailPanelWidth(readDetailPanelWidth());
      setUiPreferences(readLocalUiPreferences(window.localStorage));
      return;
    }
    localStorage.setItem(selectedViewProfileStorageKey, selectedViewProfileName);
    loadViewProfile(selectedViewProfileName, activeProjectId)
      .then((profile) => {
        const normalizedProfile = normalizeUserViewProfile(profile);
        setSelectedViewProfile(normalizedProfile);
        setUiPreferences(resolveUiPreferences(normalizedProfile.appearance));
        setSidebarWidth(clampSidebarWidth(normalizedProfile.sidebarWidth ?? defaultSidebarWidth));
        setDetailPanelWidth(clampDetailPanelWidth(normalizedProfile.detailPanelWidth ?? defaultDetailPanelWidth));
      })
      .catch((error) => setStatus(error.message));
  }, [selectedViewProfileName, activeProjectId]);

  async function reloadProjectWorkspace(projectId: string, options: { resetProfile?: boolean } = {}) {
    const previousFiles = loadedProjectIdRef.current === projectId ? filesRef.current : [];
    try {
      flushActiveTextEditorDraft();
      await saveCoordinator.flush("flush");
      resetWorkspaceState(options);
      const profileNameForInitialOrder = options.resetProfile ? null : selectedViewProfileNameRef.current;
      const [nextFiles, nextConfig, nextSharedViewsConfig, nextProfiles, nextProfile] = await Promise.all([
        listFiles(projectId),
        loadViewConfig(projectId),
        loadSharedViews(projectId),
        listViewProfiles(projectId),
        profileNameForInitialOrder ? loadViewProfile(profileNameForInitialOrder, projectId) : Promise.resolve(null),
      ]);
      let migratedConfig = nextConfig;
      let migratedSharedViewsConfig = nextSharedViewsConfig;
      let migratedLocalSharedViewDrafts = readLocalSharedViewDrafts(window.localStorage);
      let normalizedInitialProfile = profileNameForInitialOrder ? normalizeUserViewProfile(nextProfile) : null;
      const pageContextState = readPageContextState(window.localStorage);
      let currentPageContext = readProjectPageContext(pageContextState, projectId);
      let fingerprintCache = readFingerprintCache(window.localStorage);
      if (previousFiles.length) {
        const detection = await detectPathMigrations({
          previousFiles,
          nextFiles,
          fingerprintCache,
          readFingerprint: (file: DataFile) => buildDataFileFingerprint(file, projectId),
        });
        const migrations = detection.migrations as PathMigration[];
        if (migrations.length) {
          const context = buildPathRewriteContext({
            migrations,
            viewConfig: migratedConfig,
            sharedViewsConfig: migratedSharedViewsConfig,
            profile: normalizedInitialProfile,
            localSharedViewDrafts: migratedLocalSharedViewDrafts,
            pageContext: currentPageContext,
            localStorage: window.localStorage,
          });
          const profileResult = normalizedInitialProfile
            ? applyProfilePathMigrations(normalizedInitialProfile, migrations, context)
            : null;
          const sharedViewsResult = rewriteSharedViewsConfig(migratedSharedViewsConfig, migrations, context);
          const viewConfigResult = applyViewConfigPathMigrations(migratedConfig, migrations);
          const pageContextResult = applyPageContextPathMigrations(currentPageContext, migrations, context);

          await Promise.all([
            profileResult?.changed && profileNameForInitialOrder
              ? saveViewProfile(profileNameForInitialOrder, profileResult.value as UserViewProfile, projectId)
              : Promise.resolve(),
            sharedViewsResult.changed
              ? saveSharedViews(sharedViewsResult.value as SharedViewsConfig, projectId)
              : Promise.resolve(),
            viewConfigResult.changed
              ? saveViewConfig(viewConfigResult.value as ViewConfig, projectId)
              : Promise.resolve(),
          ]);

          migratedConfig = viewConfigResult.value as ViewConfig;
          migratedSharedViewsConfig = sharedViewsResult.value as SharedViewsConfig;
          normalizedInitialProfile = (profileResult?.value as UserViewProfile | undefined) ?? normalizedInitialProfile;
          const localResult = applyLocalPathMigrations(window.localStorage, migrations, context);
          migratedLocalSharedViewDrafts = readLocalSharedViewDrafts(window.localStorage);
          if (pageContextResult.changed) {
            pageContextState.projects[projectId] = pageContextResult.value as ProjectPageContextState;
            writePageContextState(window.localStorage, pageContextState);
            currentPageContext = pageContextResult.value as ProjectPageContextState;
          }
          const migratedFingerprintCache = migrateFingerprintCache(fingerprintCache, migrations);
          fingerprintCache = migratedFingerprintCache.value;
          writeFingerprintCache(window.localStorage, fingerprintCache);
          if (localResult.changed || viewConfigResult.changed || sharedViewsResult.changed || profileResult?.changed || pageContextResult.changed) {
            setStatus(`已迁移 ${migrations.length} 个移动文件的视图配置。`);
          }
        }
      }
      const refreshedFingerprintCache = await refreshFingerprintCacheForFiles(fingerprintCache, nextFiles, projectId);
      if (refreshedFingerprintCache.changed) writeFingerprintCache(window.localStorage, refreshedFingerprintCache.value);
      setFiles(nextFiles);
      filesRef.current = nextFiles;
      setViewConfig(migratedConfig);
      viewConfigRef.current = migratedConfig;
      setSharedViewsConfig(migratedSharedViewsConfig);
      setLocalSharedViewDrafts(migratedLocalSharedViewDrafts);
      setViewProfiles(nextProfiles);
      if (profileNameForInitialOrder && normalizedInitialProfile && selectedViewProfileNameRef.current === profileNameForInitialOrder) {
        const normalizedProfile = normalizedInitialProfile;
        setSelectedViewProfile(normalizedProfile);
        selectedViewProfileRef.current = normalizedProfile;
        profileDirtyRef.current = false;
        setProfileDirty(false);
        setUiPreferences(resolveUiPreferences(normalizedProfile.appearance));
        setSidebarWidth(clampSidebarWidth(normalizedProfile.sidebarWidth ?? defaultSidebarWidth));
        setDetailPanelWidth(clampDetailPanelWidth(normalizedProfile.detailPanelWidth ?? defaultDetailPanelWidth));
      } else if (!profileNameForInitialOrder) {
        setUiPreferences(readLocalUiPreferences(window.localStorage));
      }
      const sidebarTree = buildResolvedSidebarTree(nextFiles, profileNameForInitialOrder, normalizedInitialProfile, window.localStorage);
      const preferredPath = findSidebarFallbackFilePath(
        sidebarTree,
        currentPageContext.selectedPath ?? selectedPathRef.current,
      );
      loadedProjectIdRef.current = projectId;
      if (preferredPath) {
        const targetCollection = preferredPath === currentPageContext.selectedPath ? currentPageContext.collectionPath : undefined;
        await openDocumentAt(preferredPath, targetCollection, undefined, false, projectId);
      }
      loadedProjectIdRef.current = projectId;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function resetWorkspaceState(options: { resetProfile?: boolean } = {}) {
    openRequestRef.current += 1;
    relationIndexRequestRef.current += 1;
    loadedProjectIdRef.current = null;
    setFiles([]);
    setSelectedPath(null);
    setModel(null);
    savedDocumentRootRef.current = null;
    setCollectionPath("$");
    setSelectedRowIndex(null);
    setSelectedRowIdState(null);
    setDetailOpen(false);
    setDataDirty(false);
    dataDirtyRef.current = false;
    setViewConfigDirty(false);
    viewConfigDirtyRef.current = false;
    setProfileDirty(false);
    profileDirtyRef.current = false;
    setViewDraftDirty(false);
    setScrollRestoreKey(null);
    setInitialScrollPosition(null);
    setAutosaveState("idle");
    autosaveStateRef.current = "idle";
    saveCoordinator.cancel();
    setViewConfig(emptyProjectViewConfig());
    viewConfigRef.current = emptyProjectViewConfig();
    setSharedViewsConfig(emptySharedViewsConfig());
    setLocalSharedViewDrafts(readLocalSharedViewDrafts(window.localStorage));
    setViewProfiles([]);
    if (options.resetProfile) {
      setSelectedViewProfileName(null);
      selectedViewProfileNameRef.current = null;
      setSelectedViewProfile(emptyUserViewProfile());
      selectedViewProfileRef.current = emptyUserViewProfile();
      setUiPreferences(readLocalUiPreferences(window.localStorage));
    }
    setRelationIndexes({});
    setRelationOptions({});
    setRelationBacklinks([]);
    setBacklinkColumns([]);
    setBacklinkValuesByRowIdState({});
    setPrimaryKeyImpacts({});
    setPrimaryKeySyncPlan(null);
    setPrimaryKeySyncDialogOpen(false);
    setPrimaryKeySyncResult(null);
    primaryKeySyncSnapshotRef.current = null;
    setRelationConfigField(null);
    setPendingDeleteRow(null);
    setPendingDeleteField(null);
    setAddFieldOpen(false);
    setDismissedCandidateKeys([]);
    setPrimaryKeyCandidateDialogOpen(false);
  }

  async function selectProject(projectId: string) {
    if (projectId === activeProjectId) return;
    if (globalDirty && !window.confirm("当前项目有未保存改动。放弃改动并切换项目？")) return;
    try {
      flushActiveTextEditorDraft();
      await saveCoordinator.flush("flush");
      await activateProject(projectId);
      setActiveProjectId(projectId);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function saveProjectSettings(project: ProjectDefinition) {
    try {
      const result = await updateProject(project) as { registry?: { projects: ProjectDefinition[]; activeProjectId: string | null } };
      const registry = result.registry ?? await listProjects();
      setProjects(registry.projects);
      setActiveProjectId(registry.activeProjectId);
      if (registry.activeProjectId) await reloadProjectWorkspace(registry.activeProjectId);
      setProjectSettingsOpen(false);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function createProjectFromSettings(input: { name: string; root: string }) {
    try {
      await createProject({ name: input.name, root: input.root, adapter: "nocturnel" });
      const registry = await listProjects();
      setProjects(registry.projects);
      setActiveProjectId(registry.activeProjectId);
      setProjectSettingsOpen(false);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  useEffect(() => {
    function onPageHide() {
      flushActiveTextEditorDraft();
      void saveCoordinator.flush("flush");
    }
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [flushActiveTextEditorDraft, saveCoordinator]);

  useEffect(() => {
    return () => {
      if (disconnectConfirmTimerRef.current != null) {
        window.clearTimeout(disconnectConfirmTimerRef.current);
      }
      cancelDeferredTask(relationWarmupHandleRef.current);
      cancelDeferredTask(backlinkWarmupHandleRef.current);
    };
  }, []);

  useEffect(() => {
    if (deferRelationWarmupRef.current) {
      deferRelationWarmupRef.current = false;
      scheduleDeferredTask(relationWarmupHandleRef, () => {
        void loadRelationIndexes(viewConfig);
      });
      return;
    }
    void loadRelationIndexes(viewConfig);
  }, [viewConfig.relations, selectedPath, model, activeProjectId]);

  useEffect(() => {
    async function syncHealth() {
      try {
        const health = await checkEditorHealth();
        if (Number.isInteger(Number(health.bridgePort)) && Number(health.bridgePort) > 0) {
          setBridgePort(Number(health.bridgePort));
        }
      } catch {}
    }
    void syncHealth();
  }, []);

  useEffect(() => {
    if (deferBacklinkWarmupRef.current) {
      deferBacklinkWarmupRef.current = false;
      scheduleDeferredTask(backlinkWarmupHandleRef, () => {
        void loadBacklinkGridData();
      });
      return;
    }
    void loadBacklinkGridData();
  }, [selectedPath, collectionPath, model, viewConfig.relations, viewConfig.backlinks, viewConfig.primaryKeys, tableRevision]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void persistChanges();
      }
      if (event.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        event.preventDefault();
        document.querySelector<HTMLInputElement>(".search-box input")?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  useEffect(() => {
    function onRecoverableRequest(event: Event) {
      const detail = event instanceof CustomEvent ? event.detail : null;
      if (!detail || typeof detail !== "object") return;
      if ("status" in detail && detail.status !== "failure") {
        healthFailureCountRef.current = 0;
        return;
      }
      const url = "url" in detail ? String(detail.url ?? "") : "";
      if (!isRecoverableNetworkFailureUrl(url)) return;
      const message =
        detail && typeof detail === "object" && "message" in detail ? String(detail.message) : "服务连接已断开";
      scheduleDisconnectConfirmation(message);
    }
    window.addEventListener(recoverableRequestEventName, onRecoverableRequest as EventListener);
    return () => window.removeEventListener(recoverableRequestEventName, onRecoverableRequest as EventListener);
  }, []);

  useEffect(() => {
    if (serviceLifecycleState !== "running") return;
    const timer = window.setInterval(() => {
      void probeEditorHealth();
    }, 12000);
    return () => window.clearInterval(timer);
  }, [serviceLifecycleState]);

  async function flushBeforeDocumentTransition() {
    flushActiveTextEditorDraft();
    const result = await saveCoordinator.flush("flush");
    return result.outcome === "saved" || result.outcome === "idle";
  }

  async function openFile(path: string) {
    if (!(await flushBeforeDocumentTransition())) return;
    await openDocumentAt(path, undefined, undefined, false, activeProjectId);
  }

  async function probeEditorHealth() {
    if (serviceLifecycleStateRef.current !== "running") return;
    try {
      const health = await checkEditorHealth();
      healthFailureCountRef.current = 0;
      if (Number.isInteger(Number(health.bridgePort)) && Number(health.bridgePort) > 0) {
        setBridgePort(Number(health.bridgePort));
      }
    } catch (error) {
      scheduleDisconnectConfirmation(error instanceof Error ? error.message : String(error));
    }
  }

  function isRecoverableNetworkFailureUrl(url: string) {
    if (!url) return true;
    if (url.includes("/api/rebuild") || url.includes("/api/shutdown")) return false;
    return url.startsWith("/api/") || url.includes("/api/health");
  }

  function scheduleDisconnectConfirmation(message: string) {
    if (manualClosedRef.current || serviceLifecycleStateRef.current !== "running") return;
    if (disconnectConfirmTimerRef.current != null) return;
    disconnectConfirmTimerRef.current = window.setTimeout(() => {
      disconnectConfirmTimerRef.current = null;
      void confirmRepeatedHealthFailure(message);
    }, 800);
  }

  async function confirmRepeatedHealthFailure(message: string) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const health = await checkEditorHealth();
        healthFailureCountRef.current = 0;
        if (Number.isInteger(Number(health.bridgePort)) && Number(health.bridgePort) > 0) {
          setBridgePort(Number(health.bridgePort));
        }
        return;
      } catch {
        healthFailureCountRef.current += 1;
        await new Promise((resolve) => window.setTimeout(resolve, 300));
      }
    }
    await confirmUnexpectedDisconnect(message);
  }

  function hasUnsavedChanges() {
    return dataDirtyRef.current || viewConfigDirtyRef.current || profileDirtyRef.current || viewDraftDirtyRef.current;
  }

  function collectAutosaveDirtyDomains(): AutosaveDomain[] {
    const dirtyDomains: AutosaveDomain[] = [];
    if (dataDirtyRef.current) dirtyDomains.push("document");
    if (viewConfigDirtyRef.current) dirtyDomains.push("project-config");
    if (profileDirtyRef.current && selectedViewProfileNameRef.current) dirtyDomains.push("profile");
    return dirtyDomains;
  }

  async function confirmUnexpectedDisconnect(initialMessage: string) {
    if (manualClosedRef.current || serviceLifecycleStateRef.current === "closed") return;
    if (disconnectFlowPromiseRef.current) return disconnectFlowPromiseRef.current;
    const flow = (async () => {
      try {
        const health = await checkEditorHealth();
        healthFailureCountRef.current = 0;
        if (Number.isInteger(Number(health.bridgePort)) && Number(health.bridgePort) > 0) {
          setBridgePort(Number(health.bridgePort));
        }
        return;
      } catch {}

      try {
        await checkRecoveryBridgeHealth(bridgePortRef.current);
      } catch (error) {
        setDisconnectMessage(error instanceof Error ? error.message : initialMessage);
        setServiceLifecycleState("bridgeUnavailable");
        return;
      }

      if (autoRecoverAttemptedRef.current) {
        setDisconnectMessage(initialMessage);
        setServiceLifecycleState("disconnected");
        return;
      }

      autoRecoverAttemptedRef.current = true;
      setDisconnectMessage(initialMessage);
      setServiceLifecycleState("recovering");
      try {
        await reopenEditor(bridgePortRef.current);
        if (hasUnsavedChanges()) {
          setServiceLifecycleState("recoveredPendingReload");
          return;
        }
        window.location.reload();
      } catch (error) {
        setDisconnectMessage(error instanceof Error ? error.message : String(error));
        setServiceLifecycleState("disconnected");
      }
    })().finally(() => {
      disconnectFlowPromiseRef.current = null;
    });
    disconnectFlowPromiseRef.current = flow;
    return flow;
  }

  async function openDocumentAt(
    path: string,
    targetCollection?: string,
    targetRowIndex?: number,
    openDetailPanel = false,
    projectId = activeProjectId,
    targetRowId?: string | null,
  ) {
    const requestId = openRequestRef.current + 1;
    openRequestRef.current = requestId;
    selectedPathRef.current = path;
    setSelectedPath(path);
    setModel(null);
    modelRef.current = null;
    cancelDeferredTask(relationWarmupHandleRef.current);
    relationWarmupHandleRef.current = null;
    cancelDeferredTask(backlinkWarmupHandleRef.current);
    backlinkWarmupHandleRef.current = null;
    deferRelationWarmupRef.current = true;
    deferBacklinkWarmupRef.current = true;
    relationIndexRequestRef.current += 1;
    backlinkRequestRef.current += 1;
    setRelationIndexes({});
    setRelationOptions({});
    setBacklinkColumns([]);
    setBacklinkValuesByRowIdState({});
    savedDocumentRootRef.current = null;
    setCollectionPath("$");
    setSelectedRowIndex(null);
    setSelectedRowIdState(null);
    setDetailOpen(false);
    setStatus(`Loading ${path}...`);
    let documentModel: DocumentModel;
    try {
      documentModel = await loadDocument(path, projectId);
    } catch (error) {
      if (shouldRetryWithFallbackFile(error)) {
        const sidebarTree = buildResolvedSidebarTree(files, selectedViewProfileNameRef.current, selectedViewProfileRef.current, window.localStorage);
        const fallbackPath = findSidebarFallbackFilePath(sidebarTree, path);
        if (fallbackPath && fallbackPath !== path) {
          return openDocumentAt(fallbackPath, undefined, undefined, false, projectId);
        }
      }
      selectedPathRef.current = null;
      setSelectedPath(null);
      setStatus(error instanceof Error ? error.message : String(error));
      return;
    }
    if (requestId !== openRequestRef.current) return;
    const nextCollection = resolveDocumentCollection(documentModel, targetCollection);
    const nextRows = getRows(documentModel, nextCollection) as DataRecord[];
    const nextStore = buildDocumentStoreTyped({ documentId: path, model: documentModel });
    prebuiltDocumentStoreRef.current = {
      documentId: path,
      model: documentModel,
      store: nextStore,
    };
    const targetSourceIndex = targetRowId
      ? (nextStore.collections.get(nextCollection)?.sourceIndexByRowId.get(targetRowId) ?? null)
      : null;
    const nextSelectedRowIndex = targetSourceIndex ?? targetRowIndex ?? (nextRows.length ? 0 : null);
    const nextSelectedRowId = targetRowId
      ?? (nextSelectedRowIndex == null ? null : (nextStore.collections.get(nextCollection)?.rowViews[nextSelectedRowIndex]?.rowId ?? null));
    modelRef.current = documentModel;
    savedDocumentRootRef.current = cloneDataRoot(documentModel.root);
    setModel(documentModel);
    setCollectionPath(nextCollection);
    setSelectedRowIndex(nextSelectedRowIndex);
    setSelectedRowIdState(nextSelectedRowId);
    setDetailOpen(openDetailPanel);
    setDataDirty(false);
    dataDirtyRef.current = false;
    setStatus("");
  }

  function finalizeDetailReorderAsyncSegment(segment: "backlinks" | "maintenance") {
    const perfState = detailReorderPerfRef.current;
    if (!perfState.active) return;
    if (segment === "backlinks" && perfState.awaitingBacklinks) {
      markPerf("detail-reorder:after-backlinks");
      measurePerf("detail-reorder:backlinks", "detail-reorder:before-backlinks", "detail-reorder:after-backlinks");
      perfState.awaitingBacklinks = false;
    }
    if (segment === "maintenance" && perfState.awaitingMaintenance) {
      markPerf("detail-reorder:after-maintenance");
      measurePerf("detail-reorder:maintenance", "detail-reorder:before-maintenance", "detail-reorder:after-maintenance");
      perfState.awaitingMaintenance = false;
    }
  }

  const handleDetailReorderProfilerRender = useCallback((
    id: string,
    phase: "mount" | "update" | "nested-update",
    actualDuration: number,
  ) => {
    const perfState = detailReorderPerfRef.current;
    if (!perfState.active || phase === "mount") return;
    if (id === "main-content") {
      recordPerfDuration("detail-reorder:react-main-content:sample", actualDuration);
    }
    if (id === "data-table") {
      recordPerfDuration("detail-reorder:react-data-table:sample", actualDuration);
    }
    if (id === "detail-panel") {
      recordPerfDuration("detail-reorder:react-detail-panel:sample", actualDuration);
    }
    if (id === "view-tabs") {
      recordPerfDuration("detail-reorder:react-view-tabs:sample", actualDuration);
    }
    if (id === "view-filter-bar") {
      recordPerfDuration("detail-reorder:react-view-filter-bar:sample", actualDuration);
    }
    if (id === "primary-key-banner") {
      recordPerfDuration("detail-reorder:react-primary-key-banner:sample", actualDuration);
    }
    if (id === "main-content" && perfState.awaitingMainContentRender) {
      recordPerfDuration("detail-reorder:react-main-content", actualDuration);
      perfState.awaitingMainContentRender = false;
      return;
    }
    if (id === "data-table" && perfState.awaitingTableRender) {
      recordPerfDuration("detail-reorder:react-data-table", actualDuration);
      perfState.awaitingTableRender = false;
      return;
    }
    if (id === "detail-panel" && perfState.awaitingDetailPanelRender) {
      recordPerfDuration("detail-reorder:react-detail-panel", actualDuration);
      perfState.awaitingDetailPanelRender = false;
      return;
    }
    if (id === "view-tabs" && perfState.awaitingViewTabsRender) {
      recordPerfDuration("detail-reorder:react-view-tabs", actualDuration);
      perfState.awaitingViewTabsRender = false;
      return;
    }
    if (id === "view-filter-bar" && perfState.awaitingFilterBarRender) {
      recordPerfDuration("detail-reorder:react-view-filter-bar", actualDuration);
      perfState.awaitingFilterBarRender = false;
      return;
    }
    if (id === "primary-key-banner" && perfState.awaitingPrimaryKeyBannerRender) {
      recordPerfDuration("detail-reorder:react-primary-key-banner", actualDuration);
      perfState.awaitingPrimaryKeyBannerRender = false;
    }
  }, []);

  async function loadMaintenanceInfo() {
    const perfState = detailReorderPerfRef.current;
    if (perfState.active && perfState.awaitingMaintenance) {
      markPerf("detail-reorder:before-maintenance");
    }
    const requestId = maintenanceRequestRef.current + 1;
    maintenanceRequestRef.current = requestId;
    const nextState = await buildMaintenanceLookupState({
      selectedPath,
      collectionPath,
      selectedRow,
      selectedSourceRowIndex,
      selectedRowLabel: getRecordTitle(selectedRow, titleField ? [titleField] : [], selectedSourceRowIndex ?? null),
      model,
      rows,
      savedRoot: savedDocumentRootRef.current,
      viewConfig,
      activeProjectId,
      loadDocument: (path) => loadDocument(path, activeProjectId),
    });
    if (requestId !== maintenanceRequestRef.current) {
      finalizeDetailReorderAsyncSegment("maintenance");
      return;
    }
    setRelationBacklinks(nextState.relationBacklinks);
    setPrimaryKeyImpacts(nextState.primaryKeyImpacts);
    setPrimaryKeySyncPlan(nextState.primaryKeySyncPlan);
    finalizeDetailReorderAsyncSegment("maintenance");
  }

  async function loadBacklinkGridData() {
    const perfState = detailReorderPerfRef.current;
    if (perfState.active && perfState.awaitingBacklinks) {
      markPerf("detail-reorder:before-backlinks");
    }
    const requestId = backlinkRequestRef.current + 1;
    backlinkRequestRef.current = requestId;
    if (!selectedPath || !model) {
      setBacklinkColumns([]);
      setBacklinkValuesByRowIdState({});
      finalizeDetailReorderAsyncSegment("backlinks");
      return;
    }
    const rows = getRows(model, collectionPath) as DataRecord[];
    const {
      backlinkColumns,
      backlinkValuesByRowId,
    } = await buildBacklinkLookupState({
      targetFile: selectedPath,
      targetCollection: collectionPath,
      rows,
      viewConfig,
      activeModel: model,
      loadDocument: (path) => loadDocument(path, activeProjectId),
    });
    if (requestId !== backlinkRequestRef.current) {
      finalizeDetailReorderAsyncSegment("backlinks");
      return;
    }
    setBacklinkColumns(backlinkColumns as BacklinkGridColumn[]);
    setBacklinkValuesByRowIdState(backlinkValuesByRowId);
    finalizeDetailReorderAsyncSegment("backlinks");
  }

  async function handleOpenRelationTarget(config: RelationConfig, value: string | number) {
    try {
      const target = await resolveRelationTargetSelection({
        relationConfig: config,
        targetValue: value,
        activeFilePath: selectedPath,
        activeModel: model,
        loadDocument: (path) => loadDocument(path, activeProjectId),
      });
      if (!target) {
        setStatus(`引用缺失：${String(value)}`);
        return;
      }
      if (!(await flushBeforeDocumentTransition())) return;
      await openDocumentAt(target.targetFile, target.targetCollection, target.rowIndex, true, activeProjectId, target.rowId ?? undefined);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleOpenBacklink(backlink: RelationBacklink) {
    if (!(await flushBeforeDocumentTransition())) return;
    await openDocumentAt(backlink.sourceFile, backlink.sourceCollection, backlink.rowIndex, true, activeProjectId, backlink.rowId ?? undefined);
  }

  async function loadRelationIndexes(config: ViewConfig) {
    const requestId = relationIndexRequestRef.current + 1;
    relationIndexRequestRef.current = requestId;
    const { relationIndexes: indexes, relationOptions: optionsByKey } = await buildRelationLookupState({
      relations: config.relations,
      activeFilePath: selectedPath,
      activeModel: model,
      loadDocument: (path: string) => loadDocument(path, activeProjectId),
    });
    if (requestId !== relationIndexRequestRef.current) return;
    setRelationIndexes((current) => sameRelationIndexMap(current, indexes) ? current : indexes);
    setRelationOptions((current) => sameRelationOptionMap(current, optionsByKey) ? current : optionsByKey);
  }

  const rows = useMemo(() => {
    const perfState = detailReorderPerfRef.current;
    if (perfState.active && perfState.awaitingRows) {
      markPerf("detail-reorder:before-rows");
    }
    const nextRows = model ? (getRows(model, collectionPath) as DataRecord[]) : [];
    if (perfState.active && perfState.awaitingRows) {
      markPerf("detail-reorder:after-rows");
      measurePerf("detail-reorder:rows", "detail-reorder:before-rows", "detail-reorder:after-rows");
      perfState.awaitingRows = false;
    }
    return nextRows;
  }, [model, collectionPath, dataRevision]);
  const primaryKeyCandidateAnalyses = useMemo<Record<string, PrimaryKeyCandidateAnalysis>>(() => {
    if (!model || !selectedPath) return {};
    return Object.fromEntries(model.collections.map((collection) => {
      const key = buildCollectionKey(selectedPath, collection.path);
      return [
        collection.path,
        analyzePrimaryKeyCandidates({
          model,
          collectionPath: collection.path,
          configuredPrimaryKey: viewConfig.primaryKeys[key] ?? null,
        }),
      ];
    })) as Record<string, PrimaryKeyCandidateAnalysis>;
  }, [model, selectedPath, viewConfig.primaryKeys]);
  const candidateCollections = useMemo(
    () => Object.entries(primaryKeyCandidateAnalyses)
      .filter(([, analysis]) => analysis.status === "candidate-detected")
      .map(([path]) => path),
    [primaryKeyCandidateAnalyses],
  );
  const emptyPrimaryKeyCandidateAnalysis: PrimaryKeyCandidateAnalysis = { status: "unconfigured", candidates: [], filtered: [] };
  const activePrimaryKeyCandidateAnalysis = primaryKeyCandidateAnalyses[collectionPath] ?? emptyPrimaryKeyCandidateAnalysis;
  const activePrimaryKeyCandidates = activePrimaryKeyCandidateAnalysis.status === "candidate-detected"
    ? activePrimaryKeyCandidateAnalysis.candidates
    : [];
  const activePrimaryKeyCandidateWarnings = useMemo(() => {
    if (!selectedPath || !activePrimaryKeyCandidates.length) return [];
    const warnings: string[] = [];
    const incomingRelations = Object.entries(viewConfig.relations).filter(([, config]) => (
      config.targetFile === selectedPath && config.targetCollection === collectionPath
    ));
    if (incomingRelations.length) {
      warnings.push(`当前已有 ${incomingRelations.length} 条显式关联指向这个集合，错误主键会影响现有关联校验。`);
    }
    if (model?.rootCollectionKind === "record-map" && collectionPath === "$") {
      warnings.push("当前集合使用 record-map 键结构，不能按普通字段主键方式确认。");
    }
    return warnings;
  }, [selectedPath, activePrimaryKeyCandidates, viewConfig.relations, collectionPath, model]);
  const showPrimaryKeyCandidateBanner = Boolean(
    selectedCollectionKey
      && activePrimaryKeyCandidates.length
      && !dismissedCandidateKeys.includes(selectedCollectionKey),
  );
  const draftSource = selectedViewProfileName ? selectedViewProfile : localSharedViewDrafts;
  const collectionSharedViews = useMemo(
    () => activeCollectionKey ? resolveCollectionViews(sharedViewsConfig, activeCollectionKey) : [],
    [sharedViewsConfig, activeCollectionKey],
  );
  const orderedCollectionViews = useMemo(
    () => activeCollectionKey
      ? applyViewOrderDraft(collectionSharedViews, draftSource.viewOrderDrafts?.[activeCollectionKey])
      : collectionSharedViews,
    [collectionSharedViews, draftSource, activeCollectionKey],
  );
  const activeSharedView = useMemo(
    () => activeCollectionKey
      ? resolveActiveView(
        orderedCollectionViews,
        draftSource.lastActiveViews?.[activeCollectionKey],
        resolveDefaultViewId(sharedViewsConfig, activeCollectionKey),
      )
      : null,
    [orderedCollectionViews, draftSource, sharedViewsConfig, activeCollectionKey],
  );
  const activeView = useMemo(
    () => activeCollectionKey && activeSharedView
      ? mergeSharedViewWithDraft(activeSharedView, draftSource.viewDrafts?.[activeCollectionKey]?.[activeSharedView.id]) as CollectionView
      : null,
    [activeCollectionKey, activeSharedView, draftSource],
  );
  const previousVisibleRowViewsRef = useRef<TableRowView[] | null>(null);
  const previousViewResultRef = useRef<ViewResult | null>(null);
  const previousViewEngineRowsRef = useRef<ViewEngineRow[] | null>(null);
  const stableActiveViewRenderStateRef = useRef<{ query: string; filters: FilterGroup; sorts: SortRule[] } | null>(null);
  const activeViewLayoutId = activeSharedView?.id ?? null;
  const activeViewHasFilters = Boolean(activeView?.filters?.rules?.length);
  const activeViewSort = activeView?.sorts?.[0] ?? null;
  const activeViewRenderState = useMemo(() => {
    const nextState = {
      query: activeView?.query ?? "",
      filters: activeView?.filters ?? emptyFilterGroup,
      sorts: activeView?.sorts ?? emptySortRules,
    };
    const previous = stableActiveViewRenderStateRef.current;
    if (
      previous
      && previous.query === nextState.query
      && sameFilterGroup(previous.filters, nextState.filters)
      && sameSortRules(previous.sorts, nextState.sorts)
    ) {
      return previous;
    }
    stableActiveViewRenderStateRef.current = nextState;
    return nextState;
  }, [activeView?.query, activeView?.filters, activeView?.sorts]);
  const dirtyViewIds = useMemo(() => {
    if (!activeCollectionKey) return new Set<string>();
    return new Set(Object.keys(draftSource.viewDrafts?.[activeCollectionKey] ?? {}));
  }, [draftSource, activeCollectionKey]);
  const activeViewDirty = Boolean(
    activeCollectionKey
    && activeSharedView
    && draftSource.viewDrafts?.[activeCollectionKey]?.[activeSharedView.id],
  );
  const viewOrderDirty = Boolean(activeCollectionKey && draftSource.viewOrderDrafts?.[activeCollectionKey]?.length);
  const handleTableScrollPositionChange = useCallback((position: { scrollTop: number; scrollLeft: number }) => {
    if (!activeProjectId || !selectedPath || !activeViewLayoutId) return;
    updatePageContextScroll(window.localStorage, activeProjectId, {
      path: selectedPath,
      collectionPath,
      viewId: activeViewLayoutId,
      scrollTop: position.scrollTop,
      scrollLeft: position.scrollLeft,
    });
  }, [activeProjectId, selectedPath, collectionPath, activeViewLayoutId]);
  const documentStore = useMemo(() => {
    if (!model) {
      documentStoreRef.current = null;
      prebuiltDocumentStoreRef.current = null;
      return null;
    }
    const prebuiltStore = prebuiltDocumentStoreRef.current;
    if (
      prebuiltStore &&
      prebuiltStore.documentId === (selectedPath ?? "document") &&
      prebuiltStore.model === model
    ) {
      documentStoreRef.current = prebuiltStore.store;
      prebuiltDocumentStoreRef.current = null;
      return prebuiltStore.store;
    }
    const nextStore = buildDocumentStoreTyped({
      documentId: selectedPath ?? "document",
      model,
      previousStore: documentStoreRef.current ?? undefined,
    });
    documentStoreRef.current = nextStore;
    return nextStore;
  }, [model, selectedPath, dataRevision]);
  const collectionStore = useMemo<CollectionStore | null>(
    () => documentStore?.collections.get(collectionPath) ?? null,
    [documentStore, collectionPath],
  );
  useEffect(() => {
    if (!activeProjectId || loadedProjectIdRef.current !== activeProjectId || !selectedPath || !model) {
      setScrollRestoreKey(null);
      setInitialScrollPosition(null);
      return;
    }
    updatePageContextSelection(window.localStorage, activeProjectId, {
      selectedPath,
      collectionPath,
    });
    const nextPageContextState = readPageContextState(window.localStorage);
    if (!activeViewLayoutId) {
      setScrollRestoreKey(null);
      setInitialScrollPosition(null);
      return;
    }
    const nextScrollRestoreKey = buildScrollContextKey(selectedPath, collectionPath, activeViewLayoutId);
    if (!nextScrollRestoreKey) {
      setScrollRestoreKey(null);
      setInitialScrollPosition(null);
      return;
    }
    const nextProjectPageContext = readProjectPageContext(nextPageContextState, activeProjectId);
    setScrollRestoreKey(nextScrollRestoreKey);
    setInitialScrollPosition(nextProjectPageContext.scrollByView[nextScrollRestoreKey] ?? null);
  }, [activeProjectId, selectedPath, collectionPath, model, activeViewLayoutId]);
  const fieldConfig = useMemo(
    () => {
      const perfState = detailReorderPerfRef.current;
      if (perfState.active && perfState.awaitingFieldConfig) {
        markPerf("detail-reorder:before-build-field-config");
      }
      const nextFieldConfig = buildFieldConfig(
        selectedPath,
        collectionPath,
        activeViewLayoutId,
        model,
        viewConfig,
        selectedViewProfileName ? "profile" : "local",
        selectedViewProfileName ? selectedViewProfile : null,
        backlinkColumns.map((column) => column.fieldName),
      );
      if (perfState.active && perfState.awaitingFieldConfig) {
        markPerf("detail-reorder:after-build-field-config");
        measurePerf("detail-reorder:build-field-config", "detail-reorder:before-build-field-config", "detail-reorder:after-build-field-config");
        perfState.awaitingFieldConfig = false;
      }
      return nextFieldConfig;
    },
    [selectedPath, collectionPath, activeViewLayoutId, model, viewConfig, selectedViewProfile, selectedViewProfileName, layoutRevision, backlinkColumns],
  );
  const stableTableFieldConfigRef = useRef<TableFieldConfig | null>(null);
  const tableFieldConfig = useMemo<TableFieldConfig>(() => {
    const nextConfig = {
      displayTypes: fieldConfig.displayTypes,
      hidden: fieldConfig.hidden,
      wrapped: fieldConfig.wrapped,
      widths: fieldConfig.widths,
      order: fieldConfig.order,
    };
    const previous = stableTableFieldConfigRef.current;
    if (
      previous
      && sameRecord(previous.displayTypes, nextConfig.displayTypes)
      && sameSet(previous.hidden, nextConfig.hidden)
      && sameSet(previous.wrapped, nextConfig.wrapped)
      && sameRecord(previous.widths, nextConfig.widths)
      && sameStringArray(previous.order, nextConfig.order)
    ) {
      return previous;
    }
    stableTableFieldConfigRef.current = nextConfig;
    return nextConfig;
  }, [fieldConfig.displayTypes, fieldConfig.hidden, fieldConfig.wrapped, fieldConfig.widths, fieldConfig.order]);
  const validationFieldConfig = useMemo(
    () => ({
      displayTypes: tableFieldConfig.displayTypes,
      isCompatible,
    }),
    [tableFieldConfig.displayTypes],
  );
  const validationRuleConfig = useMemo(
    () => ({
      primaryKeys: viewConfig.primaryKeys,
      relations: viewConfig.relations,
    }),
    [viewConfig.primaryKeys, viewConfig.relations],
  );
  const activeValidationPrimaryKeyField = useMemo(
    () => selectedPath ? (validationRuleConfig.primaryKeys[buildCollectionKey(selectedPath, collectionPath)] ?? null) : null,
    [selectedPath, collectionPath, validationRuleConfig],
  );
  function resolveValidationInvalidation(fieldName: string, rowId: string | null, rowIndex: number | null) {
    if (fieldName === activeValidationPrimaryKeyField) {
      return { type: "field" as const, fieldName };
    }
    return { type: "row-field" as const, rowId, rowIndex, fieldName };
  }
  const allFields = useMemo(
    () => model ? getOrderedFields(model, collectionPath, tableFieldConfig.order, backlinkColumns.map((column) => column.fieldName)) : [],
    [model, collectionPath, tableFieldConfig.order, backlinkColumns],
  );
  const fieldViewConfigs = useMemo(
    () => model ? buildFieldViewConfigs(selectedPath, collectionPath, model, viewConfig) : {},
    [selectedPath, collectionPath, model, viewConfig],
  );
  const viewFilterFieldTypes = useMemo(
    () => Object.fromEntries(allFields.map((field) => [
      field,
      selectedPath && viewConfig.relations[buildRelationKey({ sourceFile: selectedPath, sourceCollection: collectionPath, fieldPath: [field] })]
        ? "Relation"
        : inferViewFilterFieldType(field, rows, tableFieldConfig.displayTypes),
    ])) as Record<string, FieldDisplayType>,
    [allFields, rows, tableFieldConfig.displayTypes, selectedPath, collectionPath, viewConfig.relations],
  );
  const viewFilterOptions = useMemo(
    () => {
      const options: Record<string, MultiSelectOptionView[]> = {};
      if (!selectedPath) return options;
      for (const field of allFields) {
        const relationKey = buildRelationKey({ sourceFile: selectedPath, sourceCollection: collectionPath, fieldPath: [field] });
        if (viewConfig.relations[relationKey]) {
          options[field] = (relationOptions[relationKey] ?? []).map((option) => ({
            value: option.value,
            label: option.label,
            color: null,
          }));
          continue;
        }
        const fieldType = viewFilterFieldTypes[field];
        if (fieldType === "Multi-select" || fieldType === "Select") {
          options[field] = buildValueFilterOptions(field, rows, fieldViewConfigs[field], fieldType);
        }
      }
      return options;
    },
    [allFields, selectedPath, collectionPath, viewConfig.relations, relationOptions, viewFilterFieldTypes, rows, fieldViewConfigs],
  );
  const viewEngineRows = useMemo<ViewEngineRow[]>(() => {
    return buildStableViewEngineRows(collectionStore, previousViewEngineRowsRef.current);
  }, [collectionStore]);
  useEffect(() => {
    previousViewEngineRowsRef.current = viewEngineRows;
  }, [viewEngineRows]);
  const viewResult = useMemo(() => {
    const perfState = detailReorderPerfRef.current;
    if (perfState.active && perfState.awaitingViewRows) {
      markPerf("detail-reorder:before-view-rows");
    }
    const nextViewResult = runViewTyped({
      rows: viewEngineRows,
      query: activeViewRenderState.query,
      candidateRowIds: null,
      filters: activeViewRenderState.filters,
      sorts: activeViewRenderState.sorts,
      fieldTypes: viewFilterFieldTypes,
    });
    if (perfState.active && perfState.awaitingViewRows) {
      markPerf("detail-reorder:after-view-rows");
      measurePerf("detail-reorder:view-rows", "detail-reorder:before-view-rows", "detail-reorder:after-view-rows");
      perfState.awaitingViewRows = false;
    }
    return stabilizeViewResult(previousViewResultRef.current, nextViewResult);
  }, [viewEngineRows, activeViewRenderState, viewFilterFieldTypes]);
  useEffect(() => {
    previousViewResultRef.current = viewResult;
  }, [viewResult]);
  const visibleRowIds = viewResult.visibleRowIds;
  const detailSelectionState = useMemo(() => buildDetailSelectionState({
    collectionStore,
    visibleRowIds,
    selectedRowId: selectedRowIdState,
    selectedRowIndex,
    previousVisibleRowViews: previousVisibleRowViewsRef.current,
  }), [collectionStore, visibleRowIds, selectedRowIdState, selectedRowIndex]);
  const {
    visibleRowViews,
    selectedRow,
    resolvedRowId: selectedRowId,
    resolvedSourceRowIndex: selectedSourceRowIndex,
    selectedVisibleRowPosition,
    previousRowTarget: previousVisibleRowTarget,
    nextRowTarget: nextVisibleRowTarget,
  } = detailSelectionState;
  useEffect(() => {
    previousVisibleRowViewsRef.current = visibleRowViews;
  }, [visibleRowViews]);
  useEffect(() => {
    selectedRowIdRef.current = selectedRowId;
    selectedSourceRowIndexRef.current = selectedSourceRowIndex;
  }, [selectedRowId, selectedSourceRowIndex]);
  useEffect(() => {
    const nextSelection = resolveDetailSelectionSync({
      collectionStore,
      selectedRowId: selectedRowIdState,
      selectedRowIndex,
    });
    if (!nextSelection) return;
    if (nextSelection.nextRowIndex !== selectedRowIndex) setSelectedRowIndex(nextSelection.nextRowIndex);
    if (nextSelection.nextRowId !== selectedRowIdState) setSelectedRowIdState(nextSelection.nextRowId);
  }, [collectionStore, selectedRowIdState, selectedRowIndex]);
  useEffect(() => {
    void loadMaintenanceInfo();
  }, [selectedPath, collectionPath, selectedRowId, selectedSourceRowIndex, selectedRow, viewConfig.relations, tableRevision]);
  const hiddenFields = useMemo(() => allFields.filter((field) => tableFieldConfig.hidden.has(field)), [allFields, tableFieldConfig.hidden]);
  const titleField = useMemo(
    () => model ? findTitleField(getMainColumns(model, collectionPath), rows) : null,
    [model, collectionPath, rows],
  );
  useEffect(() => {
    titleFieldRef.current = titleField;
  }, [titleField]);
  const relationConfigKey = useMemo(
    () => selectedPath && relationConfigField
      ? buildRelationKey({ sourceFile: selectedPath, sourceCollection: collectionPath, fieldPath: [relationConfigField] })
      : null,
    [selectedPath, collectionPath, relationConfigField],
  );
  const relationConfigForDialog = relationConfigKey ? (viewConfig.relations[relationConfigKey] ?? null) : null;
  const validationSnapshot = useMemo(
    () => {
      const perfState = detailReorderPerfRef.current;
      if (perfState.active && perfState.awaitingIssues) {
        markPerf("detail-reorder:before-build-issues");
      }
      const previousValidationState = validationSnapshotRef.current;
      const nextValidationSnapshot = model && selectedPath
        ? (
          previousValidationState
          && previousValidationState.fieldConfig === validationFieldConfig
          && previousValidationState.ruleConfig === validationRuleConfig
          && previousValidationState.relationIndexes === relationIndexes
          && previousValidationState.sourcePath === selectedPath
          && previousValidationState.collectionPath === collectionPath
          && validationInvalidationRef.current.type !== "full"
            ? (
              (
                validationInvalidationRef.current.type === "row-field"
                  ? patchValidationSnapshotForRowField({
                    previousSnapshot: previousValidationState.snapshot,
                    invalidation: validationInvalidationRef.current,
                    rows,
                    collectionStore,
                    fieldConfig: validationFieldConfig,
                    relationIndexes,
                    validationConfig: validationRuleConfig,
                    sourcePath: selectedPath,
                    collectionPath,
                  })
                  : validationInvalidationRef.current.type === "field"
                    ? patchValidationSnapshotForField({
                      previousSnapshot: previousValidationState.snapshot,
                      invalidation: validationInvalidationRef.current,
                      rows,
                      collectionStore,
                      fieldConfig: validationFieldConfig,
                      relationIndexes,
                      validationConfig: validationRuleConfig,
                      sourcePath: selectedPath,
                      collectionPath,
                    })
                    : null
              ) ?? (
                previousValidationState.relationIndexes
                && previousValidationState.relationIndexes !== relationIndexes
                ? patchValidationSnapshotForChangedRelationFields({
                  previousSnapshot: previousValidationState.snapshot,
                  previousRelationIndexes: previousValidationState.relationIndexes,
                  nextRelationIndexes: relationIndexes,
                  sourcePath: selectedPath,
                  collectionPath,
                  rows,
                  collectionStore,
                  fieldConfig: validationFieldConfig,
                  validationConfig: validationRuleConfig,
                })
                : null
              ) ?? buildValidationSnapshot({
                rows,
                collectionStore,
                fieldConfig: validationFieldConfig,
                relationIndexes,
                validationConfig: validationRuleConfig,
                sourcePath: selectedPath,
                collectionPath,
              })
            )
            : buildValidationSnapshot({
              rows,
              collectionStore,
              fieldConfig: validationFieldConfig,
              relationIndexes,
              validationConfig: validationRuleConfig,
              sourcePath: selectedPath,
              collectionPath,
            })
        )
        : {
          byRowId: Object.create(null),
          byRowIndex: Object.create(null),
          collectionIssues: Object.create(null),
        };
      validationSnapshotRef.current = {
        snapshot: nextValidationSnapshot,
        fieldConfig: validationFieldConfig,
        ruleConfig: validationRuleConfig,
        relationIndexes,
        sourcePath: selectedPath,
        collectionPath,
      };
      validationInvalidationRef.current = { type: "full" };
      if (perfState.active && perfState.awaitingIssues) {
        markPerf("detail-reorder:after-build-issues");
        measurePerf("detail-reorder:build-issues", "detail-reorder:before-build-issues", "detail-reorder:after-build-issues");
        perfState.awaitingIssues = false;
      }
      return nextValidationSnapshot;
    },
    [model, rows, collectionStore, validationFieldConfig, relationIndexes, validationRuleConfig, selectedPath, collectionPath],
  );
  const tableSnapshot = useMemo<TableSnapshot>(() => ({
    schemaModel: model!,
    sourcePath: selectedPath,
    collectionPath,
    rowViews: visibleRowViews,
    fieldConfig: tableFieldConfig,
    fieldViewConfigs,
    backlinkColumns,
    backlinkValuesByRowId: backlinkValuesByRowIdState,
    relationOptions,
    relationConfigs: viewConfig.relations,
    revision: tableRevision,
    sort: activeViewSort,
    validation: validationSnapshot,
    titleField,
    scrollRestoreKey,
    initialScrollPosition,
    textEditable: tableTextEditMode,
    onRegisterActiveTextEditor: registerActiveTextEditor,
  }), [
    model,
    selectedPath,
    collectionPath,
    visibleRowViews,
    tableFieldConfig,
    fieldViewConfigs,
    backlinkColumns,
    backlinkValuesByRowIdState,
    relationOptions,
    viewConfig.relations,
    tableRevision,
    activeViewSort,
    validationSnapshot,
    titleField,
    scrollRestoreKey,
    initialScrollPosition,
    tableTextEditMode,
    registerActiveTextEditor,
  ]);
  const detailSnapshot = useMemo<DetailSnapshot>(() => ({
    open: detailOpen,
    panelWidth: detailPanelWidth,
    row: selectedRow,
    rowId: selectedRowId,
    sourceRowIndex: selectedSourceRowIndex,
    rowCount: visibleRowViews.length,
    visibleRowPosition: selectedVisibleRowPosition,
    previousRowTarget: previousVisibleRowTarget,
    nextRowTarget: nextVisibleRowTarget,
    sourcePath: selectedPath,
    collectionPath,
    titleField,
    detailOrder: fieldConfig.detailOrder,
    displayTypes: fieldConfig.displayTypes,
    fieldViewConfigs,
    validation: validationSnapshot,
    relationOptions,
    relationConfigs: viewConfig.relations,
    relationBacklinks,
    primaryKeyImpacts,
    primaryKeySyncPlan,
    primaryKeySyncResult,
    commandSaving,
  }), [
    detailOpen,
    detailPanelWidth,
    selectedRow,
    selectedRowId,
    selectedSourceRowIndex,
    visibleRowViews.length,
    selectedVisibleRowPosition,
    previousVisibleRowTarget,
    nextVisibleRowTarget,
    selectedPath,
    collectionPath,
    titleField,
    fieldConfig.detailOrder,
    fieldConfig.displayTypes,
    fieldViewConfigs,
    validationSnapshot,
    relationOptions,
    viewConfig.relations,
    relationBacklinks,
    primaryKeyImpacts,
    primaryKeySyncPlan,
    primaryKeySyncResult,
    commandSaving,
  ]);
  const toolbarSnapshot = useMemo<ToolbarSnapshot>(() => ({
    currentPath: selectedPath,
    collectionPath,
    viewProfiles,
    selectedViewProfileName,
    activeThemeId: uiPreferences.activeThemeId,
    baseFontSize: uiPreferences.baseFontSize,
    rowCount: rows.length,
    visibleCount: visibleRowViews.length,
    query: activeViewRenderState.query,
    autosaveState,
    commandSaving,
    closing,
    rebuilding,
    status: statusText,
    hiddenFields,
  }), [
    selectedPath,
    collectionPath,
    viewProfiles,
    selectedViewProfileName,
    uiPreferences.activeThemeId,
    uiPreferences.baseFontSize,
    rows.length,
    visibleRowViews.length,
    activeViewRenderState.query,
    autosaveState,
    commandSaving,
    closing,
    rebuilding,
    statusText,
    hiddenFields,
  ]);
  const viewTabsSnapshot = useMemo<ViewTabsSnapshot>(() => ({
    views: orderedCollectionViews,
    activeViewId: activeSharedView?.id ?? null,
    dirtyViewIds,
    commandSaving,
    filterBarVisible,
    hasActiveFilters: activeViewHasFilters,
    tableTextEditMode,
    rowDeleteControlsVisible,
    viewOrderDirty,
  }), [
    orderedCollectionViews,
    activeSharedView,
    dirtyViewIds,
    commandSaving,
    filterBarVisible,
    activeViewHasFilters,
    tableTextEditMode,
    rowDeleteControlsVisible,
    viewOrderDirty,
  ]);
  const viewFilterBarSnapshot = useMemo<ViewFilterBarSnapshot>(() => ({
    collectionKey: activeCollectionKey,
    view: activeView,
    fields: allFields,
    displayTypes: tableFieldConfig.displayTypes,
    fieldViewConfigs,
    fieldTypes: viewFilterFieldTypes,
    relationFilterOptions: viewFilterOptions,
    dirty: activeViewDirty,
    viewOrderDirty,
    commandSaving,
    autoOpenRuleId: pendingOpenFilterRuleId,
  }), [
    activeCollectionKey,
    activeView,
    allFields,
    tableFieldConfig.displayTypes,
    fieldViewConfigs,
    viewFilterFieldTypes,
    viewFilterOptions,
    activeViewDirty,
    viewOrderDirty,
    commandSaving,
    pendingOpenFilterRuleId,
  ]);
  const appFrameStyle = useMemo(() => ({ "--sidebar-width": `${sidebarWidth}px` }) as CSSProperties, [sidebarWidth]);

  useEffect(() => {
    const perfState = detailReorderPerfRef.current;
    if (
      !perfState.active
      || perfState.awaitingRows
      || perfState.awaitingFieldConfig
      || perfState.awaitingViewRows
      || perfState.awaitingIssues
      || perfState.awaitingBacklinks
      || perfState.awaitingMaintenance
      || perfState.awaitingMainContentRender
      || perfState.awaitingTableRender
      || perfState.awaitingDetailPanelRender
    ) return;
    markPerf("detail-reorder:stable");
    measurePerf("detail-reorder:total", "detail-reorder:start", "detail-reorder:stable");
    perfState.active = false;
  }, [fieldConfig, validationSnapshot]);

  useEffect(() => {
    document.querySelectorAll(".data-table tbody tr.selected-row").forEach((row) => row.classList.remove("selected-row"));
    if (!selectedRowId) return;
    document.querySelector(`.data-table tbody tr[data-row-id="${selectedRowId}"]`)?.classList.add("selected-row");
  }, [selectedRowId, collectionPath, visibleRowIds]);

  function mutate(mutator: () => void) {
    if (validationInvalidationRef.current.type !== "row-field") {
      validationInvalidationRef.current = { type: "full" };
    }
    mutator();
    dataDirtyRef.current = true;
    setDataDirty(true);
    saveCoordinator.markDirty("document");
    bumpDataRevision((value) => value + 1);
    bumpTableRevision((value) => value + 1);
  }

  function mutateViewConfig(mutator: (draft: ViewConfig) => void) {
    validationInvalidationRef.current = { type: "full" };
    setViewConfig((current) => {
      const next = cloneViewConfig(current);
      mutator(next);
      next.backlinks = syncBacklinksWithRelations(next.relations, next.backlinks) as Record<string, BacklinkConfig>;
      viewConfigRef.current = next;
      return next;
    });
    viewConfigDirtyRef.current = true;
    setViewConfigDirty(true);
    saveCoordinator.markDirty("project-config");
    bumpTableRevision((value) => value + 1);
  }

  function mutateOptionFieldTransaction({
    mutateData,
    mutateViewConfigDraft,
  }: {
    mutateData?: () => void;
    mutateViewConfigDraft?: (draft: ViewConfig) => void;
  }) {
    if (mutateViewConfigDraft) {
      validationInvalidationRef.current = { type: "full" };
    } else if (validationInvalidationRef.current.type !== "row-field") {
      validationInvalidationRef.current = { type: "full" };
    }
    let changed = false;
    if (mutateData) {
      mutateData();
      dataDirtyRef.current = true;
      setDataDirty(true);
      saveCoordinator.markDirty("document");
      bumpDataRevision((value) => value + 1);
      changed = true;
    }
    if (mutateViewConfigDraft) {
      const nextViewConfig = cloneViewConfig(viewConfigRef.current);
      mutateViewConfigDraft(nextViewConfig);
      nextViewConfig.backlinks = syncBacklinksWithRelations(nextViewConfig.relations, nextViewConfig.backlinks) as Record<string, BacklinkConfig>;
      viewConfigRef.current = nextViewConfig;
      setViewConfig(nextViewConfig);
      viewConfigDirtyRef.current = true;
      setViewConfigDirty(true);
      saveCoordinator.markDirty("project-config");
      changed = true;
    }
    if (changed) bumpTableRevision((value) => value + 1);
  }

  function mutateSelectedViewProfile(mutator: (draft: UserViewProfile) => void) {
    if (!selectedViewProfileName) return false;
    const current = normalizeUserViewProfile(selectedViewProfileRef.current);
    const next: UserViewProfile = {
      sidebarWidth: current.sidebarWidth,
      detailPanelWidth: current.detailPanelWidth,
      fileOrder: [...current.fileOrder],
      sidebarTree: cloneStoredSidebarTreeState(current.sidebarTree),
      lastActiveViews: { ...current.lastActiveViews },
      viewDrafts: { ...current.viewDrafts },
      viewOrderDrafts: { ...current.viewOrderDrafts },
      ...(current.appearance ? { appearance: cloneUiPreferences(current.appearance) } : {}),
      viewLayouts: Object.fromEntries(Object.entries(current.viewLayouts).map(([key, views]) => [
        key,
        Object.fromEntries(Object.entries(views).map(([viewId, value]) => [
          viewId,
          {
            hidden: [...value.hidden],
            wrapped: [...value.wrapped],
            order: [...value.order],
            detailOrder: [...value.detailOrder],
            widths: { ...value.widths },
          },
        ])),
      ])),
      collections: { ...(current.collections ?? {}) },
    };
    mutator(next);
    if (detailReorderPerfRef.current.active) {
      markPerf("detail-reorder:after-profile-update");
      measurePerf("detail-reorder:profile-update", "detail-reorder:before-profile-update", "detail-reorder:after-profile-update");
    }
    selectedViewProfileRef.current = next;
    setSelectedViewProfile(next);
    profileDirtyRef.current = true;
    setProfileDirty(true);
    saveCoordinator.markDirty("profile");
    return next;
  }

  function updateUiPreferences(mutator: (draft: UiPreferences) => void) {
    if (selectedViewProfileName) {
      let nextPreferences = defaultUiPreferences();
      const nextProfile = mutateSelectedViewProfile((draft) => {
        const next = cloneUiPreferences(draft.appearance);
        mutator(next);
        draft.appearance = normalizeUiPreferences(next);
        nextPreferences = draft.appearance;
      });
      if (nextProfile) {
        setUiPreferences(nextPreferences);
      }
      return;
    }
    setUiPreferences((current) => {
      const next = cloneUiPreferences(current);
      mutator(next);
      const normalized = normalizeUiPreferences(next);
      writeLocalUiPreferences(window.localStorage, normalized);
      return normalized;
    });
  }

  function handleChangeTheme(nextTheme: UiTheme) {
    updateUiPreferences((draft) => {
      draft.activeThemeId = nextTheme;
    });
  }

  function handleChangeBaseFontSize(nextFontSize: UiPreferences["baseFontSize"]) {
    updateUiPreferences((draft) => {
      draft.baseFontSize = nextFontSize;
    });
  }

  function updateActiveViewLayout(mutator: (draft: UserViewLayoutState) => void, options: { affectsTable?: boolean } = {}) {
    if (!selectedPath || !activeViewLayoutId) return;
    if (mutateSelectedViewProfile((draft) => {
      const viewLayout = ensureViewLayout(draft, selectedPath, collectionPath, activeViewLayoutId);
      mutator(viewLayout);
    })) return;
    const next = readLocalViewState({
      path: selectedPath,
      collectionPath,
      viewId: activeViewLayoutId,
      localStorage: window.localStorage,
    });
    mutator(next);
    writeLocalViewState({
      path: selectedPath,
      collectionPath,
      viewId: activeViewLayoutId,
      state: next,
      localStorage: window.localStorage,
    });
    bumpLayoutRevision((value) => value + 1);
    if (options.affectsTable ?? true) {
      bumpTableRevision((value) => value + 1);
    }
  }

  function updateActiveViewDraft(patch: Partial<CollectionView>) {
    if (commandSaving) return;
    if (!activeCollectionKey || !activeSharedView) return;
    const viewId = activeSharedView.id;
    if (mutateSelectedViewProfile((draft) => {
      draft.viewDrafts = { ...draft.viewDrafts };
      draft.viewDrafts[activeCollectionKey] = {
        ...(draft.viewDrafts[activeCollectionKey] ?? {}),
        [viewId]: {
          ...(draft.viewDrafts[activeCollectionKey]?.[viewId] ?? {}),
          ...patch,
        },
      };
    })) {
      setViewDraftDirty(true);
      return;
    }
    setLocalSharedViewDrafts((current) => {
      const next = {
        lastActiveViews: { ...current.lastActiveViews },
        viewDrafts: {
          ...current.viewDrafts,
          [activeCollectionKey]: {
            ...(current.viewDrafts[activeCollectionKey] ?? {}),
            [viewId]: {
              ...(current.viewDrafts[activeCollectionKey]?.[viewId] ?? {}),
              ...patch,
            },
          },
        },
        viewOrderDrafts: { ...current.viewOrderDrafts },
      };
      writeLocalSharedViewDrafts(window.localStorage, next);
      return next;
    });
    setViewDraftDirty(true);
  }

  function handleReorderFiles(fileOrder: string[], nextChildOrderByParent?: Record<string, string[]>) {
    const currentSidebarPreferences = resolveActiveSidebarPreferences(
      files,
      selectedViewProfileName,
      selectedViewProfileRef.current,
      window.localStorage,
    );
    const nextOrder = normalizeFileOrder(files, fileOrder);
    const nextSidebarTree = nextChildOrderByParent
      ? {
        ...cloneSidebarTreePreferences(currentSidebarPreferences.sidebarTree),
        childOrderByParent: Object.fromEntries(
          Object.entries(nextChildOrderByParent).map(([parentId, order]) => [parentId, [...order]]),
        ) as Record<string, string[]>,
      }
      : deriveSidebarTreePreferencesFromFileOrder(
        files,
        nextOrder,
        currentSidebarPreferences.sidebarTree,
      );
    const nextStoredSidebarTree = serializeSidebarTreeState(nextSidebarTree, currentSidebarPreferences.hasExplicitExpandedNodeIds);
    if (mutateSelectedViewProfile((draft) => {
      draft.fileOrder = nextOrder;
      draft.sidebarTree = nextStoredSidebarTree;
    })) return;
    writeLocalFileOrder(window.localStorage, nextOrder);
    writeStoredLocalSidebarTreePreferences(window.localStorage, nextStoredSidebarTree);
    bumpUiRevision((value) => value + 1);
  }

  function handleSidebarExpandedNodeIdsChange(nextExpandedNodeIds: string[] | null) {
    const currentSidebarPreferences = resolveActiveSidebarPreferences(
      files,
      selectedViewProfileName,
      selectedViewProfileRef.current,
      window.localStorage,
    );
    const rawSidebarTree = selectedViewProfileName
      ? selectedViewProfileRef.current.sidebarTree
      : readRawLocalSidebarTreePreferences(window.localStorage);
    const nextSidebarTree = cloneSidebarTreePreferences(rawSidebarTree);
    nextSidebarTree.expandedNodeIds = nextExpandedNodeIds ?? [];
    const nextStoredSidebarTree = serializeSidebarTreeState(nextSidebarTree, nextExpandedNodeIds != null);
    if (mutateSelectedViewProfile((draft) => {
      draft.sidebarTree = nextStoredSidebarTree;
    })) return;
    writeStoredLocalSidebarTreePreferences(window.localStorage, nextStoredSidebarTree);
    bumpUiRevision((value) => value + 1);
  }

  async function commitProfileSave(name: string, profile: UserViewProfile) {
    const task = saveViewProfile(name, profile, activeProjectIdRef.current);
    profileSavePromiseRef.current = task;
    try {
      await task;
    } finally {
      if (profileSavePromiseRef.current === task) profileSavePromiseRef.current = null;
    }
  }

  async function flushPendingProfileSave() {
    if (profileSavePromiseRef.current) await profileSavePromiseRef.current;
  }

  function getRowIdAtSourceIndex(sourceIndex: number | null, store = collectionStore) {
    if (sourceIndex == null || !store) return null;
    return store.rowViews[sourceIndex]?.rowId ?? null;
  }

  function setSelectedSourceRow(sourceIndex: number | null, rowId: string | null = getRowIdAtSourceIndex(sourceIndex)) {
    setSelectedRowIndex(sourceIndex);
    setSelectedRowIdState(rowId);
  }

  function flushSelectedSourceRow(sourceIndex: number | null, rowId: string | null = getRowIdAtSourceIndex(sourceIndex)) {
    flushSync(() => {
      setSelectedRowIndex(sourceIndex);
      setSelectedRowIdState(rowId);
    });
  }

  function resolveSourceIndexFromRowId(rowId: string | null, fallbackSourceIndex: number | null = null, store = collectionStore) {
    if (rowId && store) {
      const resolved = store.sourceIndexByRowId.get(rowId);
      if (resolved != null) return resolved;
    }
    return fallbackSourceIndex;
  }

  function handleEditCell(rowIndex: number, fieldName: string, value: unknown) {
    if (!model) return;
    validationInvalidationRef.current = resolveValidationInvalidation(fieldName, null, rowIndex);
    mutate(() => setCellValue(model, collectionPath, rowIndex, fieldName, value));
  }

  function handleEditCellByRowId(rowId: string, fieldName: string, value: unknown) {
    if (!model || !documentStore) return;
    validationInvalidationRef.current = resolveValidationInvalidation(fieldName, rowId, null);
    mutate(() => setCellValueByRowId({ model, store: documentStore, collectionPath, rowId, fieldName, value }));
  }

  function handleTableEditCell(rowIndex: number, rowId: string | null, fieldName: string, value: unknown) {
    if (rowId) {
      handleEditCellByRowId(rowId, fieldName, value);
      return;
    }
    handleEditCell(rowIndex, fieldName, value);
  }

  function handleChangeFieldType(fieldName: string, displayType: FieldDisplayType) {
    if (!selectedPath || !model || (displayType !== "Text" && displayType !== "Select")) return;
    const rowsInCollection = getRows(model, collectionPath) as DataRecord[];
    mutateViewConfig((draft) => {
      const key = fieldViewConfigKey(selectedPath, collectionPath, fieldName);
      if (!key) return;
      const current = ensureFieldViewConfig(draft, key);
      current.type = displayType as RealFieldType;
      if (displayType === "Select") {
        const discoveredValues = collectSingleSelectValues(rowsInCollection, fieldName);
        current.selectOptions = {
          ...Object.fromEntries(discoveredValues.map((value) => [value, { label: value, color: null }])),
          ...current.selectOptions,
        };
      }
    });
  }

  function handleConfigureRelation(fieldName: string) {
    if (!selectedPath) return;
    setRelationConfigField(fieldName);
  }

  async function handleClearRelation(fieldName: string) {
    if (!selectedPath) return;
    const key = buildRelationKey({ sourceFile: selectedPath, sourceCollection: collectionPath, fieldPath: [fieldName] });
    mutateViewConfig((draft) => {
      delete draft.relations[key];
    });
    setStatus(`已清除关联字段 ${fieldName}，对应反向关联列将自动隐藏`);
  }

  function confirmRelationConfig(config: RelationConfig) {
    if (!selectedPath || !relationConfigField) return;
    const key = buildRelationKey({ sourceFile: selectedPath, sourceCollection: collectionPath, fieldPath: [relationConfigField] });
    mutateViewConfig((draft) => {
      draft.relations[key] = config;
    });
    setRelationConfigField(null);
  }

  function dismissPrimaryKeyCandidates() {
    if (!selectedCollectionKey) return;
    setDismissedCandidateKeys((current) => current.includes(selectedCollectionKey) ? current : [...current, selectedCollectionKey]);
  }

  function openPrimaryKeyCandidateDialog() {
    const nextValue = activePrimaryKeyCandidates.find((candidate) => candidate.confidence === "high")?.fieldName
      ?? activePrimaryKeyCandidates[0]?.fieldName
      ?? "";
    setSelectedPrimaryKeyCandidate(nextValue);
    setPrimaryKeyCandidateDialogOpen(true);
  }

  function confirmPrimaryKeyCandidate() {
    if (!selectedPath || !selectedPrimaryKeyCandidate) return;
    mutateViewConfig((draft) => {
      draft.primaryKeys[buildCollectionKey(selectedPath, collectionPath)] = selectedPrimaryKeyCandidate;
    });
    if (selectedCollectionKey) {
      setDismissedCandidateKeys((current) => current.filter((key) => key !== selectedCollectionKey));
    }
    setPrimaryKeyCandidateDialogOpen(false);
  }

  function handleHideField(fieldName: string) {
    if (!selectedPath) return;
    updateActiveViewLayout((draft) => {
      draft.hidden = addUnique(draft.hidden, fieldName);
    });
  }

  function handleUnhideField(fieldName: string) {
    if (!selectedPath) return;
    updateActiveViewLayout((draft) => {
      draft.hidden = draft.hidden.filter((value) => value !== fieldName);
    });
  }

  function handleUnhideAllFields() {
    if (!selectedPath) return;
    updateActiveViewLayout((draft) => {
      draft.hidden = [];
    });
  }

  function handleToggleWrapField(fieldName: string) {
    if (!selectedPath) return;
    updateActiveViewLayout((draft) => {
      draft.wrapped = draft.wrapped.includes(fieldName)
        ? draft.wrapped.filter((value) => value !== fieldName)
        : [...draft.wrapped, fieldName];
    });
  }

  function handleResizeField(fieldName: string, width: number) {
    if (!selectedPath) return;
    updateActiveViewLayout((draft) => {
      draft.widths[fieldName] = Math.round(width);
    });
  }

  function handleMoveField(fieldName: string, direction: "left" | "right") {
    if (!selectedPath || !model) return;
    const fields = getOrderedFields(model, collectionPath, fieldConfig.order, backlinkColumns.map((column) => column.fieldName));
    const currentOrder = fieldConfig.order.length ? fieldConfig.order.filter((field) => fields.includes(field)) : fields;
    const index = currentOrder.indexOf(fieldName);
    const targetIndex = direction === "left" ? index - 1 : index + 1;
    if (index < 0 || targetIndex < 0 || targetIndex >= currentOrder.length) return;
    const nextOrder = [...currentOrder];
    [nextOrder[index], nextOrder[targetIndex]] = [nextOrder[targetIndex], nextOrder[index]];
    updateActiveViewLayout((draft) => {
      draft.order = nextOrder;
    });
  }

  function handleReorderFields(nextOrder: string[]) {
    if (!selectedPath || !model) return;
    const fields = getOrderedFields(model, collectionPath, fieldConfig.order, backlinkColumns.map((column) => column.fieldName));
    const normalizedOrder = orderColumns(fields, nextOrder);
    updateActiveViewLayout((draft) => {
      draft.order = normalizedOrder;
    });
  }

  function handleReorderDetailFields(nextOrder: string[]) {
    if (!selectedPath) return;
    detailReorderPerfRef.current.active = true;
    detailReorderPerfRef.current.awaitingRows = false;
    detailReorderPerfRef.current.awaitingFieldConfig = true;
    detailReorderPerfRef.current.awaitingViewRows = false;
    detailReorderPerfRef.current.awaitingIssues = true;
    detailReorderPerfRef.current.awaitingBacklinks = false;
    detailReorderPerfRef.current.awaitingMaintenance = false;
    detailReorderPerfRef.current.awaitingMainContentRender = detailReorderReactProfilingEnabled;
    detailReorderPerfRef.current.awaitingTableRender = false;
    detailReorderPerfRef.current.awaitingDetailPanelRender = detailReorderReactProfilingEnabled;
    detailReorderPerfRef.current.awaitingViewTabsRender = detailReorderReactProfilingEnabled;
    detailReorderPerfRef.current.awaitingFilterBarRender = detailReorderReactProfilingEnabled && filterBarVisible;
    detailReorderPerfRef.current.awaitingPrimaryKeyBannerRender = detailReorderReactProfilingEnabled && showPrimaryKeyCandidateBanner && Boolean(selectedPath);
    markPerf("detail-reorder:start");
    markPerf("detail-reorder:before-profile-update");
    updateActiveViewLayout((draft) => {
      draft.detailOrder = [...nextOrder];
    }, { affectsTable: false });
  }

  function handleSort(fieldName: string, direction: "asc" | "desc" | null) {
    updateActiveViewDraft({ sorts: updateHeaderSorts(activeView?.sorts ?? [], fieldName, direction) as SortRule[] });
  }

  function handleAddFilter(fieldName: string, fieldType: FieldDisplayType) {
    if (!activeView) return;
    const currentRules = activeView.filters?.rules ?? [];
    if (currentRules.some((rule) => rule.field === fieldName)) return;
    const nextRule = createDefaultFilterRule(fieldName, fieldType, currentRules);
    setFilterBarVisible(true);
    setPendingOpenFilterRuleId(nextRule.id);
    updateActiveViewDraft({ filters: withRules(activeView.filters, [...currentRules, nextRule]) as FilterGroup });
  }

  function handleCommitMultiSelectOptionFieldDraft(rowIndex: number, fieldName: string, patch: OptionFieldDraftCommit) {
    if (!model) return;
    const needsDataMutation = patch.valueChanged || patch.renamedOptions.length > 0 || patch.deletedOptionValues.length > 0;
    const needsViewConfigMutation = patch.optionsChanged || patch.orderChanged;
    validationInvalidationRef.current = !needsViewConfigMutation && needsDataMutation
      ? (
        patch.renamedOptions.length === 0 && patch.deletedOptionValues.length === 0
          ? resolveValidationInvalidation(fieldName, null, rowIndex)
          : { type: "field", fieldName }
      )
      : { type: "full" };
    mutateOptionFieldTransaction({
      mutateData: needsDataMutation ? () => {
        const rows = getRows(model, collectionPath) as DataRecord[];
        for (const rename of patch.renamedOptions) {
          renameMultiSelectOptionInRows(rows, fieldName, rename.previousValue, rename.nextValue);
        }
        for (const optionValue of patch.deletedOptionValues) {
          removeMultiSelectOptionFromRows(rows, fieldName, optionValue);
        }
        setCellValue(model, collectionPath, rowIndex, fieldName, patch.nextSelectedValues);
      } : undefined,
      mutateViewConfigDraft: needsViewConfigMutation ? (draft) => {
        const key = fieldViewConfigKey(selectedPath, collectionPath, fieldName);
        if (!key) return;
        const current = ensureFieldViewConfig(draft, key);
        draft.fields[key] = {
          ...current,
          multiSelectOptions: buildOptionConfigFromOptions(patch.nextOptions) as typeof current.multiSelectOptions,
        };
      } : undefined,
    });
  }

  function handleCommitSelectOptionFieldDraft(rowIndex: number, fieldName: string, patch: OptionFieldDraftCommit) {
    if (!model) return;
    const needsDataMutation = patch.valueChanged || patch.renamedOptions.length > 0 || patch.deletedOptionValues.length > 0;
    const needsViewConfigMutation = patch.optionsChanged || patch.orderChanged;
    validationInvalidationRef.current = !needsViewConfigMutation && needsDataMutation
      ? (
        patch.renamedOptions.length === 0 && patch.deletedOptionValues.length === 0
          ? resolveValidationInvalidation(fieldName, null, rowIndex)
          : { type: "field", fieldName }
      )
      : { type: "full" };
    mutateOptionFieldTransaction({
      mutateData: needsDataMutation ? () => {
        const rows = getRows(model, collectionPath) as DataRecord[];
        for (const rename of patch.renamedOptions) {
          renameSingleSelectOptionInRows(rows, fieldName, rename.previousValue, rename.nextValue);
        }
        for (const optionValue of patch.deletedOptionValues) {
          removeSingleSelectOptionFromRows(rows, fieldName, optionValue);
        }
        setCellValue(model, collectionPath, rowIndex, fieldName, patch.nextSelectedValues[0] ?? null);
      } : undefined,
      mutateViewConfigDraft: needsViewConfigMutation ? (draft) => {
        const key = fieldViewConfigKey(selectedPath, collectionPath, fieldName);
        if (!key) return;
        const current = ensureFieldViewConfig(draft, key);
        draft.fields[key] = {
          ...current,
          selectOptions: buildOptionConfigFromOptions(patch.nextOptions) as typeof current.selectOptions,
        };
      } : undefined,
    });
  }

  function handleTableCommitSelectOptionFieldDraft(
    rowIndex: number,
    rowId: string | null,
    fieldName: string,
    patch: OptionFieldDraftCommit,
  ) {
    if (rowId) {
      handleCommitSelectOptionFieldDraftByRowId(rowId, fieldName, patch);
      return;
    }
    handleCommitSelectOptionFieldDraft(rowIndex, fieldName, patch);
  }

  async function handleSelectViewProfile(name: string) {
    flushActiveTextEditorDraft();
    await saveCoordinator.flush("flush");
    setSelectedViewProfileName(name === localProfileOptionValue ? null : name);
  }

  async function handleCreateViewProfile() {
    const name = newProfileName.trim();
    if (!name) return;
    const activeSnapshot = selectedPath && activeViewLayoutId
      ? readViewLayoutState({
        mode: selectedViewProfileName ? "profile" : "local",
        path: selectedPath,
        collectionPath,
        viewId: activeViewLayoutId,
        localState: readLocalViewState({
          path: selectedPath,
          collectionPath,
          viewId: activeViewLayoutId,
          localStorage: window.localStorage,
        }),
        profile: selectedViewProfileName ? selectedViewProfile : null,
      })
      : emptyLocalViewState();
    const profile = buildProfileFromCurrentView(selectedPath, collectionPath, {
      ...fieldConfig,
      hidden: new Set(activeSnapshot.hidden),
      wrapped: new Set(activeSnapshot.wrapped),
      widths: { ...activeSnapshot.widths },
      order: [...activeSnapshot.order],
      detailOrder: [...activeSnapshot.detailOrder],
    }, activeViewLayoutId, activeSnapshot.sidebarWidth ?? sidebarWidth, activeSnapshot.detailPanelWidth ?? detailPanelWidth, normalizeFileOrder(
      files,
      selectedViewProfileName ? selectedViewProfile.fileOrder : readLocalFileOrder(window.localStorage),
    ), resolveActiveSidebarPreferences(files, selectedViewProfileName, selectedViewProfile, window.localStorage).sidebarTree, uiPreferences);
    try {
      await saveViewProfile(name, profile, activeProjectId);
      setViewProfiles((current) => current.includes(name) ? current : [...current, name].sort((left, right) => left.localeCompare(right, undefined, { numeric: true })));
      setSelectedViewProfileName(name);
      setSelectedViewProfile(profile);
      setNewProfileName("");
      setNewProfileOpen(false);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function selectRow(rowIndex: number, rowId: string | null = null) {
    flushSelectedSourceRow(rowIndex, rowId ?? getRowIdAtSourceIndex(rowIndex));
  }

  function selectRowById(rowId: string | null, sourceRowIndex: number | null = null) {
    const resolvedSourceIndex = resolveSourceIndexFromRowId(rowId, sourceRowIndex);
    flushSelectedSourceRow(resolvedSourceIndex, rowId ?? getRowIdAtSourceIndex(resolvedSourceIndex));
  }

  function beginSidebarResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    document.body.classList.add("is-resizing-sidebar");

    function onPointerMove(moveEvent: PointerEvent) {
      const nextWidth = clampSidebarWidth(startWidth + moveEvent.clientX - startX);
      setSidebarWidth(nextWidth);
    }

    function onPointerUp(upEvent: PointerEvent) {
      const nextWidth = clampSidebarWidth(startWidth + upEvent.clientX - startX);
      setSidebarWidth(nextWidth);
      if (!mutateSelectedViewProfile((draft) => { draft.sidebarWidth = nextWidth; })) {
        if (selectedPath && activeViewLayoutId) {
          const nextState = readLocalViewState({
            path: selectedPath,
            collectionPath,
            viewId: activeViewLayoutId,
            localStorage: window.localStorage,
          });
          writeLocalViewState({
            path: selectedPath,
            collectionPath,
            viewId: activeViewLayoutId,
            state: {
              ...nextState,
              sidebarWidth: nextWidth,
            },
            localStorage: window.localStorage,
          });
        } else {
          localStorage.setItem(sidebarWidthStorageKey, String(nextWidth));
        }
      }
      document.body.classList.remove("is-resizing-sidebar");
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
    }

    function onPointerCancel() {
      document.body.classList.remove("is-resizing-sidebar");
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
  }

  function handleDetailPanelWidthChange(width: number) {
    setDetailPanelWidth(clampDetailPanelWidth(width));
  }

  function commitDetailPanelWidth(width: number) {
    const nextWidth = clampDetailPanelWidth(width);
    setDetailPanelWidth(nextWidth);
    if (!mutateSelectedViewProfile((draft) => { draft.detailPanelWidth = nextWidth; })) {
      if (selectedPath && activeViewLayoutId) {
        const nextState = readLocalViewState({
          path: selectedPath,
          collectionPath,
          viewId: activeViewLayoutId,
          localStorage: window.localStorage,
        });
        writeLocalViewState({
          path: selectedPath,
          collectionPath,
          viewId: activeViewLayoutId,
          state: {
            ...nextState,
            detailPanelWidth: nextWidth,
          },
          localStorage: window.localStorage,
        });
      } else {
        localStorage.setItem(detailPanelWidthStorageKey, String(nextWidth));
      }
    }
  }

  function openDetail(rowIndex: number) {
    flushSync(() => {
      setSelectedRowIndex(rowIndex);
      setSelectedRowIdState(getRowIdAtSourceIndex(rowIndex));
      setDetailOpen(true);
    });
  }

  function openDetailForRow(rowIndex: number, rowId: string | null) {
    const resolvedSourceIndex = resolveSourceIndexFromRowId(rowId, rowIndex);
    flushSync(() => {
      setSelectedRowIndex(resolvedSourceIndex);
      setSelectedRowIdState(rowId ?? getRowIdAtSourceIndex(resolvedSourceIndex));
      setDetailOpen(true);
    });
  }

  function handleAddRow() {
    if (!model) return;
    const columns = getMainColumns(model, collectionPath);
    const nextRow: DataRecord = {};
    for (const fieldName of columns) nextRow[fieldName] = defaultEmptyValue(fieldConfig.displayTypes[fieldName]);
    mutate(() => {
      addRow(model, collectionPath, nextRow);
      setSelectedSourceRow(rows.length, null);
    });
  }

  function handleDeleteRow(rowIndex: number, rowId: string | null = null) {
    setPendingDeleteRow(rowIndex);
    setPendingDeleteRowId(rowId);
  }

  function confirmDeleteRow() {
    if (!model || pendingDeleteRow == null) return;
    const pendingRowId = pendingDeleteRowId ?? collectionStore?.rowViews[pendingDeleteRow]?.rowId ?? null;
    mutate(() => {
      if (pendingRowId && documentStore) {
        deleteRowByRowId({ model, store: documentStore, collectionPath, rowId: pendingRowId });
      } else {
        deleteRow(model, collectionPath, pendingDeleteRow);
      }
      const nextSelectedRowIndex = rows.length <= 1 ? null : Math.min(pendingDeleteRow, rows.length - 2);
      setSelectedSourceRow(nextSelectedRowIndex, pendingRowId);
    });
    setPendingDeleteRow(null);
    setPendingDeleteRowId(null);
  }

  function handleAddField() {
    setNewFieldName("");
    setNewFieldType("Text");
    setNewFieldApplyAll(false);
    setAddFieldOpen(true);
  }

  function confirmAddField() {
    if (!model || selectedSourceRowIndex == null || !newFieldName.trim()) return;
    const fieldName = newFieldName.trim();
    const currentSelectedRowId = selectedRowId;
    mutate(() => {
      if (currentSelectedRowId && documentStore) {
        addFieldByRowId({
          model,
          store: documentStore,
          collectionPath,
          rowId: currentSelectedRowId,
          fieldName,
          value: defaultEmptyValue(newFieldType),
          applyToAll: newFieldApplyAll,
        });
        return;
      }
      addField(model, collectionPath, selectedSourceRowIndex, fieldName, defaultEmptyValue(newFieldType), newFieldApplyAll);
    });
    if (selectedPath && (newFieldType === "Text" || newFieldType === "Select")) {
      mutateViewConfig((draft) => {
        const key = fieldViewConfigKey(selectedPath, collectionPath, fieldName);
        if (!key) return;
        const current = ensureFieldViewConfig(draft, key);
        current.type = newFieldType as RealFieldType;
      });
    }
    setAddFieldOpen(false);
  }

  function handleDeleteField(fieldName: string) {
    setPendingDeleteField(fieldName);
  }

  function confirmDeleteField() {
    if (!model || !pendingDeleteField) return;
    mutate(() => deleteField(model, collectionPath, pendingDeleteField));
    setPendingDeleteField(null);
  }

  function handleResetView() {
    if (!selectedPath || !activeViewLayoutId) return;
    if (mutateSelectedViewProfile((draft) => {
      const result = resetViewLayoutState({
        mode: "profile",
        path: selectedPath,
        collectionPath,
        viewId: activeViewLayoutId,
        profile: draft,
        localState: null,
      });
      draft.sidebarWidth = result.profile.sidebarWidth;
      draft.detailPanelWidth = result.profile.detailPanelWidth;
      draft.fileOrder = result.profile.fileOrder;
      draft.sidebarTree = result.profile.sidebarTree;
      draft.lastActiveViews = result.profile.lastActiveViews;
      draft.viewDrafts = result.profile.viewDrafts;
      draft.viewOrderDrafts = result.profile.viewOrderDrafts;
      draft.viewLayouts = result.profile.viewLayouts;
      draft.collections = result.profile.collections;
      if (result.profile.appearance) draft.appearance = result.profile.appearance;
      setSidebarWidth(defaultSidebarWidth);
      setDetailPanelWidth(defaultDetailPanelWidth);
    })) return;
    writeLocalViewState({
      path: selectedPath,
      collectionPath,
      viewId: activeViewLayoutId,
      state: emptyLocalViewState(),
      localStorage: window.localStorage,
    });
    setSidebarWidth(readSidebarWidth());
    setDetailPanelWidth(readDetailPanelWidth());
    bumpLayoutRevision((value) => value + 1);
    bumpTableRevision((value) => value + 1);
  }

  function updateSharedViewDraftState(next: SharedViewDraftState) {
    if (mutateSelectedViewProfile((draft) => {
      draft.lastActiveViews = next.lastActiveViews;
      draft.viewDrafts = next.viewDrafts;
      draft.viewOrderDrafts = next.viewOrderDrafts;
    })) {
      selectedViewProfileRef.current = {
        ...selectedViewProfileRef.current,
        lastActiveViews: next.lastActiveViews,
        viewDrafts: next.viewDrafts,
        viewOrderDrafts: next.viewOrderDrafts,
      };
      setViewDraftDirty(hasSharedDrafts(next));
      return;
    }
    setLocalSharedViewDrafts(next);
    writeLocalSharedViewDrafts(window.localStorage, next);
    setViewDraftDirty(hasSharedDrafts(next));
  }

  function currentSharedViewDraftState(): SharedViewDraftState {
    return selectedViewProfileName ? selectedViewProfileRef.current : localSharedViewDrafts;
  }

  function handleSelectSharedView(viewId: string) {
    if (commandSaving || !activeCollectionKey) return;
    const current = currentSharedViewDraftState();
    updateSharedViewDraftState({
      lastActiveViews: { ...current.lastActiveViews, [activeCollectionKey]: viewId },
      viewDrafts: { ...current.viewDrafts },
      viewOrderDrafts: { ...current.viewOrderDrafts },
    });
    setSelectedSourceRow(0);
    setDetailOpen(false);
  }

  async function handleCreateSharedView() {
    if (commandSaving || !activeCollectionKey || !activeSharedView || !activeView) return;
    setCommandSaving(true);
    setStatus("");
    try {
      const result = createSharedViewConfig(sharedViewsConfig, activeCollectionKey, activeSharedView.id, activeView);
      const nextConfig = result.config as SharedViewsConfig;
      await saveSharedViews(nextConfig, activeProjectId);
      setSharedViewsConfig(nextConfig);
      const current = currentSharedViewDraftState();
      updateSharedViewDraftState({
        lastActiveViews: { ...current.lastActiveViews, [activeCollectionKey]: result.view.id },
        viewDrafts: { ...current.viewDrafts },
        viewOrderDrafts: { ...current.viewOrderDrafts },
      });
      setStatus("已创建团队共享视图");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setCommandSaving(false);
    }
  }

  async function handleDuplicateSharedView(viewId: string) {
    if (commandSaving || !activeCollectionKey || !selectedPath) return;
    const sourceView = orderedCollectionViews.find((view: CollectionView) => view.id === viewId);
    if (!sourceView) return;
    const draft = draftSource.viewDrafts?.[activeCollectionKey]?.[viewId];
    const snapshot = mergeSharedViewWithDraft(sourceView, draft) as CollectionView;
    const duplicateNameBase = `${snapshot.name} 副本`.trim();
    setCommandSaving(true);
    setStatus("");
    try {
      const result = createSharedViewConfig(sharedViewsConfig, activeCollectionKey, viewId, snapshot, {
        nameBase: duplicateNameBase,
      });
      const nextConfig = result.config as SharedViewsConfig;
      await saveSharedViews(nextConfig, activeProjectId);
      setSharedViewsConfig(nextConfig);
      if (selectedViewProfileName) {
        mutateSelectedViewProfile((draftProfile) => {
          const copyResult = copyViewLayoutState({
            mode: "profile",
            path: selectedPath,
            collectionPath,
            sourceViewId: viewId,
            targetViewId: result.view.id,
            profile: draftProfile,
            localStorage: null,
          });
          draftProfile.viewLayouts = copyResult.profile.viewLayouts;
          draftProfile.collections = copyResult.profile.collections;
        });
      } else {
        copyViewLayoutState({
          mode: "local",
          path: selectedPath,
          collectionPath,
          sourceViewId: viewId,
          targetViewId: result.view.id,
          profile: null,
          localStorage: window.localStorage,
        });
      }
      const current = currentSharedViewDraftState();
      const nextViewOrderDrafts = { ...current.viewOrderDrafts };
      if (nextViewOrderDrafts[activeCollectionKey]?.length) {
        nextViewOrderDrafts[activeCollectionKey] = insertViewIdAfter(
          orderedCollectionViews.map((view: CollectionView) => view.id),
          viewId,
          result.view.id,
        );
      }
      updateSharedViewDraftState({
        lastActiveViews: { ...current.lastActiveViews, [activeCollectionKey]: result.view.id },
        viewDrafts: { ...current.viewDrafts },
        viewOrderDrafts: nextViewOrderDrafts,
      });
      setStatus("已创建团队共享视图副本");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setCommandSaving(false);
    }
  }

  async function handleRenameSharedView(viewId: string, name: string) {
    if (commandSaving || !activeCollectionKey) return;
    setCommandSaving(true);
    setStatus("");
    try {
      const nextConfig = renameSharedViewConfig(sharedViewsConfig, activeCollectionKey, viewId, name) as SharedViewsConfig;
      await saveSharedViews(nextConfig, activeProjectId);
      setSharedViewsConfig(nextConfig);
      setStatus("已重命名团队共享视图");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setCommandSaving(false);
    }
  }

  async function handleDeleteSharedView(viewId: string) {
    if (commandSaving || !activeCollectionKey || !selectedPath) return;
    const current = currentSharedViewDraftState();
    const result = deleteSharedViewConfig(sharedViewsConfig, current, activeCollectionKey, viewId);
    if (!result.deleted) {
      setStatus("至少需要保留一个团队共享视图");
      return;
    }
    setCommandSaving(true);
    setStatus("");
    try {
      const nextConfig = result.config as SharedViewsConfig;
      await saveSharedViews(nextConfig, activeProjectId);
      setSharedViewsConfig(nextConfig);
      if (mutateSelectedViewProfile((draft) => {
        const collectionLayouts = draft.viewLayouts?.[activeCollectionKey];
        if (collectionLayouts) {
          delete collectionLayouts[viewId];
          if (Object.keys(collectionLayouts).length === 0) delete draft.viewLayouts[activeCollectionKey];
        }
        if (draft.collections?.[activeCollectionKey] && draft.lastActiveViews?.[activeCollectionKey] === viewId) {
          delete draft.collections[activeCollectionKey];
        }
      })) {
        // profile mode handled above
      } else {
        deleteLocalViewState({
          path: selectedPath,
          collectionPath,
          viewId,
          localStorage: window.localStorage,
        });
      }
      updateSharedViewDraftState(result.draftState);
      setSelectedSourceRow(0);
      setDetailOpen(false);
      setStatus("已删除团队共享视图");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setCommandSaving(false);
    }
  }

  function handleReorderSharedViews(viewIds: string[]) {
    if (commandSaving || !activeCollectionKey) return;
    const next = draftSharedViewOrder(currentSharedViewDraftState(), activeCollectionKey, collectionSharedViews, viewIds);
    updateSharedViewDraftState(next);
  }

  function handleResetSharedViewDraft() {
    if (commandSaving || !activeCollectionKey || !activeSharedView) return;
    if (mutateSelectedViewProfile((draft) => {
      const result = resetActiveSharedViewDraft(draft, activeCollectionKey, activeSharedView.id);
      draft.lastActiveViews = result.draftState.lastActiveViews;
      draft.viewDrafts = result.draftState.viewDrafts;
      draft.viewOrderDrafts = result.draftState.viewOrderDrafts;
      setViewDraftDirty(result.dirty);
    })) return;
    setLocalSharedViewDrafts((current) => {
      const result = resetActiveSharedViewDraft(current, activeCollectionKey, activeSharedView.id);
      writeLocalSharedViewDrafts(window.localStorage, result.draftState);
      setViewDraftDirty(result.dirty);
      return result.draftState;
    });
  }

  function handleCommitSelectOptionFieldDraftByRowId(rowId: string, fieldName: string, patch: OptionFieldDraftCommit) {
    if (!model || !documentStore) return;
    const needsDataMutation = patch.valueChanged || patch.renamedOptions.length > 0 || patch.deletedOptionValues.length > 0;
    const needsViewConfigMutation = patch.optionsChanged || patch.orderChanged;
    validationInvalidationRef.current = !needsViewConfigMutation && needsDataMutation
      ? (
        patch.renamedOptions.length === 0 && patch.deletedOptionValues.length === 0
          ? resolveValidationInvalidation(fieldName, rowId, null)
          : { type: "field", fieldName }
      )
      : { type: "full" };
    mutateOptionFieldTransaction({
      mutateData: needsDataMutation ? () => {
        const rows = getRows(model, collectionPath) as DataRecord[];
        for (const rename of patch.renamedOptions) {
          renameSingleSelectOptionInRows(rows, fieldName, rename.previousValue, rename.nextValue);
        }
        for (const optionValue of patch.deletedOptionValues) {
          removeSingleSelectOptionFromRows(rows, fieldName, optionValue);
        }
        setCellValueByRowId({ model, store: documentStore, collectionPath, rowId, fieldName, value: patch.nextSelectedValues[0] ?? null });
      } : undefined,
      mutateViewConfigDraft: needsViewConfigMutation ? (draft) => {
        const key = fieldViewConfigKey(selectedPath, collectionPath, fieldName);
        if (!key) return;
        const current = ensureFieldViewConfig(draft, key);
        draft.fields[key] = {
          ...current,
          selectOptions: buildOptionConfigFromOptions(patch.nextOptions) as typeof current.selectOptions,
        };
      } : undefined,
    });
  }

  function handleCommitMultiSelectOptionFieldDraftByRowId(rowId: string, fieldName: string, patch: OptionFieldDraftCommit) {
    if (!model || !documentStore) return;
    const needsDataMutation = patch.valueChanged || patch.renamedOptions.length > 0 || patch.deletedOptionValues.length > 0;
    const needsViewConfigMutation = patch.optionsChanged || patch.orderChanged;
    validationInvalidationRef.current = !needsViewConfigMutation && needsDataMutation
      ? (
        patch.renamedOptions.length === 0 && patch.deletedOptionValues.length === 0
          ? resolveValidationInvalidation(fieldName, rowId, null)
          : { type: "field", fieldName }
      )
      : { type: "full" };
    mutateOptionFieldTransaction({
      mutateData: needsDataMutation ? () => {
        const rows = getRows(model, collectionPath) as DataRecord[];
        for (const rename of patch.renamedOptions) {
          renameMultiSelectOptionInRows(rows, fieldName, rename.previousValue, rename.nextValue);
        }
        for (const optionValue of patch.deletedOptionValues) {
          removeMultiSelectOptionFromRows(rows, fieldName, optionValue);
        }
        setCellValueByRowId({ model, store: documentStore, collectionPath, rowId, fieldName, value: patch.nextSelectedValues });
      } : undefined,
      mutateViewConfigDraft: needsViewConfigMutation ? (draft) => {
        const key = fieldViewConfigKey(selectedPath, collectionPath, fieldName);
        if (!key) return;
        const current = ensureFieldViewConfig(draft, key);
        draft.fields[key] = {
          ...current,
          multiSelectOptions: buildOptionConfigFromOptions(patch.nextOptions) as typeof current.multiSelectOptions,
        };
      } : undefined,
    });
  }

  function handleTableCommitMultiSelectOptionFieldDraft(
    rowIndex: number,
    rowId: string | null,
    fieldName: string,
    patch: OptionFieldDraftCommit,
  ) {
    if (rowId) {
      handleCommitMultiSelectOptionFieldDraftByRowId(rowId, fieldName, patch);
      return;
    }
    handleCommitMultiSelectOptionFieldDraft(rowIndex, fieldName, patch);
  }

  async function handleSaveViewForEveryone() {
    if (commandSaving || !activeCollectionKey || !activeSharedView) return;
    const current = currentSharedViewDraftState();
    if (!hasViewDraft(current, activeCollectionKey, activeSharedView.id)) return;
    setCommandSaving(true);
    setStatus("");
    try {
      const result = saveSharedViewDraftsToConfig(sharedViewsConfig, current, activeCollectionKey, activeSharedView.id);
      const nextConfig = result.config as SharedViewsConfig;
      await saveSharedViews(nextConfig, activeProjectId);
      setSharedViewsConfig(nextConfig);
      updateSharedViewDraftState(result.draftState);
      setStatus("已保存当前团队共享视图");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setCommandSaving(false);
    }
  }

  function shouldInterceptPrimaryKeySync(currentDataDirty: boolean, force = false) {
    return shouldInterceptPrimaryKeySyncPlan(primaryKeySyncPlanRef.current, currentDataDirty, force);
  }

  function shouldInterceptPrimaryKeySyncPlan(plan: PrimaryKeySyncPlan | null, currentDataDirty: boolean, _force = false) {
    return Boolean(
      currentDataDirty
      && plan
      && plan.oldValue !== plan.newValue
      && (plan.rewrites.length > 0 || plan.blockingIssues.length > 0),
    );
  }

  async function resolvePrimaryKeySyncPlanForFlush(
    currentModel: DocumentModel,
    currentSelectedPath: string,
    currentViewConfig: ViewConfig,
  ) {
    const currentCollectionPath = collectionPathRef.current;
    const currentSelectedRowId = selectedRowIdRef.current;
    const store = documentStoreRef.current?.collections.get(currentCollectionPath) ?? null;
    const currentSelectedSourceRowIndex = currentSelectedRowId && store?.sourceIndexByRowId.has(currentSelectedRowId)
      ? store.sourceIndexByRowId.get(currentSelectedRowId)!
      : selectedSourceRowIndexRef.current;
    const currentTitleField = titleFieldRef.current;
    const currentRows = getRows(currentModel, currentCollectionPath) as DataRecord[];
    const currentSelectedRow = currentSelectedSourceRowIndex == null ? null : (currentRows[currentSelectedSourceRowIndex] ?? null);
    const nextState = await buildMaintenanceLookupState({
      selectedPath: currentSelectedPath,
      collectionPath: currentCollectionPath,
      selectedRow: currentSelectedRow,
      selectedSourceRowIndex: currentSelectedSourceRowIndex,
      selectedRowLabel: getRecordTitle(currentSelectedRow, currentTitleField ? [currentTitleField] : [], currentSelectedSourceRowIndex ?? null),
      model: currentModel,
      rows: currentRows,
      savedRoot: savedDocumentRootRef.current,
      viewConfig: currentViewConfig,
      activeProjectId: activeProjectIdRef.current,
      loadDocument: (path) => loadDocument(path, activeProjectIdRef.current),
    });
    setRelationBacklinks(nextState.relationBacklinks);
    setPrimaryKeyImpacts(nextState.primaryKeyImpacts);
    setPrimaryKeySyncPlan(nextState.primaryKeySyncPlan);
    primaryKeySyncPlanRef.current = nextState.primaryKeySyncPlan;
    return nextState.primaryKeySyncPlan;
  }

  async function flushAutosaveTargets(_reason: string, dirtyDomains: AutosaveDomain[]) {
    const currentModel = modelRef.current;
    const currentSelectedPath = selectedPathRef.current;
    const currentDataDirty = dataDirtyRef.current;
    const currentViewConfig = viewConfigRef.current;
    const currentViewConfigDirty = viewConfigDirtyRef.current;
    const currentProfileDirty = profileDirtyRef.current;
    const currentProfileName = selectedViewProfileNameRef.current;
    const currentProjectId = activeProjectIdRef.current;
    let currentPrimaryKeySyncPlan = primaryKeySyncPlanRef.current;
    if (!dirtyDomains.length) return { outcome: "idle" } as const;
    if (commandSavingRef.current || closingRef.current || rebuildingRef.current) return { outcome: "deferred" } as const;
    if (currentDataDirty && currentModel && currentSelectedPath && !currentPrimaryKeySyncPlan) {
      currentPrimaryKeySyncPlan = await resolvePrimaryKeySyncPlanForFlush(currentModel, currentSelectedPath, currentViewConfig);
    }
    if (currentDataDirty && currentModel && currentSelectedPath && shouldInterceptPrimaryKeySyncPlan(currentPrimaryKeySyncPlan, currentDataDirty, false)) {
      if (currentPrimaryKeySyncPlan?.blockingIssues.length) {
        setStatus(describePrimaryKeySyncBlockingIssues(currentPrimaryKeySyncPlan));
        return { outcome: "blocked-confirmation" } as const;
      }
      setStatus("");
      try {
        const snapshot = await buildPrimaryKeySyncSaveSnapshot({
          plan: currentPrimaryKeySyncPlan!,
          currentModel,
          currentPath: currentSelectedPath,
          loadDocument: (path) => loadDocument(path, activeProjectIdRef.current),
        });
        primaryKeySyncSnapshotRef.current = snapshot;
        setPrimaryKeySyncResult(null);
        setPrimaryKeySyncDialogOpen(true);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
        throw error;
      }
      return { outcome: "blocked-confirmation" } as const;
    }
    autosaveInFlightRef.current = true;
    setStatus("");
    try {
      if (dirtyDomains.includes("document") && currentDataDirty && currentModel && currentSelectedPath) {
        await saveDocument(currentSelectedPath, currentModel.root, currentProjectId);
        savedDocumentRootRef.current = cloneDataRoot(currentModel.root);
        dataDirtyRef.current = false;
        setDataDirty(false);
      }
      if (dirtyDomains.includes("project-config") && currentViewConfigDirty) {
        await saveViewConfig(currentViewConfig, currentProjectId);
        viewConfigDirtyRef.current = false;
        setViewConfigDirty(false);
      }
      if (dirtyDomains.includes("profile") && currentProfileDirty && currentProfileName) {
        await commitProfileSave(currentProfileName, selectedViewProfileRef.current);
        profileDirtyRef.current = false;
        setProfileDirty(false);
      }
      return { outcome: "saved" } as const;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      autosaveInFlightRef.current = false;
    }
  }

  async function persistChanges(forcePrimaryKeySync = false) {
    const currentDataDirty = dataDirtyRef.current;
    if (forcePrimaryKeySync && currentDataDirty && shouldInterceptPrimaryKeySync(currentDataDirty, true)) {
      if (primaryKeySyncPlan?.blockingIssues.length) {
        setStatus(describePrimaryKeySyncBlockingIssues(primaryKeySyncPlan));
        return;
      }
      const currentModel = modelRef.current;
      const currentSelectedPath = selectedPathRef.current;
      if (!currentModel || !currentSelectedPath || commandSaving || closing || rebuilding) return;
      setCommandSaving(true);
      setStatus("");
      try {
        const snapshot = await buildPrimaryKeySyncSaveSnapshot({
          plan: primaryKeySyncPlan!,
          currentModel,
          currentPath: currentSelectedPath,
          loadDocument: (path) => loadDocument(path, activeProjectIdRef.current),
        });
        primaryKeySyncSnapshotRef.current = snapshot;
        setPrimaryKeySyncResult(null);
        setPrimaryKeySyncDialogOpen(true);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
      } finally {
        setCommandSaving(false);
      }
      return;
    }
    flushActiveTextEditorDraft();
    await saveCoordinator.flush("flush");
  }

  async function confirmPrimaryKeySyncSave() {
    const snapshot = primaryKeySyncSnapshotRef.current;
    const currentSelectedPath = selectedPathRef.current;
    if (!snapshot || !currentSelectedPath) return;
    setCommandSaving(true);
    setStatus("");
    try {
      const result = await saveDocuments(snapshot.pendingSaves, activeProjectId);
      setPrimaryKeySyncResult(result);
      if (!result.ok) {
        setStatus(describePrimaryKeySyncSaveResult(result));
        return;
      }
      if (viewConfigDirtyRef.current) await saveViewConfig(viewConfigRef.current, activeProjectId);
      if (profileDirtyRef.current && selectedViewProfileNameRef.current) {
        await commitProfileSave(selectedViewProfileNameRef.current, selectedViewProfileRef.current);
        profileDirtyRef.current = false;
        setProfileDirty(false);
      } else {
        await flushPendingProfileSave();
      }
      savedDocumentRootRef.current = cloneDataRoot(snapshot.pendingSaves[0]?.root ?? null);
      dataDirtyRef.current = false;
      viewConfigDirtyRef.current = false;
      setDataDirty(false);
      setViewConfigDirty(false);
      setPrimaryKeySyncDialogOpen(false);
      primaryKeySyncSnapshotRef.current = null;
      setAutosaveState("idle");
      setStatus(`已同步更新 ${snapshot.plan.rewrites.length} 条关联引用。`);
      await openDocumentAt(currentSelectedPath, collectionPath, selectedSourceRowIndex ?? undefined, detailOpen, activeProjectId, selectedRowId ?? undefined);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setCommandSaving(false);
    }
  }

  async function handleCloseServer() {
    if (closing || commandSaving || rebuilding) return;
    if (globalDirty && !window.confirm("有未保存更改，关闭服务会丢失这些更改。是否继续关闭？")) return;
    setClosing(true);
    setStatus("");
    try {
      flushActiveTextEditorDraft();
      await saveCoordinator.flush("flush");
      manualClosedRef.current = true;
      await shutdownServer();
      autoRecoverAttemptedRef.current = false;
      setServiceLifecycleState("closed");
    } catch (error) {
      manualClosedRef.current = false;
      setStatus(error instanceof Error ? error.message : String(error));
      setClosing(false);
    }
  }

  async function handleRefreshBuild() {
    if (rebuilding || closing || commandSaving) return;
    if (globalDirty && !window.confirm("有未保存更改，刷新构建会丢失这些更改。是否继续刷新构建？")) return;
    setRebuilding(true);
    setStatus("");
    try {
      flushActiveTextEditorDraft();
      await saveCoordinator.flush("flush");
      await rebuildFrontend();
      rememberTransientStatus("构建成功，页面已刷新");
      window.location.reload();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`构建失败：${message}`);
      setRebuilding(false);
    }
  }

  async function handleRecoverEditor() {
    if (closing || rebuilding || commandSaving) return;
    setDisconnectMessage("");
    setServiceLifecycleState("recovering");
    try {
      await reopenEditor(bridgePortRef.current);
      if (hasUnsavedChanges()) {
        setServiceLifecycleState("recoveredPendingReload");
        return;
      }
      window.location.reload();
    } catch (error) {
      setDisconnectMessage(error instanceof Error ? error.message : String(error));
      setServiceLifecycleState("disconnected");
    }
  }

  function handleReloadEditor() {
    window.location.reload();
  }

  if (serviceLifecycleState === "closed") {
    return (
      <main className="app-frame server-closed-page" style={appFrameStyle}>
        <section className="server-closed-state">
          <h1>服务已关闭</h1>
          <p>data-editor 后台服务已经停止。</p>
          <p>需要重新打开才能继续使用编辑器。</p>
        </section>
      </main>
    );
  }

  if (serviceLifecycleState === "recovering") {
    return (
      <main className="app-frame server-closed-page" style={appFrameStyle}>
        <section className="server-closed-state service-state--recovering">
          <h1>正在恢复编辑器</h1>
          <p>编辑器服务已断开，正在尝试自动恢复。</p>
        </section>
      </main>
    );
  }

  if (serviceLifecycleState === "recoveredPendingReload") {
    return (
      <main className="app-frame server-closed-page" style={appFrameStyle}>
        <section className="server-closed-state service-state--recovered-pending-reload">
          <h1>服务已恢复，等待重载</h1>
          <p>编辑器服务已经恢复，但当前仍有未保存改动。</p>
          <p>重新载入编辑器会丢失这些未保存改动。</p>
          <div className="server-state-actions">
            <button className="primary-button" onClick={handleReloadEditor} type="button">
              重新载入编辑器
            </button>
          </div>
        </section>
      </main>
    );
  }

  if (serviceLifecycleState === "disconnected") {
    return (
      <main className="app-frame server-closed-page" style={appFrameStyle}>
        <section className="server-closed-state service-state--disconnected">
          <h1>服务已断开</h1>
          <p>自动恢复未成功。你可以手动尝试恢复编辑器。</p>
          {disconnectMessage ? <p className="status-text">{disconnectMessage}</p> : null}
          <div className="server-state-actions">
            <button className="primary-button" onClick={() => void handleRecoverEditor()} type="button">
              恢复编辑器
            </button>
          </div>
        </section>
      </main>
    );
  }

  if (serviceLifecycleState === "bridgeUnavailable") {
    return (
      <main className="app-frame server-closed-page" style={appFrameStyle}>
        <section className="server-closed-state service-state--bridge-unavailable">
          <h1>恢复入口不可用</h1>
          <p>当前无法通过页面自动恢复编辑器。</p>
          <p>请重新打开编辑器后，再刷新这个页面。</p>
          {disconnectMessage ? <p className="status-text">{disconnectMessage}</p> : null}
          <div className="server-state-actions">
            <button className="ghost-button" onClick={handleReloadEditor} type="button">
              重新打开编辑器
            </button>
          </div>
        </section>
      </main>
    );
  }

  if (!model) {
    return (
      <main className="app-frame" style={appFrameStyle}>
        <Sidebar
          projects={projects}
          activeProjectId={activeProjectId}
        files={orderedFiles}
        selectedPath={selectedPath}
        collections={[]}
        selectedCollection="$"
        metadata={[]}
        sidebarTreePreferences={activeSidebarPreferences.sidebarTree}
        sidebarTreeHasExplicitExpandedNodeIds={activeSidebarPreferences.hasExplicitExpandedNodeIds}
        onSelectFile={openFile}
        onReorderFiles={handleReorderFiles}
        onExpandedNodeIdsChange={handleSidebarExpandedNodeIdsChange}
        onSelectCollection={(path) => {
          setCollectionPath(path);
          setSelectedSourceRow(0, null);
          }}
          onSelectProject={selectProject}
          onOpenProjectSettings={() => setProjectSettingsOpen(true)}
        />
        <div className="sidebar-resize-handle" onPointerDown={beginSidebarResize} aria-label="调整左侧栏宽度" role="separator" />
        <section className="empty-state">{status || "Loading..."}</section>
        <ProjectSettingsDialog
          open={projectSettingsOpen}
          projects={projects}
          activeProjectId={activeProjectId}
          onOpenChange={setProjectSettingsOpen}
          onSaveProject={saveProjectSettings}
          onCreateProject={createProjectFromSettings}
        />
      </main>
    );
  }

  return (
    <main className="app-frame" style={appFrameStyle}>
      <Sidebar
        projects={projects}
        activeProjectId={activeProjectId}
        files={orderedFiles}
        selectedPath={selectedPath}
        collections={model.collections}
        selectedCollection={collectionPath}
        candidateCollections={candidateCollections}
        metadata={model.metadata ?? []}
        sidebarTreePreferences={activeSidebarPreferences.sidebarTree}
        sidebarTreeHasExplicitExpandedNodeIds={activeSidebarPreferences.hasExplicitExpandedNodeIds}
        onSelectFile={openFile}
        onReorderFiles={handleReorderFiles}
        onExpandedNodeIdsChange={handleSidebarExpandedNodeIdsChange}
        onSelectCollection={(path) => {
          setCollectionPath(path);
          setSelectedSourceRow(0, null);
          setDetailOpen(false);
        }}
        onSelectProject={selectProject}
        onOpenProjectSettings={() => setProjectSettingsOpen(true)}
      />
      <div className="sidebar-resize-handle" onPointerDown={beginSidebarResize} aria-label="调整左侧栏宽度" role="separator" />
      <section className="workspace">
        <Toolbar
          snapshot={toolbarSnapshot}
          onQueryChange={(value) => updateActiveViewDraft({ query: value })}
          onRefreshBuild={handleRefreshBuild}
          onCloseServer={handleCloseServer}
          onResetView={handleResetView}
          onSelectViewProfile={handleSelectViewProfile}
          onCreateViewProfile={() => setNewProfileOpen(true)}
          onChangeTheme={handleChangeTheme}
          onChangeBaseFontSize={handleChangeBaseFontSize}
          onUnhideField={handleUnhideField}
          onUnhideAllFields={handleUnhideAllFields}
        />
        {detailReorderReactProfilingEnabled ? (
          <Profiler id="main-content" onRender={handleDetailReorderProfilerRender}>
            <div className="main-content">
              <Profiler id="view-tabs" onRender={handleDetailReorderProfilerRender}>
                <ViewTabs
                  snapshot={viewTabsSnapshot}
                  onSelectView={handleSelectSharedView}
                  onCreateView={handleCreateSharedView}
                  onRenameView={handleRenameSharedView}
                  onDeleteView={handleDeleteSharedView}
                  onDuplicateView={handleDuplicateSharedView}
                  onReorderViews={handleReorderSharedViews}
                  onToggleFilterBar={() => setFilterBarVisible((value) => !value)}
                  onToggleTableTextEditMode={() => setTableTextEditMode((value) => !value)}
                  onToggleRowDeleteControls={() => setRowDeleteControlsVisible((value) => !value)}
                />
              </Profiler>
              {filterBarVisible ? (
                <Profiler id="view-filter-bar" onRender={handleDetailReorderProfilerRender}>
                  <ViewFilterBar
                    snapshot={viewFilterBarSnapshot}
                    onChangeFilters={(filters) => updateActiveViewDraft({ filters })}
                    onChangeSorts={(sorts) => updateActiveViewDraft({ sorts })}
                    onAddFilter={handleAddFilter}
                    onAutoOpenRuleHandled={() => setPendingOpenFilterRuleId(null)}
                    onResetView={handleResetSharedViewDraft}
                    onSaveForEveryone={() => void handleSaveViewForEveryone()}
                  />
                </Profiler>
              ) : null}
              {showPrimaryKeyCandidateBanner && selectedPath ? (
                <Profiler id="primary-key-banner" onRender={handleDetailReorderProfilerRender}>
                  <PrimaryKeyCandidateBanner
                    filePath={selectedPath}
                    collectionPath={collectionPath}
                    candidates={activePrimaryKeyCandidates}
                    onConfirm={openPrimaryKeyCandidateDialog}
                    onDismiss={dismissPrimaryKeyCandidates}
                  />
                </Profiler>
              ) : null}
              <Profiler id="data-table" onRender={handleDetailReorderProfilerRender}>
                <DataTable
                  snapshot={tableSnapshot}
                  onScrollPositionChange={handleTableScrollPositionChange}
                  onSelectRow={selectRow}
                  onOpenDetail={openDetailForRow}
                  onOpenBacklink={handleOpenBacklink}
                  onEditCell={handleTableEditCell}
                  onCommitMultiSelectDraft={handleTableCommitMultiSelectOptionFieldDraft}
                  onCommitSelectDraft={handleTableCommitSelectOptionFieldDraft}
                  onChangeFieldType={handleChangeFieldType}
                  onHideField={handleHideField}
                  onToggleWrapField={handleToggleWrapField}
                  onResizeField={handleResizeField}
                  onMoveField={handleMoveField}
                  onReorderFields={handleReorderFields}
                  onSort={handleSort}
                  onAddFilter={handleAddFilter}
                  onConfigureRelation={handleConfigureRelation}
                  onClearRelation={handleClearRelation}
                  onOpenRelationTarget={handleOpenRelationTarget}
                  onAddRow={handleAddRow}
                  onDeleteRow={handleDeleteRow}
                  showRowDeleteControls={rowDeleteControlsVisible}
                  onAddField={handleAddField}
                  onDeleteField={handleDeleteField}
                />
              </Profiler>
              <Profiler id="detail-panel" onRender={handleDetailReorderProfilerRender}>
                <DetailPanel
                  snapshot={detailSnapshot}
                  onCommitMultiSelectDraft={(fieldName, patch) => selectedRowId && handleCommitMultiSelectOptionFieldDraftByRowId(selectedRowId, fieldName, patch)}
                  onCommitSelectDraft={(fieldName, patch) => selectedRowId && handleCommitSelectOptionFieldDraftByRowId(selectedRowId, fieldName, patch)}
                  onOpenBacklink={handleOpenBacklink}
                  onRequestSyncSave={() => void persistChanges(true)}
                  onOpenRelationTarget={handleOpenRelationTarget}
                  onSelectRow={selectRowById}
                  onClose={() => setDetailOpen(false)}
                  onPanelWidthChange={handleDetailPanelWidthChange}
                  onPanelWidthCommit={commitDetailPanelWidth}
                  onEditField={(fieldName, value) => selectedRowId && handleEditCellByRowId(selectedRowId, fieldName, value)}
                  onReorderFields={handleReorderDetailFields}
                  onRegisterActiveTextEditor={registerActiveTextEditor}
                />
              </Profiler>
            </div>
          </Profiler>
        ) : (
          <div className="main-content">
          <ViewTabs
            snapshot={viewTabsSnapshot}
            onSelectView={handleSelectSharedView}
            onCreateView={handleCreateSharedView}
            onRenameView={handleRenameSharedView}
            onDeleteView={handleDeleteSharedView}
            onDuplicateView={handleDuplicateSharedView}
            onReorderViews={handleReorderSharedViews}
            onToggleFilterBar={() => setFilterBarVisible((value) => !value)}
            onToggleTableTextEditMode={() => setTableTextEditMode((value) => !value)}
            onToggleRowDeleteControls={() => setRowDeleteControlsVisible((value) => !value)}
          />
          {filterBarVisible ? (
            <ViewFilterBar
              snapshot={viewFilterBarSnapshot}
              onChangeFilters={(filters) => updateActiveViewDraft({ filters })}
              onChangeSorts={(sorts) => updateActiveViewDraft({ sorts })}
              onAddFilter={handleAddFilter}
              onAutoOpenRuleHandled={() => setPendingOpenFilterRuleId(null)}
              onResetView={handleResetSharedViewDraft}
              onSaveForEveryone={() => void handleSaveViewForEveryone()}
            />
          ) : null}
          {showPrimaryKeyCandidateBanner && selectedPath ? (
            <PrimaryKeyCandidateBanner
              filePath={selectedPath}
              collectionPath={collectionPath}
              candidates={activePrimaryKeyCandidates}
              onConfirm={openPrimaryKeyCandidateDialog}
              onDismiss={dismissPrimaryKeyCandidates}
            />
          ) : null}
          <DataTable
            snapshot={tableSnapshot}
            onScrollPositionChange={handleTableScrollPositionChange}
            onSelectRow={selectRow}
            onOpenDetail={openDetailForRow}
            onOpenBacklink={handleOpenBacklink}
            onEditCell={handleTableEditCell}
            onCommitMultiSelectDraft={handleTableCommitMultiSelectOptionFieldDraft}
            onCommitSelectDraft={handleTableCommitSelectOptionFieldDraft}
            onChangeFieldType={handleChangeFieldType}
            onHideField={handleHideField}
            onToggleWrapField={handleToggleWrapField}
            onResizeField={handleResizeField}
            onMoveField={handleMoveField}
            onReorderFields={handleReorderFields}
            onSort={handleSort}
            onAddFilter={handleAddFilter}
            onConfigureRelation={handleConfigureRelation}
            onClearRelation={handleClearRelation}
            onOpenRelationTarget={handleOpenRelationTarget}
            onAddRow={handleAddRow}
            onDeleteRow={handleDeleteRow}
            showRowDeleteControls={rowDeleteControlsVisible}
            onAddField={handleAddField}
            onDeleteField={handleDeleteField}
          />
          <DetailPanel
            snapshot={detailSnapshot}
            onCommitMultiSelectDraft={(fieldName, patch) => selectedRowId && handleCommitMultiSelectOptionFieldDraftByRowId(selectedRowId, fieldName, patch)}
            onCommitSelectDraft={(fieldName, patch) => selectedRowId && handleCommitSelectOptionFieldDraftByRowId(selectedRowId, fieldName, patch)}
            onOpenBacklink={handleOpenBacklink}
            onRequestSyncSave={() => void persistChanges(true)}
            onOpenRelationTarget={handleOpenRelationTarget}
            onSelectRow={selectRowById}
            onClose={() => setDetailOpen(false)}
            onPanelWidthChange={handleDetailPanelWidthChange}
            onPanelWidthCommit={commitDetailPanelWidth}
            onEditField={(fieldName, value) => selectedRowId && handleEditCellByRowId(selectedRowId, fieldName, value)}
            onReorderFields={handleReorderDetailFields}
            onRegisterActiveTextEditor={registerActiveTextEditor}
          />
        </div>
        )}
      </section>
      <AddFieldDialog
        open={addFieldOpen}
        fieldName={newFieldName}
        fieldType={newFieldType}
        applyAll={newFieldApplyAll}
        onOpenChange={setAddFieldOpen}
        onFieldNameChange={setNewFieldName}
        onFieldTypeChange={setNewFieldType}
        onApplyAllChange={setNewFieldApplyAll}
        onConfirm={confirmAddField}
      />
      <CreateProfileDialog
        open={newProfileOpen}
        name={newProfileName}
        onOpenChange={setNewProfileOpen}
        onNameChange={setNewProfileName}
        onConfirm={handleCreateViewProfile}
      />
      <RelationConfigDialog
        open={relationConfigField != null}
        files={files}
        fieldName={relationConfigField}
        config={relationConfigForDialog}
        onOpenChange={(open) => !open && setRelationConfigField(null)}
        onConfirm={confirmRelationConfig}
      />
      <ConfirmDialog
        open={pendingDeleteRow != null}
        title="删除行"
        description={`删除当前 ${collectionPath} 记录？保存后会写入源文件。`}
        onOpenChange={(open) => !open && setPendingDeleteRow(null)}
        onConfirm={confirmDeleteRow}
      />
      <ConfirmDialog
        open={pendingDeleteField != null}
        title="删除字段"
        description={`删除字段 ${pendingDeleteField ?? ""}？将影响 ${pendingDeleteField ? rows.filter((row) => Object.hasOwn(row, pendingDeleteField)).length : 0} 条 records，保存后会写入源文件。`}
        onOpenChange={(open) => !open && setPendingDeleteField(null)}
        onConfirm={confirmDeleteField}
      />
      <PrimaryKeyCandidateDialog
        open={primaryKeyCandidateDialogOpen}
        filePath={selectedPath}
        collectionPath={collectionPath}
        candidates={activePrimaryKeyCandidates}
        filtered={activePrimaryKeyCandidateAnalysis.filtered}
        warnings={activePrimaryKeyCandidateWarnings}
        value={selectedPrimaryKeyCandidate}
        onOpenChange={setPrimaryKeyCandidateDialogOpen}
        onValueChange={setSelectedPrimaryKeyCandidate}
        onConfirm={confirmPrimaryKeyCandidate}
      />
      <PrimaryKeySyncDialog
        open={primaryKeySyncDialogOpen}
        plan={primaryKeySyncPlan}
        result={primaryKeySyncResult}
        commandSaving={commandSaving}
        onOpenChange={setPrimaryKeySyncDialogOpen}
        onConfirm={confirmPrimaryKeySyncSave}
      />
      <ProjectSettingsDialog
        open={projectSettingsOpen}
        projects={projects}
        activeProjectId={activeProjectId}
        onOpenChange={setProjectSettingsOpen}
        onSaveProject={saveProjectSettings}
        onCreateProject={createProjectFromSettings}
      />
    </main>
  );
}

function AddFieldDialog(props: {
  open: boolean;
  fieldName: string;
  fieldType: FieldDisplayType;
  applyAll: boolean;
  onOpenChange: (open: boolean) => void;
  onFieldNameChange: (value: string) => void;
  onFieldTypeChange: (value: FieldDisplayType) => void;
  onApplyAllChange: (value: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content">
          <Dialog.Title>新增字段</Dialog.Title>
          <label className="dialog-field">
            <span>字段名</span>
            <input value={props.fieldName} onChange={(event) => props.onFieldNameChange(event.target.value)} />
          </label>
          <label className="dialog-field">
            <span>显示类型</span>
            <Select.Root value={props.fieldType} onValueChange={(value) => props.onFieldTypeChange(value as FieldDisplayType)}>
              <Select.Trigger className="select-trigger">
                <Select.Value />
                <Select.Icon asChild><icons.chevronDown size={16} /></Select.Icon>
              </Select.Trigger>
              <Select.Portal>
                <Select.Content className="menu-content select-content" position="popper" sideOffset={6}>
                  <Select.Viewport>
                    {["Text", "Select"].map((type) => (
                      <Select.Item className="menu-item" key={type} value={type}><Select.ItemText>{type}</Select.ItemText></Select.Item>
                    ))}
                  </Select.Viewport>
                </Select.Content>
              </Select.Portal>
            </Select.Root>
          </label>
          <label className="dialog-check">
            <input type="checkbox" checked={props.applyAll} onChange={(event) => props.onApplyAllChange(event.target.checked)} />
            Apply empty field to all rows
          </label>
          <div className="dialog-actions">
            <Dialog.Close className="ghost-button">取消</Dialog.Close>
            <button className="primary-button" onClick={props.onConfirm}>创建</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function CreateProfileDialog(props: {
  open: boolean;
  name: string;
  onOpenChange: (open: boolean) => void;
  onNameChange: (value: string) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content">
          <Dialog.Title>新建视图配置</Dialog.Title>
          <label className="dialog-field">
            <span>配置名称</span>
            <input value={props.name} onChange={(event) => props.onNameChange(event.target.value)} />
          </label>
          <div className="dialog-actions">
            <Dialog.Close className="ghost-button">取消</Dialog.Close>
            <button className="primary-button" onClick={props.onConfirm}>创建</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ProjectSettingsDialog(props: {
  open: boolean;
  projects: ProjectDefinition[];
  activeProjectId: string | null;
  onOpenChange: (open: boolean) => void;
  onSaveProject: (project: ProjectDefinition) => void;
  onCreateProject: (input: { name: string; root: string }) => void;
}) {
  const activeProject = props.projects.find((project) => project.id === props.activeProjectId) ?? null;
  const [name, setName] = useState("");
  const [root, setRoot] = useState("");
  const [sourcesText, setSourcesText] = useState("");
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectRoot, setNewProjectRoot] = useState("");

  useEffect(() => {
    if (!activeProject) {
      setName("");
      setRoot("");
      setSourcesText("");
      return;
    }
    setName(activeProject.name);
    setRoot(activeProject.root);
    setSourcesText(activeProject.dataSources.map((source) => `${source.id}|${source.label}|${source.kind}|${source.path}`).join("\n"));
  }, [activeProject]);

  function saveCurrentProject() {
    if (!activeProject) return;
    props.onSaveProject({
      ...activeProject,
      name,
      root,
      dataSources: parseDataSources(sourcesText),
    });
  }

  function createNextProject() {
    props.onCreateProject({
      name: newProjectName.trim() || "Project",
      root: newProjectRoot.trim(),
    });
    setNewProjectName("");
    setNewProjectRoot("");
  }

  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content project-settings-dialog">
          <Dialog.Title>Project Settings</Dialog.Title>
          {activeProject ? (
            <div className="project-settings">
              <label className="dialog-field">
                <span>Name</span>
                <input value={name} onChange={(event) => setName(event.target.value)} />
              </label>
              <label className="dialog-field">
                <span>Root</span>
                <input value={root} onChange={(event) => setRoot(event.target.value)} />
              </label>
              <label className="dialog-field">
                <span>Data Sources</span>
                <textarea
                  rows={Math.max(3, activeProject.dataSources.length + 1)}
                  value={sourcesText}
                  onChange={(event) => setSourcesText(event.target.value)}
                />
              </label>
              <div className="sidebar-label">Data Sources</div>
              <div className="project-source-list">
                {parseDataSources(sourcesText).map((source) => (
                  <div className="project-source-row" key={source.id}>
                    <strong>{source.label}</strong>
                    <small>{source.kind}: {source.path}</small>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p>No active project.</p>
          )}
          <div className="project-settings-create">
            <label className="dialog-field">
              <span>New Project Name</span>
              <input value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)} />
            </label>
            <label className="dialog-field">
              <span>New Project Root</span>
              <input value={newProjectRoot} onChange={(event) => setNewProjectRoot(event.target.value)} />
            </label>
          </div>
          <div className="dialog-actions">
            <Dialog.Close className="primary-button">Close</Dialog.Close>
            <button className="ghost-button" disabled={!newProjectRoot.trim()} onClick={createNextProject} type="button">Add Project</button>
            <button className="primary-button" disabled={!activeProject} onClick={saveCurrentProject} type="button">Save Project</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function parseDataSources(text: string) {
  const sources = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [id, label, kind, ...pathParts] = line.split("|");
      return {
        id: (id ?? "").trim(),
        label: (label ?? id ?? "").trim(),
        kind: kind?.trim() === "absolute" ? "absolute" as const : "relative" as const,
        path: pathParts.join("|").trim(),
      };
    })
    .filter((source) => source.id && source.path);
  return sources.length ? sources : [{ id: "data", label: "Data", kind: "relative" as const, path: "data" }];
}

function ConfirmDialog(props: {
  open: boolean;
  title: string;
  description: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content">
          <Dialog.Title>{props.title}</Dialog.Title>
          <Dialog.Description>{props.description}</Dialog.Description>
          <div className="dialog-actions">
            <Dialog.Close className="ghost-button">取消</Dialog.Close>
            <button className="primary-button danger-button" onClick={props.onConfirm}>确认删除</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function PrimaryKeyCandidateDialog(props: {
  open: boolean;
  filePath: string | null;
  collectionPath: string;
  candidates: PrimaryKeyCandidate[];
  filtered: FilteredPrimaryKeyCandidate[];
  warnings: string[];
  value: string;
  onOpenChange: (open: boolean) => void;
  onValueChange: (value: string) => void;
  onConfirm: () => void;
}) {
  const hasMultiple = props.candidates.length > 1;
  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content primary-key-candidate-dialog">
          <Dialog.Title>{hasMultiple ? "选择主键" : "确认主键"}</Dialog.Title>
          <Dialog.Description className="dialog-description">
            {hasMultiple
              ? `为 ${props.filePath ?? ""} / ${props.collectionPath} 选择一个 primary key。`
              : `将 ${props.value} 设为 ${props.filePath ?? ""} / ${props.collectionPath} 的 primary key。`}
          </Dialog.Description>
          {hasMultiple ? (
            <label className="dialog-field">
              <span>候选字段</span>
              <Select.Root value={props.value} onValueChange={props.onValueChange}>
                <Select.Trigger className="select-trigger">
                  <Select.Value />
                  <Select.Icon asChild><icons.chevronDown size={16} /></Select.Icon>
                </Select.Trigger>
                <Select.Portal>
                  <Select.Content className="menu-content select-content" position="popper" sideOffset={6}>
                    <Select.Viewport>
                      {props.candidates.map((candidate) => (
                        <Select.Item className="menu-item" key={candidate.fieldName} value={candidate.fieldName}>
                          <Select.ItemText>{candidate.fieldName}</Select.ItemText>
                        </Select.Item>
                      ))}
                    </Select.Viewport>
                  </Select.Content>
                </Select.Portal>
              </Select.Root>
            </label>
          ) : null}
          {props.candidates.length ? (
            <div className="primary-key-candidate-summary">
              {props.candidates.map((candidate) => (
                <div className={`primary-key-candidate-summary__row ${candidate.fieldName === props.value ? "is-selected" : ""}`} key={candidate.fieldName}>
                  <strong>{candidate.fieldName}</strong>
                  <small>
                    {candidate.confidence === "high" ? "高置信" : "次级候选"} · 唯一值 {candidate.uniqueCount} · 缺失 {candidate.missingCount}
                  </small>
                </div>
              ))}
            </div>
          ) : null}
          {props.filtered.length ? (
            <details className="primary-key-candidate-filtered">
              <summary>已过滤字段</summary>
              <div className="primary-key-candidate-filtered__list">
                {props.filtered.map((candidate) => (
                  <div className="primary-key-candidate-filtered__row" key={candidate.fieldName}>
                    <strong>{candidate.fieldName}</strong>
                    <small>{formatFilteredCandidateReason(candidate)}</small>
                  </div>
                ))}
              </div>
            </details>
          ) : null}
          {props.warnings.length ? (
            <div className="primary-key-candidate-warning-list">
              {props.warnings.map((warning) => (
                <p className="warning" key={warning}>{warning}</p>
              ))}
            </div>
          ) : (
            <p className="dialog-description">启用主键保护、关联目标校验、改名影响分析。</p>
          )}
          <div className="dialog-actions">
            <Dialog.Close className="ghost-button">取消</Dialog.Close>
            <button className="primary-button" disabled={!props.value} onClick={props.onConfirm}>确认</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function PrimaryKeySyncDialog(props: {
  open: boolean;
  plan: PrimaryKeySyncPlan | null;
  result: SaveDocumentsResult | null;
  commandSaving: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const plan = props.plan;
  const sourceFiles = plan?.sourceFiles ?? [];
  const canConfirm = Boolean(plan && !plan.blockingIssues.length && plan.rewrites.length > 0);
  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content primary-key-sync-dialog">
          <Dialog.Title>保存并同步引用</Dialog.Title>
          <Dialog.Description className="dialog-description">
            {plan
              ? `${plan.targetRowLabel} / ${plan.oldValue} ? ${plan.newValue}`
              : "当前没有可同步的主键改名。"}
          </Dialog.Description>
          {plan ? (
            <>
              <div className="primary-key-sync-summary">
                <div className="primary-key-sync-summary__row">
                  <strong>将更新 {plan.rewrites.length} 条显式关联</strong>
                  <small>涉及 {sourceFiles.length} 个来源文件</small>
                </div>
                {sourceFiles.length ? (
                  <div className="primary-key-sync-files">
                    {sourceFiles.map((filePath) => (
                      <span className="relation-token neutral" key={filePath}>{filePath}</span>
                    ))}
                  </div>
                ) : null}
              </div>
              {plan.blockingIssues.length ? (
                <div className="primary-key-sync-warning-list">
                  <p className="warning">{describePrimaryKeySyncBlockingIssues(plan)}</p>
                </div>
              ) : null}
              {plan.skipped.length ? (
                <details className="primary-key-sync-skipped">
                  <summary>本次未处理的命中 {plan.skipped.length}</summary>
                  <div className="primary-key-sync-skipped__list">
                    {plan.skipped.map((item) => (
                      <div className="primary-key-sync-skipped__row" key={`${item.relationKey}:${item.rowIndex}`}>
                        <strong>{item.rowLabel}</strong>
                        <small>{formatSkippedRewriteReason(item.reason)}</small>
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}
              <div className="primary-key-sync-preview">
                {plan.rewrites.slice(0, 12).map((item) => (
                  <div className="primary-key-sync-preview__row" key={`${item.relationKey}:${item.rowIndex}`}>
                    <strong>{item.rowLabel}</strong>
                    <small>{item.sourceFile} / {item.sourceCollection} / {item.fieldPath.join(".")}</small>
                  </div>
                ))}
                {plan.rewrites.length > 12 ? (
                  <p className="dialog-description">其余 {plan.rewrites.length - 12} 条将在保存时一并同步。</p>
                ) : null}
              </div>
              {props.result && !props.result.ok ? (
                <p className="warning">{describePrimaryKeySyncSaveResult(props.result)}</p>
              ) : null}
            </>
          ) : null}
          <div className="dialog-actions">
            <Dialog.Close className="ghost-button">取消</Dialog.Close>
            <button className="primary-button" disabled={!canConfirm || props.commandSaving} onClick={props.onConfirm}>
              {props.commandSaving ? "保存中..." : "确认同步"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function formatSkippedRewriteReason(reason: "unsupported-multi" | "unsupported-nested-path") {
  if (reason === "unsupported-multi") return "多值 relation 暂未纳入首版同步范围。";
  return "嵌套路径 relation 暂未纳入首版同步范围。";
}

function formatFilteredCandidateReason(candidate: FilteredPrimaryKeyCandidate) {
  const reasons: string[] = [];
  if (candidate.reasons.includes("duplicate-values")) {
    reasons.push(`有重复值（${candidate.presentCount + candidate.missingCount} 条中唯一值 ${candidate.uniqueCount}）`);
  }
  if (candidate.reasons.includes("too-many-missing")) {
    reasons.push(`缺失过多（${candidate.presentCount + candidate.missingCount} 条中缺失 ${candidate.missingCount}）`);
  }
  return reasons.join("，");
}

function buildFieldConfig(
  path: string | null,
  collectionPath: string,
  viewId: string | null,
  model: DocumentModel | null,
  viewConfig: ViewConfig,
  mode: "local" | "profile",
  profile: UserViewProfile | null,
  extraFields: string[] = [],
): FieldConfig {
  const displayTypes: Record<string, FieldDisplayType> = {};
  const activeState = path && viewId
    ? readViewLayoutState({
      mode,
      path,
      collectionPath,
      viewId,
      localState: readLocalViewState({
        path,
        collectionPath,
        viewId,
        localStorage: window.localStorage,
      }),
      profile,
    })
    : emptyLocalViewState();
  const hidden = new Set<string>(activeState.hidden);
  const wrapped = new Set<string>(activeState.wrapped);
  const widths: Record<string, number> = { ...activeState.widths };
  const order = [...activeState.order];
  const detailOrder = [...activeState.detailOrder];
  if (!path || !model) return { displayTypes, hidden, wrapped, widths, order, detailOrder };
  const fields = [...new Set([...getMainColumns(model, collectionPath), ...getNestedFields(model, collectionPath), ...extraFields])];
  for (const field of fields) {
    const displayType = viewConfig.fields[fieldViewConfigKey(path, collectionPath, field) ?? ""]?.type;
    if (displayType) displayTypes[field] = displayType;
    if (!Number.isFinite(widths[field]) || widths[field] <= 0) delete widths[field];
  }
  return { displayTypes, hidden, wrapped, widths, order, detailOrder };
}

function getOrderedFields(model: DocumentModel, collectionPath: string, order: string[], extraFields: string[] = []) {
  return orderColumns([
    ...getMainColumns(model, collectionPath),
    ...getNestedFields(model, collectionPath),
    ...extraFields,
  ], order);
}

function orderColumns(columns: string[], order: string[]) {
  const seen = new Set<string>();
  const known = order.filter((field) => {
    if (!columns.includes(field) || seen.has(field)) return false;
    seen.add(field);
    return true;
  });
  const rest = columns.filter((field) => !known.includes(field));
  return [...known, ...rest];
}

function sameRecord<T extends string | number>(previous: Record<string, T>, next: Record<string, T>) {
  const previousKeys = Object.keys(previous);
  const nextKeys = Object.keys(next);
  return previousKeys.length === nextKeys.length && previousKeys.every((key) => previous[key] === next[key]);
}

function sameSet(previous: Set<string>, next: Set<string>) {
  return previous.size === next.size && [...previous].every((value) => next.has(value));
}

function sameStringArray(previous: string[], next: string[]) {
  return previous.length === next.length && previous.every((value, index) => next[index] === value);
}

function sameFilterGroup(previous: FilterGroup, next: FilterGroup) {
  return previous.op === next.op
    && previous.rules.length === next.rules.length
    && previous.rules.every((rule, index) => {
      const candidate = next.rules[index];
      if (!candidate) return false;
      return rule.id === candidate.id
        && rule.field === candidate.field
        && rule.operator === candidate.operator
        && sameUnknownValue(rule.value, candidate.value);
    });
}

function sameSortRules(previous: SortRule[], next: SortRule[]) {
  return previous.length === next.length && previous.every((rule, index) => {
    const candidate = next[index];
    return Boolean(candidate)
      && rule.id === candidate.id
      && rule.field === candidate.field
      && rule.direction === candidate.direction;
  });
}

function sameUnknownValue(previous: unknown, next: unknown): boolean {
  if (previous === next) return true;
  if (Array.isArray(previous) && Array.isArray(next)) {
    return previous.length === next.length && previous.every((value, index) => sameUnknownValue(value, next[index]));
  }
  return false;
}

function sameRelationIndexMap(previous: Record<string, Set<string> | null>, next: Record<string, Set<string> | null>) {
  const previousKeys = Object.keys(previous);
  const nextKeys = Object.keys(next);
  if (previousKeys.length !== nextKeys.length) return false;
  return previousKeys.every((key) => {
    const left = previous[key] ?? null;
    const right = next[key] ?? null;
    if (left === right) return true;
    if (!left || !right) return left === right;
    return sameSet(left, right);
  });
}

function sameRelationOptionMap(previous: Record<string, RelationOption[]>, next: Record<string, RelationOption[]>) {
  const previousKeys = Object.keys(previous);
  const nextKeys = Object.keys(next);
  if (previousKeys.length !== nextKeys.length) return false;
  return previousKeys.every((key) => {
    const left = previous[key] ?? [];
    const right = next[key] ?? [];
    return left.length === right.length && left.every((option, index) => {
      const candidate = right[index];
      return Boolean(candidate)
        && option.value === candidate.value
        && option.label === candidate.label
        && option.description === candidate.description;
    });
  });
}

function patchValidationSnapshotForChangedRelationFields({
  previousSnapshot,
  previousRelationIndexes,
  nextRelationIndexes,
  sourcePath,
  collectionPath,
  rows,
  collectionStore,
  fieldConfig,
  validationConfig,
}: {
  previousSnapshot: ValidationSnapshotType;
  previousRelationIndexes: Record<string, Set<string> | null>;
  nextRelationIndexes: Record<string, Set<string> | null>;
  sourcePath: string;
  collectionPath: string;
  rows: DataRecord[];
  collectionStore: CollectionStore | null;
  fieldConfig: ValidationFieldConfigType;
  validationConfig: ValidationRuleConfigType;
}) {
  const changedFields = getChangedRelationFields(previousRelationIndexes, nextRelationIndexes, sourcePath, collectionPath);
  if (!changedFields.length) return null;
  let nextSnapshot: ValidationSnapshotType | null = previousSnapshot;
  for (const fieldName of changedFields) {
    nextSnapshot = patchValidationSnapshotForField({
      previousSnapshot: nextSnapshot,
      invalidation: { type: "field", fieldName },
      rows,
      collectionStore,
      fieldConfig,
      relationIndexes: nextRelationIndexes,
      validationConfig,
      sourcePath,
      collectionPath,
    });
    if (!nextSnapshot) return null;
  }
  return nextSnapshot;
}

function getChangedRelationFields(
  previous: Record<string, Set<string> | null>,
  next: Record<string, Set<string> | null>,
  sourcePath: string,
  collectionPath: string,
) {
  const changedFields = new Set<string>();
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  for (const key of keys) {
    const parsed = parseRelationKey(key);
    if (!parsed) continue;
    if (parsed.sourceFile !== sourcePath || parsed.sourceCollection !== collectionPath) continue;
    const left = previous[key] ?? null;
    const right = next[key] ?? null;
    const changed = left === right ? false : (!left || !right ? left !== right : !sameSet(left, right));
    if (!changed) continue;
    const topLevelField = parsed.fieldPath[0];
    if (topLevelField) changedFields.add(topLevelField);
  }
  return [...changedFields];
}

function configKey(path: string, collectionPath: string, fieldName: string, suffix: string) {
  return `data-editor:${path}:${collectionPath}:${fieldName}:${suffix}`;
}

function defaultEmptyValue(displayType?: FieldDisplayType) {
  if (displayType === "Checkbox") return false;
  if (displayType === "Multi-select") return [];
  if (displayType === "Relation") return null;
  return "";
}

function resolveDocumentCollection(model: DocumentModel, targetCollection?: string) {
  if (targetCollection && model.collections.some((collection) => collection.path === targetCollection)) return targetCollection;
  return model.collections[0]?.path ?? "$";
}

function inferViewFilterFieldType(fieldName: string, rows: DataRecord[], displayTypes: Record<string, FieldDisplayType>): FieldDisplayType {
  if (displayTypes[fieldName]) return displayTypes[fieldName];
  const sample = rows.find((row) => row[fieldName] !== undefined && row[fieldName] !== null)?.[fieldName]
    ?? rows.find((row) => row[fieldName] !== undefined)?.[fieldName];
  return defaultTypeFor(sample);
}

function buildValueFilterOptions(
  fieldName: string,
  rows: DataRecord[],
  fieldConfig: FieldViewConfig | undefined,
  fieldType: FieldDisplayType,
): MultiSelectOptionView[] {
  const options = new Map<string, MultiSelectOptionView>();
  const configuredOptions = fieldType === "Select" ? fieldConfig?.selectOptions : fieldConfig?.multiSelectOptions;
  for (const [value, option] of Object.entries(configuredOptions ?? {})) {
    options.set(value, { value, label: option.label, color: option.color });
  }
  for (const row of rows) {
    for (const value of valuesFromFilterSource(row[fieldName])) {
      if (!options.has(value)) options.set(value, { value, label: value, color: null });
    }
  }
  return [...options.values()];
}

function valuesFromFilterSource(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  if (value == null || value === "") return [];
  return [String(value)];
}

const sidebarWidthStorageKey = "data-editor:sidebar-width";
const selectedViewProfileStorageKey = "data-editor:selected-view-profile";
const transientStatusStorageKey = "data-editor:transient-status";
const localProfileOptionValue = "__local__";
const minSidebarWidth = 180;
const maxSidebarWidth = 520;
const defaultSidebarWidth = 260;
const detailPanelWidthStorageKey = "data-editor:detail-panel-width";
const minDetailPanelWidth = 320;
const maxDetailPanelWidth = 920;
const defaultDetailPanelWidth = 400;

function readSidebarWidth() {
  const stored = Number(localStorage.getItem(sidebarWidthStorageKey));
  return clampSidebarWidth(Number.isFinite(stored) && stored > 0 ? stored : defaultSidebarWidth);
}

function readDetailPanelWidth() {
  const stored = Number(localStorage.getItem(detailPanelWidthStorageKey));
  return clampDetailPanelWidth(Number.isFinite(stored) && stored > 0 ? stored : defaultDetailPanelWidth);
}

function rememberTransientStatus(message: string) {
  window.sessionStorage.setItem(transientStatusStorageKey, message);
}

function consumeTransientStatus() {
  return window.sessionStorage.getItem(transientStatusStorageKey) ?? "";
}

function shouldRetryWithFallbackFile(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("allowlist") || message.includes("Unknown data source");
}

function clampSidebarWidth(width: number) {
  return Math.min(maxSidebarWidth, Math.max(minSidebarWidth, Math.round(width)));
}

function clampDetailPanelWidth(width: number) {
  return Math.min(maxDetailPanelWidth, Math.max(minDetailPanelWidth, Math.round(width)));
}

function cloneDataRoot<T>(value: T): T {
  return value == null ? value : structuredClone(value);
}

function emptyUserViewProfile(): UserViewProfile {
  return {
    sidebarWidth: null,
    detailPanelWidth: null,
    fileOrder: [],
    sidebarTree: serializeSidebarTreeState(cloneSidebarTreePreferences(), false),
    lastActiveViews: {},
    viewDrafts: {},
    viewOrderDrafts: {},
    viewLayouts: {},
    collections: {},
  };
}

function normalizeUserViewProfile(profile: Partial<UserViewProfile> | null | undefined): UserViewProfile {
  if (!profile || typeof profile !== "object") return emptyUserViewProfile();
  return {
    sidebarWidth: Number.isFinite(profile.sidebarWidth) ? Number(profile.sidebarWidth) : null,
    detailPanelWidth: Number.isFinite(profile.detailPanelWidth) ? Number(profile.detailPanelWidth) : null,
    fileOrder: Array.isArray(profile.fileOrder) ? [...profile.fileOrder] : [],
    sidebarTree: cloneStoredSidebarTreeState(profile.sidebarTree),
    lastActiveViews: { ...(profile.lastActiveViews ?? {}) },
    viewDrafts: { ...(profile.viewDrafts ?? {}) },
    viewOrderDrafts: { ...(profile.viewOrderDrafts ?? {}) },
    ...(profile.appearance ? { appearance: cloneUiPreferences(profile.appearance) } : {}),
    viewLayouts: Object.fromEntries(Object.entries(profile.viewLayouts ?? {}).map(([key, views]) => [
      key,
      Object.fromEntries(Object.entries(views ?? {}).map(([viewId, value]) => [
        viewId,
        {
          hidden: [...(value?.hidden ?? [])],
          wrapped: [...(value?.wrapped ?? [])],
          order: [...(value?.order ?? [])],
          detailOrder: [...(value?.detailOrder ?? [])],
          widths: { ...(value?.widths ?? {}) },
        },
      ])),
    ])),
    collections: { ...(profile.collections ?? {}) },
  };
}

function resolveUiPreferences(appearance?: UserViewProfile["appearance"]) {
  return normalizeUiPreferences(appearance ?? readLocalUiPreferences(window.localStorage));
}

function emptySharedViewsConfig(): SharedViewsConfig {
  return {
    version: 1,
    collections: {},
  };
}

function hasSharedDrafts(draftState: SharedViewDraftState) {
  return Object.values(draftState.viewDrafts).some((views) => Object.keys(views).length > 0)
    || Object.values(draftState.viewOrderDrafts).some((order) => order.length > 0);
}

function emptyProjectViewConfig(): ViewConfig {
  return {
    fields: {},
    primaryKeys: defaultPrimaryKeys(),
    backlinks: defaultBacklinkConfigs() as Record<string, BacklinkConfig>,
    relations: cloneRelationConfigs(defaultRelationConfigs() as Record<string, RelationConfig>),
    relationsVersion: currentRelationsVersion,
  };
}

function cloneViewConfig(config: ViewConfig): ViewConfig {
  return {
    fields: Object.fromEntries(Object.entries(config.fields).map(([key, value]) => [
      key,
      {
        type: value.type,
        selectOptions: { ...value.selectOptions },
        multiSelectOptions: { ...value.multiSelectOptions },
      },
    ])),
    primaryKeys: { ...config.primaryKeys },
    backlinks: Object.fromEntries(Object.entries(config.backlinks).map(([key, value]) => [
      key,
      {
        sourceRelation: value.sourceRelation,
        displayMode: value.displayMode,
      },
    ])),
    relations: cloneRelationConfigs(config.relations),
    relationsVersion: config.relationsVersion,
  };
}

function cloneRelationConfigs(relations: Record<string, RelationConfig>) {
  return Object.fromEntries(Object.entries(relations).map(([key, value]) => [
    key,
    {
      targetFile: value.targetFile,
      targetCollection: value.targetCollection,
      targetKey: value.targetKey,
      mode: value.mode,
      titleFields: [...value.titleFields],
      allowMissing: value.allowMissing,
    },
  ]));
}

function parseConfigKey(value: string) {
  const parts = String(value).split(":");
  if (parts.length < 3) return null;
  const [file, collection, ...fieldParts] = parts;
  const field = fieldParts.join(":");
  if (!file || !collection || !field) return null;
  return { file, collection, field };
}

function ensureViewLayout(profile: UserViewProfile, path: string, collectionPath: string, viewId: string) {
  const key = collectionConfigKey(path, collectionPath);
  profile.viewLayouts ??= {};
  profile.viewLayouts[key] ??= {};
  profile.viewLayouts[key][viewId] ??= emptyViewLayoutState();
  return profile.viewLayouts[key][viewId];
}

function cloneSidebarTreePreferences(value?: unknown): SidebarTreePreferences {
  const normalized = buildSidebarTreePreferences(value as Record<string, unknown> | undefined) as SidebarTreePreferences;
  return {
    childOrderByParent: Object.fromEntries(
      Object.entries(normalized.childOrderByParent).map(([parentId, order]) => [parentId, [...order]]),
    ) as Record<string, string[]>,
    expandedNodeIds: [...normalized.expandedNodeIds],
  };
}

function hasExplicitExpandedNodeIds(value?: unknown) {
  return Boolean(
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.prototype.hasOwnProperty.call(value, "expandedNodeIds")
    && Array.isArray((value as { expandedNodeIds?: unknown }).expandedNodeIds),
  );
}

function serializeSidebarTreeState(value?: unknown, explicitExpandedNodeIds = hasExplicitExpandedNodeIds(value)) {
  const normalized = cloneSidebarTreePreferences(value);
  const result: Record<string, unknown> = {};
  if (Object.keys(normalized.childOrderByParent).length > 0) {
    result.childOrderByParent = Object.fromEntries(
      Object.entries(normalized.childOrderByParent).map(([parentId, order]) => [parentId, [...order]]),
    );
  }
  if (explicitExpandedNodeIds) result.expandedNodeIds = [...normalized.expandedNodeIds];
  return result as UserViewProfile["sidebarTree"];
}

function cloneStoredSidebarTreeState(value?: unknown) {
  return serializeSidebarTreeState(value, hasExplicitExpandedNodeIds(value));
}

function hasSidebarTreeChildOrder(value?: unknown) {
  return Object.keys(cloneSidebarTreePreferences(value).childOrderByParent).length > 0;
}

function flattenSidebarTreeFiles(nodes: SidebarTreeNodeLike[]) {
  const result: DataFile[] = [];
  for (const node of nodes) {
    if (node.kind === "file" && node.file) {
      result.push(node.file);
      continue;
    }
    if (Array.isArray(node.children)) {
      result.push(...flattenSidebarTreeFiles(node.children));
    }
  }
  return result;
}

function deriveSidebarTreePreferencesFromFileOrder(
  files: DataFile[],
  fileOrder: string[],
  basePreferences?: unknown,
): SidebarTreePreferences {
  const normalizedBasePreferences = cloneSidebarTreePreferences(basePreferences);
  const order = normalizeFileOrder(files, fileOrder);
  if (!order.length) return cloneSidebarTreePreferences(normalizedBasePreferences);
  const orderIndex = new Map(order.map((path, index) => [path, index]));
  const childOrderByParent: Record<string, string[]> = {};
  const tree = buildSidebarTree(files) as SidebarTreeNodeLike[];

  function visit(node: SidebarTreeNodeLike) {
    if (!Array.isArray(node.children) || node.children.length === 0) return;
    for (const child of node.children) visit(child);
    const orderedFileChildren = node.children
      .filter((child) => child.kind === "file" && child.filePath)
      .map((child, index) => ({
        child,
        index,
        rank: orderIndex.get(child.filePath ?? "") ?? Number.POSITIVE_INFINITY,
      }))
      .sort((left, right) => left.rank - right.rank || left.index - right.index)
      .map(({ child }) => child.id);
    let fileChildIndex = 0;
    childOrderByParent[node.id] = node.children.map((child) => {
      if (child.kind !== "file") return child.id;
      const nextFileId = orderedFileChildren[fileChildIndex];
      fileChildIndex += 1;
      return nextFileId ?? child.id;
    });
  }

  for (const node of tree) visit(node);

  return {
    childOrderByParent,
    expandedNodeIds: [...normalizedBasePreferences.expandedNodeIds],
  };
}

function resolveActiveSidebarPreferences(
  files: DataFile[],
  profileName: string | null | undefined,
  profile: Pick<UserViewProfile, "fileOrder" | "sidebarTree"> | null | undefined,
  localStorage: Storage,
) {
  const legacyFileOrder = profileName ? [...(profile?.fileOrder ?? [])] : readLocalFileOrder(localStorage);
  const rawSidebarTree = profileName ? profile?.sidebarTree : readRawLocalSidebarTreePreferences(localStorage);
  return {
    hasExplicitExpandedNodeIds: hasExplicitExpandedNodeIds(rawSidebarTree),
    legacyFileOrder,
    sidebarTree: resolveSidebarTreePreferences(files, rawSidebarTree, legacyFileOrder),
  };
}

function buildResolvedSidebarTree(
  files: DataFile[],
  profileName: string | null | undefined,
  profile: Pick<UserViewProfile, "fileOrder" | "sidebarTree"> | null | undefined,
  localStorage: Storage,
) {
  return applySidebarTreePreferences(
    buildSidebarTree(files),
    resolveActiveSidebarPreferences(files, profileName, profile, localStorage).sidebarTree,
  );
}

function resolveSidebarTreePreferences(
  files: DataFile[],
  sidebarTree: unknown,
  legacyFileOrder: string[],
) {
  if (hasSidebarTreeChildOrder(sidebarTree)) return cloneSidebarTreePreferences(sidebarTree);
  return deriveSidebarTreePreferencesFromFileOrder(files, legacyFileOrder, sidebarTree);
}

function insertViewIdAfter(viewIds: string[], sourceViewId: string, targetViewId: string) {
  const normalized = viewIds.filter((viewId, index) => viewId && viewIds.indexOf(viewId) === index && viewId !== targetViewId);
  const sourceIndex = normalized.indexOf(sourceViewId);
  if (sourceIndex < 0) return [...normalized, targetViewId];
  normalized.splice(sourceIndex + 1, 0, targetViewId);
  return normalized;
}

function buildProfileFromCurrentView(path: string | null, collectionPath: string, fieldConfig: FieldConfig, viewId: string | null, sidebarWidth: number, detailPanelWidth: number, fileOrder: string[], sidebarTree: UserViewProfile["sidebarTree"], appearance: UiPreferences): UserViewProfile {
  if (!path) {
    return {
      sidebarWidth,
      detailPanelWidth,
      fileOrder: [...fileOrder],
      sidebarTree: cloneStoredSidebarTreeState(sidebarTree),
      lastActiveViews: {},
      viewDrafts: {},
      viewOrderDrafts: {},
      appearance: cloneUiPreferences(appearance),
      viewLayouts: {},
      collections: {},
    };
  }
  const collectionKey = collectionConfigKey(path, collectionPath);
  return {
    sidebarWidth,
    detailPanelWidth,
    fileOrder: [...fileOrder],
    sidebarTree: cloneStoredSidebarTreeState(sidebarTree),
    lastActiveViews: viewId ? { [collectionKey]: viewId } : {},
    viewDrafts: {},
    viewOrderDrafts: {},
    appearance: cloneUiPreferences(appearance),
    viewLayouts: viewId ? {
      [collectionKey]: {
        [viewId]: {
          hidden: [...fieldConfig.hidden],
          wrapped: [...fieldConfig.wrapped],
          order: [...fieldConfig.order],
          detailOrder: [...fieldConfig.detailOrder],
          widths: { ...fieldConfig.widths },
        },
      },
    } : {},
    collections: viewId ? {
      [collectionKey]: {
        hidden: [...fieldConfig.hidden],
        wrapped: [...fieldConfig.wrapped],
        order: [...fieldConfig.order],
        detailOrder: [...fieldConfig.detailOrder],
        widths: { ...fieldConfig.widths },
      },
    } : {},
  };
}

function addUnique(values: string[], nextValue: string) {
  return values.includes(nextValue) ? values : [...values, nextValue];
}

function fieldViewConfigKey(path: string | null, collectionPath: string, fieldName: string) {
  if (!path) return null;
  return `${path}:${collectionPath}:${fieldName}`;
}

function buildFieldViewConfigs(path: string | null, collectionPath: string, model: DocumentModel, viewConfig: ViewConfig) {
  const result: Record<string, ViewConfig["fields"][string]> = {};
  const fields = [...getMainColumns(model, collectionPath), ...getNestedFields(model, collectionPath)];
  for (const fieldName of fields) {
    const key = fieldViewConfigKey(path, collectionPath, fieldName);
    result[fieldName] = key ? (viewConfig.fields[key] ?? emptyFieldViewConfig()) : emptyFieldViewConfig();
  }
  return result;
}

function emptyFieldViewConfig(): FieldViewConfig {
  return {
    selectOptions: {},
    multiSelectOptions: {},
  };
}

function ensureFieldViewConfig(config: ViewConfig, key: string) {
  config.fields[key] ??= emptyFieldViewConfig();
  return config.fields[key];
}

function collectSingleSelectValues(rows: DataRecord[], fieldName: string) {
  const values: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const raw = row[fieldName];
    if (raw == null) continue;
    const value = String(raw).trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    values.push(value);
  }
  return values;
}

