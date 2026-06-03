import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { flushSync } from "react-dom";
import * as Dialog from "@radix-ui/react-dialog";
import * as Select from "@radix-ui/react-select";
import {
  checkEditorHealth,
  checkRecoveryBridgeHealth,
  listFiles,
  listViewProfiles,
  loadDocument,
  loadViewConfig,
  loadViewProfile,
  recoverableRequestEventName,
  reopenEditor,
  rebuildFrontend,
  saveDocument,
  saveDocuments,
  shutdownServer,
  saveViewConfig,
  saveViewProfile,
  type DataFile,
  type PendingDocumentSave,
  type SaveDocumentsResult,
  type UserViewProfile,
  type ViewConfig,
} from "./api/client";
import { Sidebar } from "./components/Sidebar";
import { Toolbar } from "./components/Toolbar";
import { RelationConfigDialog } from "./components/RelationConfigDialog";
import { PrimaryKeyCandidateBanner } from "./components/PrimaryKeyCandidateBanner";
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
import type { BacklinkConfig, FieldViewConfig, MultiSelectOptionColor, RealFieldType, RelationConfig } from "./model/viewConfig";
import { currentRelationsVersion, defaultBacklinkConfigs, defaultPrimaryKeys, defaultRelationConfigs } from "./relation-defaults.mjs";
import {
  removeMultiSelectOptionFromRows,
  removeSingleSelectOptionFromRows,
  renameMultiSelectOptionInRows,
  renameSingleSelectOptionInRows,
} from "./multiselect-config.mjs";
import {
  emptyLocalViewState,
  readCollectionViewState,
  readLocalViewState,
  writeLocalViewState,
} from "./view-state-storage.mjs";

type ServiceLifecycleState = "running" | "closed" | "recovering" | "disconnected" | "recoveredPendingReload" | "bridgeUnavailable";
const defaultRecoveryBridgePort = 8791;

export function App() {
  const [files, setFiles] = useState<DataFile[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [model, setModel] = useState<DocumentModel | null>(null);
  const [collectionPath, setCollectionPath] = useState("$");
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [dataDirty, setDataDirty] = useState(false);
  const [viewConfigDirty, setViewConfigDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [closing, setClosing] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [serviceLifecycleState, setServiceLifecycleState] = useState<ServiceLifecycleState>("running");
  const [disconnectMessage, setDisconnectMessage] = useState("");
  const [flashStatus, setFlashStatus] = useState(() => consumeTransientStatus());
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState<{ field: string; direction: "asc" | "desc" } | null>(null);
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
  const [viewRevision, bump] = useState(0);
  const [viewConfig, setViewConfig] = useState<ViewConfig>(emptyProjectViewConfig());
  const [viewProfiles, setViewProfiles] = useState<string[]>([]);
  const [selectedViewProfileName, setSelectedViewProfileName] = useState<string | null>(() => localStorage.getItem(selectedViewProfileStorageKey));
  const [selectedViewProfile, setSelectedViewProfile] = useState<UserViewProfile>(emptyUserViewProfile());
  const [bridgePort, setBridgePort] = useState(defaultRecoveryBridgePort);
  const [newProfileOpen, setNewProfileOpen] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const [relationConfigField, setRelationConfigField] = useState<string | null>(null);
  const [dismissedCandidateKeys, setDismissedCandidateKeys] = useState<string[]>([]);
  const [primaryKeyCandidateDialogOpen, setPrimaryKeyCandidateDialogOpen] = useState(false);
  const [selectedPrimaryKeyCandidate, setSelectedPrimaryKeyCandidate] = useState<string>("");
  const openRequestRef = useRef(0);
  const maintenanceRequestRef = useRef(0);
  const modelRef = useRef<DocumentModel | null>(null);
  const savedDocumentRootRef = useRef<unknown | null>(null);
  const selectedPathRef = useRef<string | null>(null);
  const dataDirtyRef = useRef(false);
  const viewConfigRef = useRef<ViewConfig>(emptyProjectViewConfig());
  const viewConfigDirtyRef = useRef(false);
  const relationIndexRequestRef = useRef(0);
  const selectedViewProfileNameRef = useRef<string | null>(null);
  const selectedViewProfileRef = useRef<UserViewProfile>(emptyUserViewProfile());
  const bridgePortRef = useRef(defaultRecoveryBridgePort);
  const serviceLifecycleStateRef = useRef<ServiceLifecycleState>("running");
  const autoRecoverAttemptedRef = useRef(false);
  const disconnectFlowPromiseRef = useRef<Promise<void> | null>(null);
  const healthFailureCountRef = useRef(0);
  const disconnectConfirmTimerRef = useRef<number | null>(null);
  const manualClosedRef = useRef(false);
  const [sidebarWidth, setSidebarWidth] = useState(() => readSidebarWidth());
  const primaryKeySyncSnapshotRef = useRef<{ plan: PrimaryKeySyncPlan; pendingSaves: PendingDocumentSave[] } | null>(null);
  const profileSaveTimerRef = useRef<number | null>(null);
  const profileSavePromiseRef = useRef<Promise<void> | null>(null);
  const profileSaveResolveRef = useRef<(() => void) | null>(null);
  const dirty = dataDirty || viewConfigDirty;
  const statusText = status || flashStatus;
  const selectedCollectionKey = selectedPath ? buildCollectionKey(selectedPath, collectionPath) : null;

  useEffect(() => { modelRef.current = model; }, [model]);
  useEffect(() => { selectedPathRef.current = selectedPath; }, [selectedPath]);
  useEffect(() => { dataDirtyRef.current = dataDirty; }, [dataDirty]);
  useEffect(() => { viewConfigRef.current = viewConfig; }, [viewConfig]);
  useEffect(() => { viewConfigDirtyRef.current = viewConfigDirty; }, [viewConfigDirty]);
  useEffect(() => { selectedViewProfileNameRef.current = selectedViewProfileName; }, [selectedViewProfileName]);
  useEffect(() => { selectedViewProfileRef.current = selectedViewProfile; }, [selectedViewProfile]);
  useEffect(() => { bridgePortRef.current = bridgePort; }, [bridgePort]);
  useEffect(() => { serviceLifecycleStateRef.current = serviceLifecycleState; }, [serviceLifecycleState]);
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

  useEffect(() => {
    listFiles()
      .then((nextFiles) => {
        setFiles(nextFiles);
        if (nextFiles[0]) void openFile(nextFiles[0].path);
      })
      .catch((error) => setStatus(error.message));
  }, []);

  useEffect(() => {
    loadViewConfig()
      .then((config) => setViewConfig(config))
      .catch((error) => setStatus(error.message));
  }, []);

  useEffect(() => {
    listViewProfiles()
      .then((profiles) => setViewProfiles(profiles))
      .catch((error) => setStatus(error.message));
  }, []);

  useEffect(() => {
    if (!selectedViewProfileName) {
      setSelectedViewProfile(emptyUserViewProfile());
      localStorage.removeItem(selectedViewProfileStorageKey);
      return;
    }
    localStorage.setItem(selectedViewProfileStorageKey, selectedViewProfileName);
    loadViewProfile(selectedViewProfileName)
      .then((profile) => {
        setSelectedViewProfile(profile);
        setSidebarWidth(clampSidebarWidth(profile.sidebarWidth ?? defaultSidebarWidth));
        bump((value) => value + 1);
      })
      .catch((error) => setStatus(error.message));
  }, [selectedViewProfileName]);

  useEffect(() => {
    if (!selectedViewProfileName) return;
    if (profileSaveTimerRef.current != null) window.clearTimeout(profileSaveTimerRef.current);
    profileSavePromiseRef.current = new Promise((resolve) => {
      profileSaveResolveRef.current = resolve;
    });
    profileSaveTimerRef.current = window.setTimeout(() => {
      const profileName = selectedViewProfileNameRef.current;
      const profile = selectedViewProfileRef.current;
      if (!profileName) return;
      void commitProfileSave(profileName, profile);
    }, 250);
    return () => {
      if (profileSaveTimerRef.current != null) window.clearTimeout(profileSaveTimerRef.current);
    };
  }, [selectedViewProfile, selectedViewProfileName]);

  useEffect(() => {
    function onPageHide() {
      void flushPendingProfileSave();
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
    await openDocumentAt(path);
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
    return dataDirtyRef.current || viewConfigDirtyRef.current;
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

  async function openDocumentAt(path: string, targetCollection?: string, targetRowIndex?: number, openDetailPanel = false) {
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
    const documentModel = await loadDocument(path);
    if (requestId !== openRequestRef.current) return;
    const nextCollection = targetCollection ?? documentModel.collections[0]?.path ?? "$";
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
    setSort(null);
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
        documentsByPath[path] = path === selectedPath && model ? model : await loadDocument(path);
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
        documentsByPath[path] = path === selectedPath ? model : await loadDocument(path);
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
      const targetDocument = await loadDocument(config.targetFile);
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
        const reference = await loadDocument(target.targetFile);
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
  const filteredRows = useMemo(() => {
    const indexed = rows.map((row, index) => {
      const copy = { ...row };
      Object.defineProperty(copy, "__rowIndex", { value: index, enumerable: false });
      return copy;
    });
    if (!query.trim()) return indexed;
    const needle = query.toLowerCase();
    return indexed.filter((row) => Object.values(row).some((value) => String(value ?? "").toLowerCase().includes(needle)));
  }, [rows, query]);
  const selectedRow = selectedRowIndex == null ? null : rows[selectedRowIndex] ?? null;
  useEffect(() => {
    void loadMaintenanceInfo();
  }, [selectedPath, collectionPath, selectedRowIndex, selectedRow, viewConfig.relations, viewRevision]);
  const viewModel = useMemo(() => model ? ({ ...model, root: replaceRowsForView(model, collectionPath, filteredRows) } as DocumentModel) : null, [model, collectionPath, filteredRows]);
  const fieldConfig = useMemo(
    () => buildFieldConfig(
      selectedPath,
      collectionPath,
      model,
      viewConfig,
      selectedViewProfileName ? "profile" : "local",
      selectedViewProfileName ? selectedViewProfile : null,
      backlinkColumns.map((column) => column.fieldName),
    ),
    [selectedPath, collectionPath, model, viewConfig, selectedViewProfile, selectedViewProfileName, viewRevision, backlinkColumns],
  );
  const allFields = useMemo(
    () => model ? getOrderedFields(model, collectionPath, fieldConfig.order, backlinkColumns.map((column) => column.fieldName)) : [],
    [model, collectionPath, fieldConfig.order, backlinkColumns],
  );
  const fieldViewConfigs = useMemo(
    () => model ? buildFieldViewConfigs(selectedPath, collectionPath, model, viewConfig) : {},
    [selectedPath, collectionPath, model, viewConfig],
  );
  const hiddenFields = useMemo(() => allFields.filter((field) => fieldConfig.hidden.has(field)), [allFields, fieldConfig.hidden]);
  const titleField = useMemo(
    () => model ? findTitleField(getOrderedFields(model, collectionPath, fieldConfig.order, backlinkColumns.map((column) => column.fieldName)), rows) : null,
    [model, collectionPath, fieldConfig.order, rows, backlinkColumns],
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
    bump((value) => value + 1);
  }

  function mutateViewConfig(mutator: (draft: ViewConfig) => void) {
    setViewConfig((current) => {
      const next = cloneViewConfig(current);
      mutator(next);
      viewConfigRef.current = next;
      return next;
    });
    viewConfigDirtyRef.current = true;
    setViewConfigDirty(true);
    bump((value) => value + 1);
  }

  function mutateSelectedViewProfile(mutator: (draft: UserViewProfile) => void) {
    if (!selectedViewProfileName) return false;
    setSelectedViewProfile((current) => {
      const next: UserViewProfile = {
        sidebarWidth: current.sidebarWidth,
        collections: Object.fromEntries(Object.entries(current.collections).map(([key, value]) => [
          key,
          {
            hidden: [...value.hidden],
            wrapped: [...value.wrapped],
            order: [...value.order],
            detailOrder: [...value.detailOrder],
            widths: { ...value.widths },
          },
        ])),
      };
      mutator(next);
      return next;
    });
    bump((value) => value + 1);
    return true;
  }

  function updateActiveCollectionView(mutator: (draft: UserViewProfile["collections"][string]) => void) {
    if (!selectedPath) return;
    if (mutateSelectedViewProfile((draft) => {
      const collectionView = ensureCollectionView(draft, selectedPath, collectionPath);
      mutator(collectionView);
    })) return;
    const next = readLocalViewState({
      path: selectedPath,
      collectionPath,
      localStorage: window.localStorage,
    });
    mutator(next);
    writeLocalViewState({
      path: selectedPath,
      collectionPath,
      state: next,
      localStorage: window.localStorage,
    });
    bump((value) => value + 1);
  }

  async function commitProfileSave(name: string, profile: UserViewProfile) {
    if (profileSaveTimerRef.current != null) {
      window.clearTimeout(profileSaveTimerRef.current);
      profileSaveTimerRef.current = null;
    }
    try {
      await saveViewProfile(name, profile);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      profileSaveResolveRef.current?.();
      profileSaveResolveRef.current = null;
      profileSavePromiseRef.current = null;
    }
  }

  async function flushPendingProfileSave() {
    const profileName = selectedViewProfileNameRef.current;
    if (!profileName) return;
    if (profileSaveTimerRef.current != null) {
      await commitProfileSave(profileName, selectedViewProfileRef.current);
      return;
    }
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
    await saveViewConfigOnly((draft) => {
      delete draft.relations[key];
    });
    setStatus(`已清除关联字段 ${fieldName}，对应反向关联列将自动隐藏`);
  }

  async function confirmRelationConfig(config: RelationConfig) {
    if (!selectedPath || !relationConfigField) return;
    const key = buildRelationKey({ sourceFile: selectedPath, sourceCollection: collectionPath, fieldPath: [relationConfigField] });
    await saveViewConfigOnly((draft) => {
      draft.relations[key] = config;
    });
    setRelationConfigField(null);
  }

  async function saveViewConfigOnly(mutator: (draft: ViewConfig) => void) {
    if (saving) return;
    const next = cloneViewConfig(viewConfigRef.current);
    mutator(next);
    next.backlinks = syncBacklinksWithRelations(next.relations, next.backlinks) as Record<string, BacklinkConfig>;
    viewConfigRef.current = next;
    setViewConfig(next);
    setViewConfigDirty(true);
    viewConfigDirtyRef.current = true;
    bump((value) => value + 1);
    setSaving(true);
    setStatus("");
    try {
      await saveViewConfig(next);
      setViewConfigDirty(false);
      viewConfigDirtyRef.current = false;
      setStatus("已保存项目视图配置");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
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

  async function confirmPrimaryKeyCandidate() {
    if (!selectedPath || !selectedPrimaryKeyCandidate) return;
    await saveViewConfigOnly((draft) => {
      draft.primaryKeys[buildCollectionKey(selectedPath, collectionPath)] = selectedPrimaryKeyCandidate;
    });
    if (selectedCollectionKey) {
      setDismissedCandidateKeys((current) => current.filter((key) => key !== selectedCollectionKey));
    }
    setPrimaryKeyCandidateDialogOpen(false);
  }

  function handleHideField(fieldName: string) {
    if (!selectedPath) return;
    updateActiveCollectionView((draft) => {
      draft.hidden = addUnique(draft.hidden, fieldName);
    });
  }

  function handleUnhideField(fieldName: string) {
    if (!selectedPath) return;
    updateActiveCollectionView((draft) => {
      draft.hidden = draft.hidden.filter((value) => value !== fieldName);
    });
  }

  function handleUnhideAllFields() {
    if (!selectedPath) return;
    updateActiveCollectionView((draft) => {
      draft.hidden = [];
    });
  }

  function handleToggleWrapField(fieldName: string) {
    if (!selectedPath) return;
    updateActiveCollectionView((draft) => {
      draft.wrapped = draft.wrapped.includes(fieldName)
        ? draft.wrapped.filter((value) => value !== fieldName)
        : [...draft.wrapped, fieldName];
    });
  }

  function handleResizeField(fieldName: string, width: number) {
    if (!selectedPath) return;
    updateActiveCollectionView((draft) => {
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
    updateActiveCollectionView((draft) => {
      draft.order = nextOrder;
    });
  }

  function handleReorderFields(nextOrder: string[]) {
    if (!selectedPath || !model) return;
    const fields = getOrderedFields(model, collectionPath, fieldConfig.order, backlinkColumns.map((column) => column.fieldName));
    const normalizedOrder = orderColumns(fields, nextOrder);
    updateActiveCollectionView((draft) => {
      draft.order = normalizedOrder;
    });
  }

  function handleReorderDetailFields(nextOrder: string[]) {
    if (!selectedPath) return;
    updateActiveCollectionView((draft) => {
      draft.detailOrder = [...nextOrder];
    });
  }

  function handleSort(fieldName: string, direction: "asc" | "desc" | null) {
    setSort(direction ? { field: fieldName, direction } : null);
  }

  function handleRenameMultiSelectOption(fieldName: string, previousValue: string | number, nextValue: string) {
    if (!model) return;
    mutate(() => renameMultiSelectOptionInRows(getRows(model, collectionPath) as DataRecord[], fieldName, previousValue, nextValue));
    mutateViewConfig((draft) => {
      const key = fieldViewConfigKey(selectedPath, collectionPath, fieldName);
      if (!key) return;
      const current = ensureFieldViewConfig(draft, key);
      const previous = current.multiSelectOptions[String(previousValue)];
      const nextOptions = { ...current.multiSelectOptions };
      delete nextOptions[String(previousValue)];
      nextOptions[nextValue] = { label: nextValue, color: previous?.color ?? null };
      draft.fields[key] = { ...current, multiSelectOptions: nextOptions };
    });
  }

  function handleRenameSelectOption(fieldName: string, previousValue: string | number, nextValue: string) {
    if (!model) return;
    mutate(() => renameSingleSelectOptionInRows(getRows(model, collectionPath) as DataRecord[], fieldName, previousValue, nextValue));
    mutateViewConfig((draft) => {
      const key = fieldViewConfigKey(selectedPath, collectionPath, fieldName);
      if (!key) return;
      const current = ensureFieldViewConfig(draft, key);
      const previous = current.selectOptions[String(previousValue)];
      const nextOptions = { ...current.selectOptions };
      delete nextOptions[String(previousValue)];
      nextOptions[nextValue] = { label: nextValue, color: previous?.color ?? null };
      draft.fields[key] = { ...current, selectOptions: nextOptions };
    });
  }

  function handleDeleteMultiSelectOption(fieldName: string, optionValue: string | number) {
    if (!model) return;
    mutate(() => removeMultiSelectOptionFromRows(getRows(model, collectionPath) as DataRecord[], fieldName, optionValue));
    mutateViewConfig((draft) => {
      const key = fieldViewConfigKey(selectedPath, collectionPath, fieldName);
      if (!key || !draft.fields[key]) return;
      delete draft.fields[key].multiSelectOptions[String(optionValue)];
    });
  }

  function handleDeleteSelectOption(fieldName: string, optionValue: string | number) {
    if (!model) return;
    mutate(() => removeSingleSelectOptionFromRows(getRows(model, collectionPath) as DataRecord[], fieldName, optionValue));
    mutateViewConfig((draft) => {
      const key = fieldViewConfigKey(selectedPath, collectionPath, fieldName);
      if (!key || !draft.fields[key]) return;
      delete draft.fields[key].selectOptions[String(optionValue)];
    });
  }

  function handleSetMultiSelectOptionColor(fieldName: string, optionValue: string | number, color: MultiSelectOptionColor | null) {
    mutateViewConfig((draft) => {
      const key = fieldViewConfigKey(selectedPath, collectionPath, fieldName);
      if (!key) return;
      const current = ensureFieldViewConfig(draft, key);
      const optionKey = String(optionValue);
      const currentOption = current.multiSelectOptions[optionKey];
      draft.fields[key] = {
        ...current,
        multiSelectOptions: {
          ...current.multiSelectOptions,
          [optionKey]: {
            label: currentOption?.label ?? optionKey,
            color,
          },
        },
      };
    });
  }

  function handleSetSelectOptionColor(fieldName: string, optionValue: string | number, color: MultiSelectOptionColor | null) {
    mutateViewConfig((draft) => {
      const key = fieldViewConfigKey(selectedPath, collectionPath, fieldName);
      if (!key) return;
      const current = ensureFieldViewConfig(draft, key);
      const optionKey = String(optionValue);
      const currentOption = current.selectOptions[optionKey];
      draft.fields[key] = {
        ...current,
        selectOptions: {
          ...current.selectOptions,
          [optionKey]: {
            label: currentOption?.label ?? optionKey,
            color,
          },
        },
      };
    });
  }

  async function handleSelectViewProfile(name: string) {
    await flushPendingProfileSave();
    setSelectedViewProfileName(name === localProfileOptionValue ? null : name);
  }

  async function handleCreateViewProfile() {
    const name = newProfileName.trim();
    if (!name) return;
    const activeSnapshot = selectedPath
      ? readCollectionViewState({
        mode: selectedViewProfileName ? "profile" : "local",
        path: selectedPath,
        collectionPath,
        localState: readLocalViewState({
          path: selectedPath,
          collectionPath,
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
    }, activeSnapshot.sidebarWidth ?? sidebarWidth);
    try {
      await saveViewProfile(name, profile);
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
        if (selectedPath) {
          const nextState = readLocalViewState({
            path: selectedPath,
            collectionPath,
            localStorage: window.localStorage,
          });
          writeLocalViewState({
            path: selectedPath,
            collectionPath,
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
    if (!selectedPath) return;
    if (mutateSelectedViewProfile((draft) => {
      draft.sidebarWidth = null;
      delete draft.collections[collectionConfigKey(selectedPath, collectionPath)];
      setSidebarWidth(defaultSidebarWidth);
    })) return;
    writeLocalViewState({
      path: selectedPath,
      collectionPath,
      state: emptyLocalViewState(),
      localStorage: window.localStorage,
    });
    setSidebarWidth(readSidebarWidth());
    bump((value) => value + 1);
  }

  function shouldInterceptPrimaryKeySync(currentDataDirty: boolean, force = false) {
    return Boolean(
      currentDataDirty
      && (force || detailOpen)
      && primaryKeySyncPlan
      && primaryKeySyncPlan.oldValue !== primaryKeySyncPlan.newValue
      && (primaryKeySyncPlan.rewrites.length > 0 || primaryKeySyncPlan.blockingIssues.length > 0),
    );
  }

  async function preparePrimaryKeySyncSnapshot(plan: PrimaryKeySyncPlan, currentModel: DocumentModel, currentPath: string) {
    const pendingSaves: PendingDocumentSave[] = [
      { path: currentPath, root: cloneDataRoot(currentModel.root) },
    ];
    const sourceRoots = new Map<string, unknown>();
    for (const sourceFile of plan.sourceFiles) {
      if (sourceFile === currentPath) continue;
      const documentModel = await loadDocument(sourceFile);
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

  async function handleSave() {
    if (!model || !selectedPath || saving) return;
    setSaving(true);
    setStatus("");
    try {
      const result = await saveDocument(selectedPath, model.root);
      savedDocumentRootRef.current = cloneDataRoot(model.root);
      setDataDirty(false);
      setStatus(`已保存，备份：${result.backupPath}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  async function persistChanges(forcePrimaryKeySync = false) {
    const currentModel = modelRef.current;
    const currentSelectedPath = selectedPathRef.current;
    const currentDataDirty = dataDirtyRef.current;
    const currentViewConfig = viewConfigRef.current;
    const currentViewConfigDirty = viewConfigDirtyRef.current;
    if ((!currentModel && !currentViewConfigDirty) || saving || closing || rebuilding) return;
    if (currentDataDirty && currentModel && currentSelectedPath && shouldInterceptPrimaryKeySync(currentDataDirty, forcePrimaryKeySync)) {
      if (primaryKeySyncPlan?.blockingIssues.length) {
        setStatus(formatPrimaryKeySyncBlockingIssues(primaryKeySyncPlan));
        return;
      }
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
    setSaving(true);
    setStatus("");
    try {
      let backupPath = "";
      if (currentDataDirty && currentModel && currentSelectedPath) {
        const result = await saveDocument(currentSelectedPath, currentModel.root);
        backupPath = result.backupPath;
        savedDocumentRootRef.current = cloneDataRoot(currentModel.root);
      }
      if (currentViewConfigDirty) await saveViewConfig(currentViewConfig);
      dataDirtyRef.current = false;
      viewConfigDirtyRef.current = false;
      setDataDirty(false);
      setViewConfigDirty(false);
      setStatus(backupPath ? `已保存，备份：${backupPath}` : "已保存项目视图配置。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  async function confirmPrimaryKeySyncSave() {
    const snapshot = primaryKeySyncSnapshotRef.current;
    const currentSelectedPath = selectedPathRef.current;
    if (!snapshot || !currentSelectedPath) return;
    setSaving(true);
    setStatus("");
    try {
      const result = await saveDocuments(snapshot.pendingSaves);
      setPrimaryKeySyncResult(result);
      if (!result.ok) {
        setStatus(formatPrimaryKeySyncSaveResult(result));
        return;
      }
      if (viewConfigDirtyRef.current) await saveViewConfig(viewConfigRef.current);
      savedDocumentRootRef.current = cloneDataRoot(snapshot.pendingSaves[0]?.root ?? null);
      dataDirtyRef.current = false;
      viewConfigDirtyRef.current = false;
      setDataDirty(false);
      setViewConfigDirty(false);
      setPrimaryKeySyncDialogOpen(false);
      primaryKeySyncSnapshotRef.current = null;
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
    if (dirty && !window.confirm("有未保存更改，关闭服务会丢失这些更改。是否继续关闭？")) return;
    setClosing(true);
    setStatus("");
    try {
      await flushPendingProfileSave();
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
    if (dirty && !window.confirm("有未保存更改，刷新构建会丢失这些更改。是否继续刷新构建？")) return;
    setRebuilding(true);
    setStatus("");
    try {
      await flushPendingProfileSave();
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
        <Sidebar files={files} selectedPath={selectedPath} collections={[]} selectedCollection="$" metadata={[]} onSelectFile={openFile} onSelectCollection={setCollectionPath} />
        <div className="sidebar-resize-handle" onPointerDown={beginSidebarResize} aria-label="调整左侧栏宽度" role="separator" />
        <section className="empty-state">{status || "Loading..."}</section>
      </main>
    );
  }

  return (
    <main className="app-frame" style={appFrameStyle}>
      <Sidebar
        files={files}
        selectedPath={selectedPath}
        collections={model.collections}
        selectedCollection={collectionPath}
        candidateCollections={candidateCollections}
        metadata={model.metadata ?? []}
        onSelectFile={openFile}
        onSelectCollection={(path) => { setCollectionPath(path); setSelectedRowIndex(0); setDetailOpen(false); }}
      />
      <div className="sidebar-resize-handle" onPointerDown={beginSidebarResize} aria-label="调整左侧栏宽度" role="separator" />
      <section className="workspace">
        <Toolbar
          currentPath={selectedPath}
          collectionPath={collectionPath}
          viewProfiles={viewProfiles}
          selectedViewProfileName={selectedViewProfileName}
          rowCount={rows.length}
          visibleCount={Math.min(filteredRows.length, 500)}
          query={query}
          dirty={dirty}
          saving={saving}
          closing={closing}
          rebuilding={rebuilding}
          status={statusText}
          hiddenFields={hiddenFields}
          onQueryChange={setQuery}
          onSave={persistChanges}
          onRefreshBuild={handleRefreshBuild}
          onCloseServer={handleCloseServer}
          onResetView={handleResetView}
          onSelectViewProfile={handleSelectViewProfile}
          onCreateViewProfile={() => setNewProfileOpen(true)}
          onUnhideField={handleUnhideField}
          onUnhideAllFields={handleUnhideAllFields}
        />
        <div className="main-content">
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
            sourcePath={selectedPath}
            collectionPath={collectionPath}
            fieldConfig={fieldConfig}
            fieldViewConfigs={fieldViewConfigs}
            backlinkColumns={backlinkColumns}
            backlinkValuesByRowIndex={backlinkValuesByRowIndex}
            relationOptions={relationOptions}
            relationConfigs={viewConfig.relations}
            revision={viewRevision}
            query={query}
            sort={sort}
            issues={issues}
            titleField={titleField}
            onSelectRow={selectRow}
            onOpenDetail={openDetail}
            onOpenBacklink={handleOpenBacklink}
            onEditCell={handleEditCell}
            onRenameMultiSelectOption={handleRenameMultiSelectOption}
            onDeleteMultiSelectOption={handleDeleteMultiSelectOption}
            onSetMultiSelectOptionColor={handleSetMultiSelectOptionColor}
            onRenameSelectOption={handleRenameSelectOption}
            onDeleteSelectOption={handleDeleteSelectOption}
            onSetSelectOptionColor={handleSetSelectOptionColor}
            onChangeFieldType={handleChangeFieldType}
            onHideField={handleHideField}
            onToggleWrapField={handleToggleWrapField}
            onResizeField={handleResizeField}
            onMoveField={handleMoveField}
            onReorderFields={handleReorderFields}
            onSort={handleSort}
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
            onRenameSelectOption={handleRenameSelectOption}
            onDeleteSelectOption={handleDeleteSelectOption}
            onSetSelectOptionColor={handleSetSelectOptionColor}
            onOpenBacklink={handleOpenBacklink}
            onRequestSyncSave={() => void persistChanges(true)}
            onOpenRelationTarget={handleOpenRelationTarget}
            onSelectRow={selectRow}
            onClose={() => setDetailOpen(false)}
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
                <Select.Icon />
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
                  <Select.Icon />
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
            <Dialog.Close className="ghost-button">??</Dialog.Close>
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
  model: DocumentModel | null,
  viewConfig: ViewConfig,
  mode: "local" | "profile",
  profile: UserViewProfile | null,
  extraFields: string[] = [],
): FieldConfig {
  const displayTypes: Record<string, FieldDisplayType> = {};
  const activeState = path
    ? readCollectionViewState({
      mode,
      path,
      collectionPath,
      localState: readLocalViewState({
        path,
        collectionPath,
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
  for (const field of fields) {
    for (const duplicate of validateUniqueTyped(rows, field)) {
      if (duplicate.rowIndex != null) result[`${duplicate.rowIndex}:${field}`] = duplicate;
    }
    rows.forEach((row, rowIndex) => {
      const required = validateRequiredTyped(row[field], field);
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

const sidebarWidthStorageKey = "data-editor:sidebar-width";
const selectedViewProfileStorageKey = "data-editor:selected-view-profile";
const transientStatusStorageKey = "data-editor:transient-status";
const localProfileOptionValue = "__local__";
const minSidebarWidth = 180;
const maxSidebarWidth = 520;
const defaultSidebarWidth = 260;

function readSidebarWidth() {
  const stored = Number(localStorage.getItem(sidebarWidthStorageKey));
  return clampSidebarWidth(Number.isFinite(stored) && stored > 0 ? stored : defaultSidebarWidth);
}

function rememberTransientStatus(message: string) {
  window.sessionStorage.setItem(transientStatusStorageKey, message);
}

function consumeTransientStatus() {
  return window.sessionStorage.getItem(transientStatusStorageKey) ?? "";
}

function clampSidebarWidth(width: number) {
  return Math.min(maxSidebarWidth, Math.max(minSidebarWidth, Math.round(width)));
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
  return { sidebarWidth: null, collections: {} };
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

function collectionConfigKey(path: string, collectionPath: string) {
  return `${path}:${collectionPath}`;
}

function ensureCollectionView(profile: UserViewProfile, path: string, collectionPath: string) {
  const key = collectionConfigKey(path, collectionPath);
  profile.collections[key] ??= { hidden: [], wrapped: [], order: [], detailOrder: [], widths: {} };
  return profile.collections[key];
}

function buildProfileFromCurrentView(path: string | null, collectionPath: string, fieldConfig: FieldConfig, sidebarWidth: number): UserViewProfile {
  if (!path) return { sidebarWidth, collections: {} };
  return {
    sidebarWidth,
    collections: {
      [collectionConfigKey(path, collectionPath)]: {
        hidden: [...fieldConfig.hidden],
        wrapped: [...fieldConfig.wrapped],
        order: [...fieldConfig.order],
        detailOrder: [...fieldConfig.detailOrder],
        widths: { ...fieldConfig.widths },
      },
    },
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
