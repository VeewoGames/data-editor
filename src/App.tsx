import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
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
  type PendingDocumentSave,
  type ProjectDefinition,
  type SaveDocumentsResult,
  type CollectionView,
  type FilterGroup,
  type SharedViewsConfig,
  type SortRule,
  type UserViewLayoutState,
  type UserViewProfile,
  type ViewConfig,
} from "./api/client";
import { Sidebar } from "./components/Sidebar";
import { Toolbar } from "./components/Toolbar";
import { ViewTabs } from "./components/ViewTabs";
import { ViewFilterBar } from "./components/ViewFilterBar";
import { RelationConfigDialog } from "./components/RelationConfigDialog";
import { PrimaryKeyCandidateBanner } from "./components/PrimaryKeyCandidateBanner";
import { icons } from "./components/icons";
import type { OptionFieldDraftCommit } from "./table/OptionFieldEditor";
import { DataTable, type FieldConfig } from "./table/DataTable";
import { DetailPanel } from "./detail/DetailPanel";
import type { DataRecord, DocumentModel } from "./model/documentModel";
import { addField, addRow, buildDocumentModel, deleteField, deleteRow, getMainColumns, getNestedFields, getRows, setCellValue } from "./model/documentModel";
import type { FieldDisplayType } from "./model/fieldTypes";
import { defaultTypeFor, isCompatible } from "./model/fieldTypes";
import type { RelationOption } from "./model/relations";
import type { ValidationIssue } from "./model/validation";
import { buildRelationIndex, validateRelationValueTyped, validateRequiredTyped, validateUniqueTyped } from "./model/validation";
import { buildRelationOptions } from "./model/relations";
import { buildBacklinkGrid, getBacklinkColumnsForView } from "./model/backlinkGrid";
import { buildRelationKey } from "./model/relationPath";
import { analyzePrimaryKeyChange, buildPrimaryKeySyncPlan, collectRelationBacklinks, findTargetRecord, parseRelationKey, type PrimaryKeyImpact, type PrimaryKeySyncPlan, type RelationBacklink } from "./model/relationMaintenance";
import { deriveBacklinkConfigs, getPrimaryKeyField, syncBacklinksWithRelations } from "./model/fieldRole";
import { analyzePrimaryKeyCandidates, buildCollectionKey, type FilteredPrimaryKeyCandidate, type PrimaryKeyCandidate, type PrimaryKeyCandidateAnalysis } from "./model/primaryKeyCandidate";
import { findTitleField, getRecordTitle } from "./model/titleField";
import type { BacklinkGridColumn } from "./model/backlinkGrid";
import type { BacklinkConfig, FieldViewConfig, MultiSelectOptionColor, MultiSelectOptionView, RealFieldType, RelationConfig } from "./model/viewConfig";
import { currentRelationsVersion, defaultBacklinkConfigs, defaultPrimaryKeys, defaultRelationConfigs } from "./relation-defaults.mjs";
import { normalizeFileOrder, resolvePreferredFilePath } from "./file-order.mjs";
import {
  buildOptionConfigFromOptions,
  removeMultiSelectOptionFromRows,
  removeSingleSelectOptionFromRows,
  renameMultiSelectOptionInRows,
  renameSingleSelectOptionInRows,
} from "./multiselect-config.mjs";
import {
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
import { applyViewFilters } from "./view/filtering.mjs";
import { createDefaultFilterRule, withRules } from "./view/filter-rules.mjs";
import { applyViewSorts, updateHeaderSorts } from "./view/sorting.mjs";
import { createSaveCoordinator, type AutosaveDomain, type AutosaveState } from "./save-coordinator";
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
const defaultRecoveryBridgePort = 8791;

export function App() {
  const [files, setFiles] = useState<DataFile[]>([]);
  const [projects, setProjects] = useState<ProjectDefinition[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [model, setModel] = useState<DocumentModel | null>(null);
  const [collectionPath, setCollectionPath] = useState("$");
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);
  const [dataDirty, setDataDirty] = useState(false);
  const [viewConfigDirty, setViewConfigDirty] = useState(false);
  const [profileDirty, setProfileDirty] = useState(false);
  const [viewDraftDirty, setViewDraftDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [autosaveState, setAutosaveState] = useState<AutosaveState>("idle");
  const [closing, setClosing] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [serviceLifecycleState, setServiceLifecycleState] = useState<ServiceLifecycleState>("running");
  const [disconnectMessage, setDisconnectMessage] = useState("");
  const [flashStatus, setFlashStatus] = useState(() => consumeTransientStatus());
  const [status, setStatus] = useState("");
  const [relationIndexes, setRelationIndexes] = useState<Record<string, Set<string> | null>>({});
  const [relationOptions, setRelationOptions] = useState<Record<string, RelationOption[]>>({});
  const [relationBacklinks, setRelationBacklinks] = useState<RelationBacklink[]>([]);
  const [backlinkColumns, setBacklinkColumns] = useState<BacklinkGridColumn[]>([]);
  const [backlinkValuesByRowIndex, setBacklinkValuesByRowIndex] = useState<Record<number, Record<string, RelationBacklink[]>>>({});
  const [primaryKeyImpacts, setPrimaryKeyImpacts] = useState<Record<string, PrimaryKeyImpact>>({});
  const [primaryKeySyncPlan, setPrimaryKeySyncPlan] = useState<PrimaryKeySyncPlan | null>(null);
  const [primaryKeySyncDialogOpen, setPrimaryKeySyncDialogOpen] = useState(false);
  const [primaryKeySyncResult, setPrimaryKeySyncResult] = useState<SaveDocumentsResult | null>(null);
  const [addFieldOpen, setAddFieldOpen] = useState(false);
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldType, setNewFieldType] = useState<FieldDisplayType>("Text");
  const [newFieldApplyAll, setNewFieldApplyAll] = useState(false);
  const [pendingDeleteRow, setPendingDeleteRow] = useState<number | null>(null);
  const [pendingDeleteField, setPendingDeleteField] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [filterBarVisible, setFilterBarVisible] = useState(true);
  const [pendingOpenFilterRuleId, setPendingOpenFilterRuleId] = useState<string | null>(null);
  const [viewRevision, bump] = useState(0);
  const [viewConfig, setViewConfig] = useState<ViewConfig>(emptyProjectViewConfig());
  const [sharedViewsConfig, setSharedViewsConfig] = useState<SharedViewsConfig>(emptySharedViewsConfig());
  const [localSharedViewDrafts, setLocalSharedViewDrafts] = useState<SharedViewDraftState>(() => readLocalSharedViewDrafts(window.localStorage));
  const [viewProfiles, setViewProfiles] = useState<string[]>([]);
  const [selectedViewProfileName, setSelectedViewProfileName] = useState<string | null>(() => localStorage.getItem(selectedViewProfileStorageKey));
  const [selectedViewProfile, setSelectedViewProfile] = useState<UserViewProfile>(emptyUserViewProfile());
  const [uiPreferences, setUiPreferences] = useState<UiPreferences>(() => readLocalUiPreferences(window.localStorage));
  const [bridgePort, setBridgePort] = useState(defaultRecoveryBridgePort);
  const [newProfileOpen, setNewProfileOpen] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const [relationConfigField, setRelationConfigField] = useState<string | null>(null);
  const [dismissedCandidateKeys, setDismissedCandidateKeys] = useState<string[]>([]);
  const [primaryKeyCandidateDialogOpen, setPrimaryKeyCandidateDialogOpen] = useState(false);
  const [selectedPrimaryKeyCandidate, setSelectedPrimaryKeyCandidate] = useState<string>("");
  const openRequestRef = useRef(0);
  const maintenanceRequestRef = useRef(0);
  const activeProjectIdRef = useRef<string | null>(null);
  const modelRef = useRef<DocumentModel | null>(null);
  const savedDocumentRootRef = useRef<unknown | null>(null);
  const selectedPathRef = useRef<string | null>(null);
  const dataDirtyRef = useRef(false);
  const viewConfigRef = useRef<ViewConfig>(emptyProjectViewConfig());
  const viewConfigDirtyRef = useRef(false);
  const profileDirtyRef = useRef(false);
  const relationIndexRequestRef = useRef(0);
  const selectedViewProfileNameRef = useRef<string | null>(null);
  const selectedViewProfileRef = useRef<UserViewProfile>(emptyUserViewProfile());
  const bridgePortRef = useRef(defaultRecoveryBridgePort);
  const serviceLifecycleStateRef = useRef<ServiceLifecycleState>("running");
  const detailOpenRef = useRef(false);
  const autoRecoverAttemptedRef = useRef(false);
  const disconnectFlowPromiseRef = useRef<Promise<void> | null>(null);
  const healthFailureCountRef = useRef(0);
  const disconnectConfirmTimerRef = useRef<number | null>(null);
  const manualClosedRef = useRef(false);
  const [sidebarWidth, setSidebarWidth] = useState(() => readSidebarWidth());
  const [detailPanelWidth, setDetailPanelWidth] = useState(() => readDetailPanelWidth());
  const primaryKeySyncSnapshotRef = useRef<{ plan: PrimaryKeySyncPlan; pendingSaves: PendingDocumentSave[] } | null>(null);
  const primaryKeySyncPlanRef = useRef<PrimaryKeySyncPlan | null>(null);
  const autosaveStateRef = useRef<AutosaveState>("idle");
  const savingRef = useRef(false);
  const closingRef = useRef(false);
  const rebuildingRef = useRef(false);
  const profileSavePromiseRef = useRef<Promise<void> | null>(null);
  const loadedProjectIdRef = useRef<string | null>(null);
  const viewDraftDirtyRef = useRef(false);
  const toolbarDirty = dataDirty || viewConfigDirty || profileDirty;
  const globalDirty = toolbarDirty || viewDraftDirty;
  const statusText = status || flashStatus;
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
  const selectedCollectionKey = selectedPath ? buildCollectionKey(selectedPath, collectionPath) : null;
  const activeCollectionKey = selectedPath ? collectionConfigKey(selectedPath, collectionPath) : null;
  const orderedFiles = useMemo(() => {
    const savedOrder = selectedViewProfileName ? selectedViewProfile.fileOrder : readLocalFileOrder(window.localStorage);
    const order = normalizeFileOrder(files, savedOrder);
    const byPath = new Map(files.map((file) => [file.path, file]));
    return order.map((path) => byPath.get(path)).filter((file): file is DataFile => Boolean(file));
  }, [files, selectedViewProfileName, selectedViewProfile.fileOrder, viewRevision]);

  useEffect(() => { modelRef.current = model; }, [model]);
  useEffect(() => { activeProjectIdRef.current = activeProjectId; }, [activeProjectId]);
  useEffect(() => { selectedPathRef.current = selectedPath; }, [selectedPath]);
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
  useEffect(() => { savingRef.current = saving; }, [saving]);
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
        bump((value) => value + 1);
      })
      .catch((error) => setStatus(error.message));
  }, [selectedViewProfileName, activeProjectId]);

  async function reloadProjectWorkspace(projectId: string, options: { resetProfile?: boolean } = {}) {
    resetWorkspaceState(options);
    try {
      const profileNameForInitialOrder = options.resetProfile ? null : selectedViewProfileNameRef.current;
      const [nextFiles, nextConfig, nextSharedViewsConfig, nextProfiles, nextProfile] = await Promise.all([
        listFiles(projectId),
        loadViewConfig(projectId),
        loadSharedViews(projectId),
        listViewProfiles(projectId),
        profileNameForInitialOrder ? loadViewProfile(profileNameForInitialOrder, projectId) : Promise.resolve(null),
      ]);
      setFiles(nextFiles);
      setViewConfig(nextConfig);
      setSharedViewsConfig(nextSharedViewsConfig);
      setLocalSharedViewDrafts(readLocalSharedViewDrafts(window.localStorage));
      setViewProfiles(nextProfiles);
      if (profileNameForInitialOrder && nextProfile && selectedViewProfileNameRef.current === profileNameForInitialOrder) {
        const normalizedProfile = normalizeUserViewProfile(nextProfile);
        setSelectedViewProfile(normalizedProfile);
        selectedViewProfileRef.current = normalizedProfile;
        setUiPreferences(resolveUiPreferences(normalizedProfile.appearance));
        setSidebarWidth(clampSidebarWidth(normalizedProfile.sidebarWidth ?? defaultSidebarWidth));
        setDetailPanelWidth(clampDetailPanelWidth(normalizedProfile.detailPanelWidth ?? defaultDetailPanelWidth));
      } else if (!profileNameForInitialOrder) {
        setUiPreferences(readLocalUiPreferences(window.localStorage));
      }
      const savedOrder = profileNameForInitialOrder
        ? (normalizeUserViewProfile(nextProfile).fileOrder ?? selectedViewProfileRef.current.fileOrder)
        : readLocalFileOrder(window.localStorage);
      const preferredPath = resolvePreferredFilePath(nextFiles, savedOrder, selectedPathRef.current);
      if (preferredPath) await openDocumentAt(preferredPath, undefined, undefined, false, projectId);
      loadedProjectIdRef.current = projectId;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function resetWorkspaceState(options: { resetProfile?: boolean } = {}) {
    openRequestRef.current += 1;
    relationIndexRequestRef.current += 1;
    setFiles([]);
    setSelectedPath(null);
    setModel(null);
    savedDocumentRootRef.current = null;
    setCollectionPath("$");
    setSelectedRowIndex(null);
    setDetailOpen(false);
    setDataDirty(false);
    dataDirtyRef.current = false;
    setViewConfigDirty(false);
    viewConfigDirtyRef.current = false;
    setProfileDirty(false);
    profileDirtyRef.current = false;
    setViewDraftDirty(false);
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
    setBacklinkValuesByRowIndex({});
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
      void saveCoordinator.flush("flush");
    }
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, []);

  useEffect(() => {
    return () => {
      if (disconnectConfirmTimerRef.current != null) {
        window.clearTimeout(disconnectConfirmTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    void loadRelationIndexes(viewConfig);
  }, [viewConfig.relations]);

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
    void loadBacklinkGridData();
  }, [selectedPath, collectionPath, model, viewConfig.relations, viewConfig.backlinks, viewConfig.primaryKeys, viewRevision]);

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

  async function openFile(path: string) {
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

  async function openDocumentAt(path: string, targetCollection?: string, targetRowIndex?: number, openDetailPanel = false, projectId = activeProjectId) {
    const requestId = openRequestRef.current + 1;
    openRequestRef.current = requestId;
    selectedPathRef.current = path;
    setSelectedPath(path);
    setModel(null);
    modelRef.current = null;
    savedDocumentRootRef.current = null;
    setCollectionPath("$");
    setSelectedRowIndex(null);
    setDetailOpen(false);
    setStatus(`Loading ${path}...`);
    let documentModel: DocumentModel;
    try {
      documentModel = await loadDocument(path, projectId);
    } catch (error) {
      if (shouldRetryWithFallbackFile(error)) {
        const fallbackPath = resolvePreferredFilePath(
          files,
          selectedViewProfileNameRef.current ? selectedViewProfileRef.current.fileOrder : readLocalFileOrder(window.localStorage),
          path,
        );
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
    modelRef.current = documentModel;
    savedDocumentRootRef.current = cloneDataRoot(documentModel.root);
    setModel(documentModel);
    setCollectionPath(nextCollection);
    setSelectedRowIndex(targetRowIndex ?? (nextRows.length ? 0 : null));
    setDetailOpen(openDetailPanel);
    setDataDirty(false);
    dataDirtyRef.current = false;
    setStatus("");
  }

  async function loadMaintenanceInfo() {
    const requestId = maintenanceRequestRef.current + 1;
    maintenanceRequestRef.current = requestId;
    if (!selectedPath || !selectedRow) {
      setRelationBacklinks([]);
      setPrimaryKeyImpacts({});
      setPrimaryKeySyncPlan(null);
      return;
    }
    const primaryKeyField = getPrimaryKeyField(viewConfig, selectedPath, collectionPath);
    if (!primaryKeyField) {
      setRelationBacklinks([]);
      setPrimaryKeyImpacts({});
      setPrimaryKeySyncPlan(null);
      return;
    }
    const savedRoot = savedDocumentRootRef.current;
    const savedDocumentModel = savedRoot != null && model ? buildDocumentModel(savedRoot, model.format, selectedPath) : null;
    const savedRows = savedDocumentModel ? (getRows(savedDocumentModel, collectionPath) as DataRecord[]) : [];
    const savedRow = selectedRowIndex == null ? null : savedRows[selectedRowIndex] ?? null;
    const previousPrimaryKeyValue = savedRow?.[primaryKeyField];
    const currentPrimaryKeyValue = selectedRow[primaryKeyField];
    if (
      (previousPrimaryKeyValue == null || previousPrimaryKeyValue === "")
      && (currentPrimaryKeyValue == null || currentPrimaryKeyValue === "")
    ) {
      setRelationBacklinks([]);
      setPrimaryKeyImpacts({});
      setPrimaryKeySyncPlan(null);
      return;
    }
    const activeRelations = Object.fromEntries(Object.entries(viewConfig.relations).filter(([, relationConfig]) => (
      relationConfig.targetFile === selectedPath
      && relationConfig.targetCollection === collectionPath
      && relationConfig.targetKey === primaryKeyField
    )));
    const activeRelationKeys = Object.keys(activeRelations);
    if (!activeRelationKeys.length) {
      setRelationBacklinks([]);
      setPrimaryKeyImpacts({});
      setPrimaryKeySyncPlan(null);
      return;
    }
    const sourceFiles = [...new Set(activeRelationKeys.map((key) => parseRelationKey(key)?.sourceFile).filter(Boolean))] as string[];
    const documentsByPath: Record<string, DocumentModel> = {};
    await Promise.all(sourceFiles.map(async (path) => {
      try {
        documentsByPath[path] = path === selectedPath && model ? model : await loadDocument(path, activeProjectId);
      } catch {
        // Missing source files are surfaced by buildPrimaryKeySyncPlan blocking issues.
      }
    }));
    if (requestId !== maintenanceRequestRef.current) return;
    const backlinks = collectRelationBacklinks({
      targetFile: selectedPath,
      targetCollection: collectionPath,
      targetKey: primaryKeyField,
      targetId: (previousPrimaryKeyValue ?? currentPrimaryKeyValue) as string | number,
      relations: activeRelations,
      documentsByPath,
    });
    const impacts: Record<string, PrimaryKeyImpact> = {
      [primaryKeyField]: analyzePrimaryKeyChange({
        targetFile: selectedPath,
        targetCollection: collectionPath,
        targetKey: primaryKeyField,
        oldValue: previousPrimaryKeyValue,
        newValue: currentPrimaryKeyValue,
        relations: activeRelations,
        documentsByPath,
      }),
    };
    const syncPlan = buildPrimaryKeySyncPlan({
      targetFile: selectedPath,
      targetCollection: collectionPath,
      targetKey: primaryKeyField,
      targetRowLabel: getRecordTitle(selectedRow, titleField ? [titleField] : [], selectedRowIndex),
      targetRowIndex: selectedRowIndex,
      oldValue: previousPrimaryKeyValue,
      newValue: currentPrimaryKeyValue,
      relations: activeRelations,
      documentsByPath,
      targetRows: rows,
    });
    setRelationBacklinks(backlinks);
    setPrimaryKeyImpacts(impacts);
    setPrimaryKeySyncPlan(syncPlan);
  }

  async function loadBacklinkGridData() {
    if (!selectedPath || !model) {
      setBacklinkColumns([]);
      setBacklinkValuesByRowIndex({});
      return;
    }
    const rows = getRows(model, collectionPath) as DataRecord[];
    const columns = getBacklinkColumnsForView({
      targetFile: selectedPath,
      targetCollection: collectionPath,
      viewConfig,
    }) as BacklinkGridColumn[];
    if (!columns.length) {
      setBacklinkColumns([]);
      setBacklinkValuesByRowIndex({});
      return;
    }
    const sourceFiles = [...new Set(columns.map((column) => column.sourceRelation.split(":")[0]).filter(Boolean))];
    const documentsByPath: Record<string, DocumentModel> = {};
    await Promise.all(sourceFiles.map(async (path) => {
      try {
        documentsByPath[path] = path === selectedPath ? model : await loadDocument(path, activeProjectId);
      } catch {
        // Ignore missing source documents and leave their backlink columns empty.
      }
    }));
    const grid = buildBacklinkGrid({
      targetFile: selectedPath,
      targetCollection: collectionPath,
      rows,
      viewConfig,
      documentsByPath,
    });
    setBacklinkColumns(grid.columns as BacklinkGridColumn[]);
    setBacklinkValuesByRowIndex(grid.valuesByRowIndex as Record<number, Record<string, RelationBacklink[]>>);
  }

  async function handleOpenRelationTarget(config: RelationConfig, value: string | number) {
    try {
      const targetDocument = await loadDocument(config.targetFile, activeProjectId);
      const targetRows = getRows(targetDocument, config.targetCollection) as DataRecord[];
      const target = findTargetRecord(targetRows, config.targetKey, value);
      if (!target) {
        setStatus(`引用缺失：${String(value)}`);
        return;
      }
      await openDocumentAt(config.targetFile, config.targetCollection, target.rowIndex, true);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleOpenBacklink(backlink: RelationBacklink) {
    await openDocumentAt(backlink.sourceFile, backlink.sourceCollection, backlink.rowIndex, true);
  }

  async function loadRelationIndexes(config: ViewConfig) {
    const requestId = relationIndexRequestRef.current + 1;
    relationIndexRequestRef.current = requestId;
    const indexes: Record<string, Set<string> | null> = {};
    const optionsByKey: Record<string, RelationOption[]> = {};
    for (const [relationKey, target] of Object.entries(config.relations)) {
      try {
        const reference = await loadDocument(target.targetFile, activeProjectId);
        const referenceRows = getRows(reference, target.targetCollection) as DataRecord[];
        indexes[relationKey] = buildRelationIndex(referenceRows, target.targetKey);
        optionsByKey[relationKey] = buildRelationOptions(referenceRows, target.targetKey, target.titleFields);
        indexes[target.targetKey] ??= indexes[relationKey];
        optionsByKey[target.targetKey] ??= optionsByKey[relationKey];
      } catch {
        indexes[relationKey] = null;
        optionsByKey[relationKey] = [];
      }
    }
    if (requestId !== relationIndexRequestRef.current) return;
    setRelationIndexes(indexes);
    setRelationOptions(optionsByKey);
  }

  const rows = useMemo(() => model ? (getRows(model, collectionPath) as DataRecord[]) : [], [model, collectionPath, viewRevision]);
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
  const activeViewLayoutId = activeSharedView?.id ?? null;
  const activeViewHasFilters = Boolean(activeView?.filters?.rules?.length);
  const activeViewSort = activeView?.sorts?.[0] ?? null;
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
  const selectedRow = selectedRowIndex == null ? null : rows[selectedRowIndex] ?? null;
  useEffect(() => {
    void loadMaintenanceInfo();
  }, [selectedPath, collectionPath, selectedRowIndex, selectedRow, viewConfig.relations, viewRevision]);
  const fieldConfig = useMemo(
    () => buildFieldConfig(
      selectedPath,
      collectionPath,
      activeViewLayoutId,
      model,
      viewConfig,
      selectedViewProfileName ? "profile" : "local",
      selectedViewProfileName ? selectedViewProfile : null,
      backlinkColumns.map((column) => column.fieldName),
    ),
    [selectedPath, collectionPath, activeViewLayoutId, model, viewConfig, selectedViewProfile, selectedViewProfileName, viewRevision, backlinkColumns],
  );
  const allFields = useMemo(
    () => model ? getOrderedFields(model, collectionPath, fieldConfig.order, backlinkColumns.map((column) => column.fieldName)) : [],
    [model, collectionPath, fieldConfig.order, backlinkColumns],
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
        : inferViewFilterFieldType(field, rows, fieldConfig.displayTypes),
    ])) as Record<string, FieldDisplayType>,
    [allFields, rows, fieldConfig.displayTypes, selectedPath, collectionPath, viewConfig.relations],
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
  const viewRows = useMemo(() => {
    const filtered = applyViewFilters(rows, activeView?.query ?? "", activeView?.filters ?? { op: "and", rules: [] }, viewFilterFieldTypes);
    return applyViewSorts(filtered, activeView?.sorts ?? []);
  }, [rows, activeView, viewFilterFieldTypes]);
  const viewModel = useMemo(() => model ? ({ ...model, root: replaceRowsForView(model, collectionPath, viewRows) } as DocumentModel) : null, [model, collectionPath, viewRows]);
  const hiddenFields = useMemo(() => allFields.filter((field) => fieldConfig.hidden.has(field)), [allFields, fieldConfig.hidden]);
  const titleField = useMemo(
    () => model ? findTitleField(getMainColumns(model, collectionPath), rows) : null,
    [model, collectionPath, rows],
  );
  const relationConfigKey = useMemo(
    () => selectedPath && relationConfigField
      ? buildRelationKey({ sourceFile: selectedPath, sourceCollection: collectionPath, fieldPath: [relationConfigField] })
      : null,
    [selectedPath, collectionPath, relationConfigField],
  );
  const relationConfigForDialog = relationConfigKey ? (viewConfig.relations[relationConfigKey] ?? null) : null;
  const issues = useMemo(
    () => model && selectedPath ? buildValidationIssues(rows, fieldConfig, relationIndexes, viewConfig, selectedPath, collectionPath) : {},
    [model, rows, fieldConfig, relationIndexes, viewConfig, selectedPath, collectionPath],
  );
  const appFrameStyle = useMemo(() => ({ "--sidebar-width": `${sidebarWidth}px` }) as CSSProperties, [sidebarWidth]);

  useEffect(() => {
    document.querySelectorAll(".data-table tbody tr.selected-row").forEach((row) => row.classList.remove("selected-row"));
    if (selectedRowIndex == null) return;
    document.querySelector(`.data-table tbody tr[data-row-index="${selectedRowIndex}"]`)?.classList.add("selected-row");
  }, [selectedRowIndex, collectionPath, viewModel]);

  function mutate(mutator: () => void) {
    mutator();
    dataDirtyRef.current = true;
    setDataDirty(true);
    saveCoordinator.markDirty("document");
    bump((value) => value + 1);
  }

  function mutateViewConfig(mutator: (draft: ViewConfig) => void) {
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
    bump((value) => value + 1);
  }

  function mutateOptionFieldTransaction({
    mutateData,
    mutateViewConfigDraft,
  }: {
    mutateData?: () => void;
    mutateViewConfigDraft?: (draft: ViewConfig) => void;
  }) {
    let changed = false;
    if (mutateData) {
      mutateData();
      dataDirtyRef.current = true;
      setDataDirty(true);
      saveCoordinator.markDirty("document");
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
    if (changed) bump((value) => value + 1);
  }

  function mutateSelectedViewProfile(mutator: (draft: UserViewProfile) => void) {
    if (!selectedViewProfileName) return false;
    const current = normalizeUserViewProfile(selectedViewProfileRef.current);
    const next: UserViewProfile = {
      sidebarWidth: current.sidebarWidth,
      detailPanelWidth: current.detailPanelWidth,
      fileOrder: [...current.fileOrder],
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
    selectedViewProfileRef.current = next;
    setSelectedViewProfile(next);
    profileDirtyRef.current = true;
    setProfileDirty(true);
    saveCoordinator.markDirty("profile");
    bump((value) => value + 1);
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

  function updateActiveViewLayout(mutator: (draft: UserViewLayoutState) => void) {
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
    bump((value) => value + 1);
  }

  function updateActiveViewDraft(patch: Partial<CollectionView>) {
    if (saving) return;
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
    bump((value) => value + 1);
  }

  function handleReorderFiles(fileOrder: string[]) {
    const nextOrder = normalizeFileOrder(files, fileOrder);
    if (mutateSelectedViewProfile((draft) => {
      draft.fileOrder = nextOrder;
    })) return;
    writeLocalFileOrder(window.localStorage, nextOrder);
    bump((value) => value + 1);
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

  function handleEditCell(rowIndex: number, fieldName: string, value: unknown) {
    if (!model) return;
    mutate(() => setCellValue(model, collectionPath, rowIndex, fieldName, value));
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
    updateActiveViewLayout((draft) => {
      draft.detailOrder = [...nextOrder];
    });
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

  async function handleSelectViewProfile(name: string) {
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
    ), uiPreferences);
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

  function selectRow(rowIndex: number) {
    flushSync(() => setSelectedRowIndex(rowIndex));
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
      setSelectedRowIndex(rows.length);
    });
  }

  function handleDeleteRow(rowIndex: number) {
    setPendingDeleteRow(rowIndex);
  }

  function confirmDeleteRow() {
    if (!model || pendingDeleteRow == null) return;
    mutate(() => {
      deleteRow(model, collectionPath, pendingDeleteRow);
      setSelectedRowIndex(Math.min(pendingDeleteRow, Math.max(0, rows.length - 2)));
    });
    setPendingDeleteRow(null);
  }

  function handleAddField() {
    setNewFieldName("");
    setNewFieldType("Text");
    setNewFieldApplyAll(false);
    setAddFieldOpen(true);
  }

  function confirmAddField() {
    if (!model || selectedRowIndex == null || !newFieldName.trim()) return;
    const fieldName = newFieldName.trim();
    mutate(() => addField(model, collectionPath, selectedRowIndex, fieldName, defaultEmptyValue(newFieldType), newFieldApplyAll));
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
    bump((value) => value + 1);
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
    bump((value) => value + 1);
  }

  function currentSharedViewDraftState(): SharedViewDraftState {
    return selectedViewProfileName ? selectedViewProfileRef.current : localSharedViewDrafts;
  }

  function handleSelectSharedView(viewId: string) {
    if (saving || !activeCollectionKey) return;
    const current = currentSharedViewDraftState();
    updateSharedViewDraftState({
      lastActiveViews: { ...current.lastActiveViews, [activeCollectionKey]: viewId },
      viewDrafts: { ...current.viewDrafts },
      viewOrderDrafts: { ...current.viewOrderDrafts },
    });
    setSelectedRowIndex(0);
    setDetailOpen(false);
  }

  async function handleCreateSharedView() {
    if (saving || !activeCollectionKey || !activeSharedView || !activeView) return;
    setSaving(true);
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
      setSaving(false);
    }
  }

  async function handleDuplicateSharedView(viewId: string) {
    if (saving || !activeCollectionKey) return;
    const sourceView = orderedCollectionViews.find((view: CollectionView) => view.id === viewId);
    if (!sourceView) return;
    const draft = draftSource.viewDrafts?.[activeCollectionKey]?.[viewId];
    const snapshot = mergeSharedViewWithDraft(sourceView, draft) as CollectionView;
    setSaving(true);
    setStatus("");
    try {
      const result = createSharedViewConfig(sharedViewsConfig, activeCollectionKey, viewId, snapshot);
      const nextConfig = result.config as SharedViewsConfig;
      await saveSharedViews(nextConfig, activeProjectId);
      setSharedViewsConfig(nextConfig);
      const current = currentSharedViewDraftState();
      updateSharedViewDraftState({
        lastActiveViews: { ...current.lastActiveViews, [activeCollectionKey]: result.view.id },
        viewDrafts: { ...current.viewDrafts },
        viewOrderDrafts: { ...current.viewOrderDrafts },
      });
      setStatus("已创建团队共享视图副本");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  async function handleRenameSharedView(viewId: string, name: string) {
    if (saving || !activeCollectionKey) return;
    setSaving(true);
    setStatus("");
    try {
      const nextConfig = renameSharedViewConfig(sharedViewsConfig, activeCollectionKey, viewId, name) as SharedViewsConfig;
      await saveSharedViews(nextConfig, activeProjectId);
      setSharedViewsConfig(nextConfig);
      setStatus("已重命名团队共享视图");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteSharedView(viewId: string) {
    if (saving || !activeCollectionKey || !selectedPath) return;
    const current = currentSharedViewDraftState();
    const result = deleteSharedViewConfig(sharedViewsConfig, current, activeCollectionKey, viewId);
    if (!result.deleted) {
      setStatus("至少需要保留一个团队共享视图");
      return;
    }
    setSaving(true);
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
      setSelectedRowIndex(0);
      setDetailOpen(false);
      setStatus("已删除团队共享视图");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  function handleReorderSharedViews(viewIds: string[]) {
    if (saving || !activeCollectionKey) return;
    const next = draftSharedViewOrder(currentSharedViewDraftState(), activeCollectionKey, collectionSharedViews, viewIds);
    updateSharedViewDraftState(next);
  }

  function handleResetSharedViewDraft() {
    if (saving || !activeCollectionKey || !activeSharedView) return;
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
    bump((value) => value + 1);
  }

  async function handleSaveViewForEveryone() {
    if (saving || !activeCollectionKey || !activeSharedView) return;
    const current = currentSharedViewDraftState();
    if (!hasViewDraft(current, activeCollectionKey, activeSharedView.id)) return;
    setSaving(true);
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
      setSaving(false);
    }
  }

  function shouldInterceptPrimaryKeySync(currentDataDirty: boolean, force = false) {
    const currentPrimaryKeySyncPlan = primaryKeySyncPlanRef.current;
    return Boolean(
      currentDataDirty
      && (force || detailOpenRef.current)
      && currentPrimaryKeySyncPlan
      && currentPrimaryKeySyncPlan.oldValue !== currentPrimaryKeySyncPlan.newValue
      && (currentPrimaryKeySyncPlan.rewrites.length > 0 || currentPrimaryKeySyncPlan.blockingIssues.length > 0),
    );
  }

  async function preparePrimaryKeySyncSnapshot(plan: PrimaryKeySyncPlan, currentModel: DocumentModel, currentPath: string) {
    const pendingSaves: PendingDocumentSave[] = [
      { path: currentPath, root: cloneDataRoot(currentModel.root) },
    ];
    const sourceRoots = new Map<string, unknown>();
    for (const sourceFile of plan.sourceFiles) {
      if (sourceFile === currentPath) continue;
      const documentModel = await loadDocument(sourceFile, activeProjectIdRef.current);
      sourceRoots.set(sourceFile, cloneDataRoot(documentModel.root));
    }
    for (const rewrite of plan.rewrites) {
      if (rewrite.sourceFile === currentPath) continue;
      const root = sourceRoots.get(rewrite.sourceFile);
      if (!root) throw new Error(`无法加载来源文件：${rewrite.sourceFile}`);
      const sourceModel = buildDocumentModel(root, "json", rewrite.sourceFile);
      const rows = getRows(sourceModel, rewrite.sourceCollection) as DataRecord[];
      const row = rows[rewrite.rowIndex];
      if (row && rewrite.fieldPath.length === 1) row[rewrite.fieldPath[0]] = rewrite.newValue;
    }
    for (const [path, root] of sourceRoots.entries()) {
      pendingSaves.push({ path, root });
    }
    return { plan, pendingSaves };
  }

  function formatPrimaryKeySyncBlockingIssues(plan: PrimaryKeySyncPlan) {
    return plan.blockingIssues.map((issue) => {
      if (issue === "unchanged-primary-key") return "主键值没有发生变化。";
      if (issue === "empty-primary-key") return "新主键不能为空。";
      if (issue === "duplicate-primary-key") return "新主键与当前集合中的已有主键冲突。";
      if (issue === "source-document-load-failed") return "存在来源文件读取失败，当前不能执行同步保存。";
      if (issue === "invalid-relation-config") return "存在损坏的 relation 配置，当前不能执行同步保存。";
      return issue;
    }).join(" ");
  }

  function formatPrimaryKeySyncSaveResult(result: SaveDocumentsResult) {
    if (result.ok) return `已同步保存 ${result.savedPaths.length} 个文件。`;
    const saved = result.savedPaths.length ? `已成功：${result.savedPaths.join("、")}。` : "尚未成功写入任何文件。";
    const failed = result.failedPath ? `失败文件：${result.failedPath}。` : "";
    const reason = result.errorMessage ? `原因：${result.errorMessage}` : "";
    return `${saved}${failed}${reason} 当前磁盘状态可能已部分更新。`;
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
    const currentPrimaryKeySyncPlan = primaryKeySyncPlanRef.current;
    if (!dirtyDomains.length) return { outcome: "idle" } as const;
    if (savingRef.current || closingRef.current || rebuildingRef.current) return { outcome: "deferred" } as const;
    if (currentDataDirty && currentModel && currentSelectedPath && shouldInterceptPrimaryKeySync(currentDataDirty, false)) {
      if (currentPrimaryKeySyncPlan?.blockingIssues.length) {
        setStatus(formatPrimaryKeySyncBlockingIssues(currentPrimaryKeySyncPlan));
        return { outcome: "blocked-confirmation" } as const;
      }
      setSaving(true);
      setStatus("");
      try {
        const snapshot = await preparePrimaryKeySyncSnapshot(currentPrimaryKeySyncPlan!, currentModel, currentSelectedPath);
        primaryKeySyncSnapshotRef.current = snapshot;
        setPrimaryKeySyncResult(null);
        setPrimaryKeySyncDialogOpen(true);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
        throw error;
      } finally {
        setSaving(false);
      }
      return { outcome: "blocked-confirmation" } as const;
    }
    setSaving(true);
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
      setSaving(false);
    }
  }

  async function persistChanges(forcePrimaryKeySync = false) {
    const currentDataDirty = dataDirtyRef.current;
    if (forcePrimaryKeySync && currentDataDirty && shouldInterceptPrimaryKeySync(currentDataDirty, true)) {
      if (primaryKeySyncPlan?.blockingIssues.length) {
        setStatus(formatPrimaryKeySyncBlockingIssues(primaryKeySyncPlan));
        return;
      }
      const currentModel = modelRef.current;
      const currentSelectedPath = selectedPathRef.current;
      if (!currentModel || !currentSelectedPath || saving || closing || rebuilding) return;
      setSaving(true);
      setStatus("");
      try {
        const snapshot = await preparePrimaryKeySyncSnapshot(primaryKeySyncPlan!, currentModel, currentSelectedPath);
        primaryKeySyncSnapshotRef.current = snapshot;
        setPrimaryKeySyncResult(null);
        setPrimaryKeySyncDialogOpen(true);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
      } finally {
        setSaving(false);
      }
      return;
    }
    await saveCoordinator.flush("flush");
  }

  async function confirmPrimaryKeySyncSave() {
    const snapshot = primaryKeySyncSnapshotRef.current;
    const currentSelectedPath = selectedPathRef.current;
    if (!snapshot || !currentSelectedPath) return;
    setSaving(true);
    setStatus("");
    try {
      const result = await saveDocuments(snapshot.pendingSaves, activeProjectId);
      setPrimaryKeySyncResult(result);
      if (!result.ok) {
        setStatus(formatPrimaryKeySyncSaveResult(result));
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
      await openDocumentAt(currentSelectedPath, collectionPath, selectedRowIndex ?? undefined, detailOpen);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  async function handleCloseServer() {
    if (closing || saving || rebuilding) return;
    if (globalDirty && !window.confirm("有未保存更改，关闭服务会丢失这些更改。是否继续关闭？")) return;
    setClosing(true);
    setStatus("");
    try {
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
    if (rebuilding || closing || saving) return;
    if (globalDirty && !window.confirm("有未保存更改，刷新构建会丢失这些更改。是否继续刷新构建？")) return;
    setRebuilding(true);
    setStatus("");
    try {
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
    if (closing || rebuilding || saving) return;
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
          onSelectFile={openFile}
          onReorderFiles={handleReorderFiles}
          onSelectCollection={setCollectionPath}
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
        onSelectFile={openFile}
        onReorderFiles={handleReorderFiles}
        onSelectCollection={(path) => { setCollectionPath(path); setSelectedRowIndex(0); setDetailOpen(false); }}
        onSelectProject={selectProject}
        onOpenProjectSettings={() => setProjectSettingsOpen(true)}
      />
      <div className="sidebar-resize-handle" onPointerDown={beginSidebarResize} aria-label="调整左侧栏宽度" role="separator" />
      <section className="workspace">
        <Toolbar
          currentPath={selectedPath}
          collectionPath={collectionPath}
          viewProfiles={viewProfiles}
          selectedViewProfileName={selectedViewProfileName}
          activeThemeId={uiPreferences.activeThemeId}
          baseFontSize={uiPreferences.baseFontSize}
          rowCount={rows.length}
          visibleCount={viewRows.length}
          query={activeView?.query ?? ""}
          autosaveState={autosaveState}
          saving={saving}
          closing={closing}
          rebuilding={rebuilding}
          status={statusText}
          hiddenFields={hiddenFields}
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
        <div className="main-content">
          <ViewTabs
            views={orderedCollectionViews}
            activeViewId={activeSharedView?.id ?? null}
            dirtyViewIds={dirtyViewIds}
            saving={saving}
            filterBarVisible={filterBarVisible}
            hasActiveFilters={activeViewHasFilters}
            viewOrderDirty={viewOrderDirty}
            searchQuery={activeView?.query ?? ""}
            onSelectView={handleSelectSharedView}
            onCreateView={handleCreateSharedView}
            onRenameView={handleRenameSharedView}
            onDeleteView={handleDeleteSharedView}
            onDuplicateView={handleDuplicateSharedView}
            onReorderViews={handleReorderSharedViews}
            onToggleFilterBar={() => setFilterBarVisible((value) => !value)}
            onSearchQueryChange={(query) => updateActiveViewDraft({ query })}
          />
          {filterBarVisible ? (
            <ViewFilterBar
              collectionKey={activeCollectionKey}
              view={activeView}
              fields={allFields}
              fieldConfig={fieldConfig}
              fieldViewConfigs={fieldViewConfigs}
              fieldTypes={viewFilterFieldTypes}
              relationFilterOptions={viewFilterOptions}
              dirty={activeViewDirty}
              viewOrderDirty={viewOrderDirty}
              saving={saving}
              autoOpenRuleId={pendingOpenFilterRuleId}
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
            model={viewModel!}
            schemaModel={model}
            sourcePath={selectedPath}
            collectionPath={collectionPath}
            fieldConfig={fieldConfig}
            fieldViewConfigs={fieldViewConfigs}
            backlinkColumns={backlinkColumns}
            backlinkValuesByRowIndex={backlinkValuesByRowIndex}
            relationOptions={relationOptions}
            relationConfigs={viewConfig.relations}
            revision={viewRevision}
            sort={activeViewSort}
            issues={issues}
            titleField={titleField}
            onSelectRow={selectRow}
            onOpenDetail={openDetail}
            onOpenBacklink={handleOpenBacklink}
            onEditCell={handleEditCell}
            onCommitMultiSelectDraft={handleCommitMultiSelectOptionFieldDraft}
            onCommitSelectDraft={handleCommitSelectOptionFieldDraft}
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
            onAddField={handleAddField}
            onDeleteField={handleDeleteField}
          />
          <DetailPanel
            open={detailOpen}
            panelWidth={detailPanelWidth}
            row={selectedRow}
            rowIndex={selectedRowIndex}
            rowCount={rows.length}
            sourcePath={selectedPath}
            collectionPath={collectionPath}
            titleField={titleField}
            detailOrder={fieldConfig.detailOrder}
            displayTypes={fieldConfig.displayTypes}
            fieldViewConfigs={fieldViewConfigs}
            issues={issues}
            relationOptions={relationOptions}
            relationConfigs={viewConfig.relations}
            relationBacklinks={relationBacklinks}
            primaryKeyImpacts={primaryKeyImpacts}
            primaryKeySyncPlan={primaryKeySyncPlan}
            primaryKeySyncResult={primaryKeySyncResult}
            saving={saving}
            onCommitMultiSelectDraft={(fieldName, patch) => selectedRowIndex != null && handleCommitMultiSelectOptionFieldDraft(selectedRowIndex, fieldName, patch)}
            onCommitSelectDraft={(fieldName, patch) => selectedRowIndex != null && handleCommitSelectOptionFieldDraft(selectedRowIndex, fieldName, patch)}
            onOpenBacklink={handleOpenBacklink}
            onRequestSyncSave={() => void persistChanges(true)}
            onOpenRelationTarget={handleOpenRelationTarget}
            onSelectRow={selectRow}
            onClose={() => setDetailOpen(false)}
            onPanelWidthChange={handleDetailPanelWidthChange}
            onPanelWidthCommit={commitDetailPanelWidth}
            onEditField={(fieldName, value) => selectedRowIndex != null && handleEditCell(selectedRowIndex, fieldName, value)}
            onReorderFields={handleReorderDetailFields}
          />
        </div>
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
        saving={saving}
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
  saving: boolean;
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
            <button className="primary-button" disabled={!canConfirm || props.saving} onClick={props.onConfirm}>
              {props.saving ? "保存中..." : "确认同步"}
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

function describePrimaryKeySyncBlockingIssues(plan: PrimaryKeySyncPlan) {
  return plan.blockingIssues.map((issue) => {
    if (issue === "unchanged-primary-key") return "主键值没有发生变化。";
    if (issue === "empty-primary-key") return "新主键不能为空。";
    if (issue === "duplicate-primary-key") return "新主键与当前集合中的已有主键冲突。";
    if (issue === "source-document-load-failed") return "存在来源文件读取失败，当前不能执行同步保存。";
    if (issue === "invalid-relation-config") return "存在损坏的 relation 配置，当前不能执行同步保存。";
    return issue;
  }).join(" ");
}

function describePrimaryKeySyncSaveResult(result: SaveDocumentsResult) {
  if (result.ok) return `已同步保存 ${result.savedPaths.length} 个文件。`;
  const saved = result.savedPaths.length ? `已成功：${result.savedPaths.join("、")}。` : "尚未成功写入任何文件。";
  const failed = result.failedPath ? `失败文件：${result.failedPath}。` : "";
  const reason = result.errorMessage ? `原因：${result.errorMessage}` : "";
  return `${saved}${failed}${reason} 当前磁盘状态可能已部分更新。`;
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

function buildValidationIssues(
  rows: DataRecord[],
  fieldConfig: FieldConfig,
  relationIndexes: Record<string, Set<string> | null>,
  viewConfig: ViewConfig,
  sourcePath: string,
  collectionPath: string,
) {
  const result: Record<string, ValidationIssue | null> = {};
  const fields = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const primaryKey = viewConfig.primaryKeys[buildCollectionKey(sourcePath, collectionPath)] ?? null;
  for (const field of fields) {
    const isPrimaryKey = field === primaryKey;
    for (const duplicate of validateUniqueTyped(rows, field, { unique: isPrimaryKey })) {
      if (duplicate.rowIndex != null) result[`${duplicate.rowIndex}:${field}`] = duplicate;
    }
    rows.forEach((row, rowIndex) => {
      const required = validateRequiredTyped(row[field], field, { required: isPrimaryKey });
      if (required) result[`${rowIndex}:${field}`] = required;
      const displayType = fieldConfig.displayTypes[field];
      if (displayType && !isCompatible(displayType, row[field])) {
        result[`${rowIndex}:${field}`] = { severity: "error" as const, message: `当前值不能用 ${displayType} 显示` };
      }
      const relationIssue = validateRelationAtPath([field], row[field], relationIndexes, viewConfig, sourcePath, collectionPath);
      if (relationIssue && !result[`${rowIndex}:${field}`]) result[`${rowIndex}:${field}`] = relationIssue;
      for (const nestedIssue of collectNestedRelationIssues(row[field], [field], relationIndexes, viewConfig, sourcePath, collectionPath)) {
        if (!result[`${rowIndex}:${field}`]) result[`${rowIndex}:${field}`] = nestedIssue;
      }
    });
  }
  return result;
}

function collectNestedRelationIssues(
  value: unknown,
  path: Array<string | number>,
  relationIndexes: Record<string, Set<string> | null>,
  viewConfig: ViewConfig,
  sourcePath: string,
  collectionPath: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => issues.push(...collectNestedRelationIssues(item, [...path, index], relationIndexes, viewConfig, sourcePath, collectionPath)));
  } else if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      const nestedPath = [...path, key];
      const issue = validateRelationAtPath(nestedPath, nested, relationIndexes, viewConfig, sourcePath, collectionPath);
      if (issue) issues.push(issue);
      issues.push(...collectNestedRelationIssues(nested, nestedPath, relationIndexes, viewConfig, sourcePath, collectionPath));
    }
  }
  return issues;
}

function validateRelationAtPath(
  pathParts: Array<string | number>,
  value: unknown,
  relationIndexes: Record<string, Set<string> | null>,
  viewConfig: ViewConfig,
  sourcePath: string,
  collectionPath: string,
): ValidationIssue | null {
  const relationKey = buildRelationKey({ sourceFile: sourcePath, sourceCollection: collectionPath, fieldPath: pathParts });
  if (viewConfig.relations[relationKey]) {
    const config = viewConfig.relations[relationKey];
    const index = relationIndexes[relationKey];
    if (index == null) return { severity: "neutral" as const, message: `${config.targetKey} 未检查` };
    if (config.mode === "multi") {
      if (!Array.isArray(value)) return { severity: "error" as const, message: `当前值不能用 ${config.targetKey} 多值关联显示` };
      const missing = value
        .filter((item) => item == null || typeof item !== "object")
        .map((item) => validateRelationValueTyped(item, index))
        .filter(Boolean)
        .map((issue) => issue!.message.replace("未找到引用 ", ""));
      return missing.length ? { severity: "warning" as const, message: `未找到引用 ${missing.join(", ")}` } : null;
    }
    if (Array.isArray(value)) return { severity: "error" as const, message: `当前值不能用 ${config.targetKey} 单值关联显示` };
    if (value && typeof value === "object") return null;
    return validateRelationValueTyped(value, index);
  }
  return null;
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

function replaceRowsForView(model: DocumentModel, collectionPath: string, rows: DataRecord[]) {
  if (collectionPath === "$") return rows;
  if (!model.root || typeof model.root !== "object" || Array.isArray(model.root)) return model.root;
  return { ...(model.root as Record<string, unknown>), [collectionPath]: rows };
}

function cloneDataRoot<T>(value: T): T {
  return value == null ? value : structuredClone(value);
}

function emptyUserViewProfile(): UserViewProfile {
  return {
    sidebarWidth: null,
    detailPanelWidth: null,
    fileOrder: [],
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

function buildProfileFromCurrentView(path: string | null, collectionPath: string, fieldConfig: FieldConfig, viewId: string | null, sidebarWidth: number, detailPanelWidth: number, fileOrder: string[], appearance: UiPreferences): UserViewProfile {
  if (!path) {
    return {
      sidebarWidth,
      detailPanelWidth,
      fileOrder: [...fileOrder],
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
