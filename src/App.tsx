import { Profiler, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { flushSync } from "react-dom";
import * as Dialog from "@radix-ui/react-dialog";
import * as Popover from "@radix-ui/react-popover";
import * as Select from "@radix-ui/react-select";
import {
  checkEditorHealth,
  checkRecoveryBridgeHealth,
  activateProject,
  createProject,
  listFiles,
  listProjects,
  loadAutomationBindings,
  loadAutomationProfile,
  loadAutomationSkillCatalog,
  loadProjectCapabilities,
  loadSkillNodeContract,
  listViewProfiles,
  loadDocument,
  loadDocumentContent,
  loadDocumentIndex,
  loadViewConfig,
  loadSharedViews,
  loadViewProfile,
  recoverableRequestEventName,
  reopenEditor,
  rebuildFrontend,
  loadEntryActionResult,
  loadLatestEntryActionResult,
  loadEntryActionOutput,
  runEntryAction,
  ackStartEntryAction,
  saveDocument,
  saveDocuments,
  saveAutomationBindings,
  saveAutomationProfile,
  validateAutomationBindings,
  saveSharedViews,
  shutdownServer,
  saveViewConfig,
  saveViewProfile,
  updateProject,
  type DataFile,
  type DeviceEntryActionBindings,
  type EntryActionRunResult,
  type EntryActionBinding,
  type EntryActionRule,
  type EntryActionTarget,
  type ProjectDefinition,
  type SaveDocumentsResult,
  type CollectionView,
  type AutomationSkillCatalog,
  type AutomationSkillCatalogItem,
  type DocumentContentResponse,
  type DocumentIndexResponse,
  type FilterGroup,
  type FilterGroupNode,
  type FilterNode,
  type SharedViewIconId,
  type SharedViewGroupItem,
  type SharedViewLeafItem,
  type SharedViewsConfig,
  type SortRule,
  type SidebarTreePreferences,
  type UserViewLayoutState,
  type UserAutomationProfile,
  type UserViewProfile,
  type ViewConfig,
} from "./api/client";
import { Sidebar } from "./components/Sidebar";
import { SharedViewIconPicker } from "./components/SharedViewIconPicker";
import { Toolbar, type ToolbarSnapshot } from "./components/Toolbar";
import { ViewTabs, type ViewTabsSnapshot, type ViewTabReorderOperation } from "./components/ViewTabs";
import { ViewFilterBar, type ViewFilterBarSnapshot } from "./components/ViewFilterBar";
import type { CreateFilterOptionInput } from "./components/filters/MultiSelectFilterPopover";
import type { ActiveTextEditorHandle, ActiveTextEditorRegistrar } from "./editing";
import { RelationConfigDialog } from "./components/RelationConfigDialog";
import { SearchablePicker } from "./components/SearchablePicker";
import { DocumentFieldConfigDialog } from "./components/DocumentFieldConfigDialog";
import { PrimaryKeyCandidateBanner } from "./components/PrimaryKeyCandidateBanner";
import { collectProtectedIconPackIdsFromIcons, icons, isSharedViewIconPackLoaded, loadSharedViewIconPack, readSharedViewIconComponent, sharedViewDefaultIconId, sharedViewFallbackIcon } from "./components/icons";
import type { OptionFieldDraftCommit } from "./table/OptionFieldEditor";
import { DataTable, type FieldConfig, type TableFieldConfig, type TableSnapshot } from "./table/DataTable";
import { DetailPanel, type DetailEntryActionStatus, type DetailSnapshot } from "./detail/DetailPanel";
import { createSkillNodeContractEditorState, validateSkillNodeContractSaveToken } from "./detail/skill-node-contract-state";
import type { SkillNodeContractEditorState } from "./detail/skill-node-contract-state";
import { createSkillNodeContractFormModel } from "./detail/skill-node-contract-form-model";
import { validateSkillNodeDerivedRuleConflicts } from "./detail/skill-node-derived-rules.mjs";
import { EntryActionResultWaitCancelledError, waitForEntryActionResult as waitForEntryActionResultWithBackground, type WaitForEntryActionResultOutcome } from "./entry-action-result-wait";
import { shouldPreserveEntryActionFeedback, type EntryActionFeedbackSelection } from "./entry-action-feedback-context";
import { defaultAutomationRuntime } from "./automation-runtime.mjs";
import {
  automationRuleSelectionAfterRemoval,
  normalizeAutomationRuleSelection,
  normalizeVisibleAutomationRuleSelection,
} from "./automation-rule-selection.mjs";
import {
  pruneOrphanAutomationRuleBindings,
  remapAutomationRuleBindingKey,
  removeAutomationRuleBinding,
} from "./automation-rule-draft.mjs";
import { buildDetailSelectionState, resolveDetailSelectionSync } from "./detail/selection-state.mjs";
import { stabilizeViewResult } from "./view/stable-view-result.mjs";
import { buildStableViewEngineRows } from "./view/stable-view-engine-rows.mjs";
import type { DataRecord, DocumentModel } from "./model/documentModel";
import { addField, addRow, buildDocumentModel, deleteField, deleteRow, getMainColumns, getNestedFields, getRows, setCellValue } from "./model/documentModel";
import type { FieldDisplayType } from "./model/fieldTypes";
import { defaultTypeFor, isCompatible, resolveCompatibleDisplayType } from "./model/fieldTypes";
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
import { resolveAutoSuffixedPrimaryKeyValue } from "./model/primary-key-auto-suffix.mjs";
import { duplicateRowByRowId, reorderRowsByRowId } from "./model/writeback-adapter";
import { rowDigest } from "./row-digest.mjs";
import { resolveCanReorderRows } from "./table/row-reorder-policy.mjs";
import { analyzePrimaryKeyCandidates, buildCollectionKey, type FilteredPrimaryKeyCandidate, type PrimaryKeyCandidate, type PrimaryKeyCandidateAnalysis } from "./model/primaryKeyCandidate";
import { findTitleField, getRecordTitle } from "./model/titleField";
import type { ValidationIssue } from "./model/validation";
import type { BacklinkGridColumn } from "./model/backlinkGrid";
import type { BacklinkConfig, FieldViewConfig, MultiSelectOptionColor, MultiSelectOptionView, RealFieldType, RelationConfig } from "./model/viewConfig";
import { currentRelationsVersion, defaultBacklinkConfigs, defaultPrimaryKeys, defaultRelationConfigs } from "./relation-defaults.mjs";
import { normalizeFileOrder } from "./file-order.mjs";
import { recordWindowAutosaveDebugEvent } from "./autosave-debug.mjs";
import {
  buildSelectedDocumentFields,
  findPreferredActiveDocumentField,
  shouldOpenDetailDocumentPanel,
} from "./model/document-field-state.mjs";
import { buildDocumentFieldKey, parseDocumentFieldKey } from "./model/document-config.mjs";
import {
  buildOptionConfigFromOptions,
  removeMultiSelectOptionFromRows,
  removeSingleSelectOptionFromRows,
  renameMultiSelectOptionInRows,
  renameSingleSelectOptionInRows,
} from "./multiselect-config.mjs";
import {
  buildViewContextKey,
  buildScrollContextKey,
  readPageContextState,
  readProjectPageContext,
  updatePageContextQuery,
  updatePageContextViewGrouping,
  writePageContextState,
  updatePageContextScroll,
  updatePageContextSelection,
  type ProjectPageContextState,
} from "./page-context-storage";
import {
  clearSharedViewUrlLocation,
  readSharedViewUrlLocation,
  writeSharedViewUrlLocation,
} from "./shared-view-location.mjs";
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
  deleteLocalViewState,
  mutateProfileViewLayoutState,
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
import { deriveNewRowSeedValues } from "./view/new-row-seeding.mjs";
import { updateHeaderSorts } from "./view/sorting.mjs";
import { runView } from "./view/view-engine.mjs";
import {
  derivedFieldTypes,
  discoverProjectedFields,
  isDerivedField,
  projectDerivedFields,
} from "./view/derived-field-projection.mjs";
import type { ViewEngineRow, ViewInput, ViewResult } from "./view/contracts";
import { applyValidationIssueOverrides, buildIssueKey, buildValidationSnapshot, patchValidationSnapshotForField, patchValidationSnapshotForRowField } from "./validation/issue-map.mjs";
import type { ValidationFieldConfig as ValidationFieldConfigType, ValidationRuleConfig as ValidationRuleConfigType, ValidationSnapshot as ValidationSnapshotType } from "./validation/issue-map";
import { createSaveCoordinator, type AutosaveDomain, type AutosaveState } from "./save-coordinator";
import { buildDocumentStore, type CollectionStore, type DocumentStore, type TableRowView } from "./model/document-store";
import { addFieldByRowId, deleteRowByRowId, setCellValueByRowId } from "./model/writeback-adapter";
import { describeFileBasename, matchesFileSearchQuery } from "./searchable-picker-utils.mjs";
import { applySidebarTreePreferences, buildSidebarTree, buildSidebarTreePreferences, findSidebarFallbackFilePath } from "./sidebar-tree.mjs";
import {
  collectionConfigKey,
  createSharedViewConfig,
  deleteSharedViewConfig,
  hasViewDraft,
  mergeSharedViewWithDraft,
  renameSharedViewConfig,
  resetActiveSharedViewDraft,
  saveSharedViewDraftsToConfig,
  updateSharedViewConfig,
  updateSharedViewIconConfig,
} from "./view/view-state.mjs";
import {
  applyStructureDraftToConfig,
  createViewGroupConfig,
  createViewInGroupConfig,
  draftSharedViewStructure,
  duplicateViewGroupConfig,
  deleteViewGroupConfig,
  renameViewGroupConfig,
  resolveSharedViewStructure,
} from "./view/shared-view-structure.mjs";

type ServiceLifecycleState = "running" | "closed" | "recovering" | "disconnected" | "recoveredPendingReload" | "bridgeUnavailable";
type SharedViewDraftState = Pick<UserViewProfile, "lastActiveViews" | "viewDrafts" | "viewOrderDrafts" | "structureDrafts">;
type SharedViewUrlLocationState = {
  projectId: string | null;
  path: string | null;
  collectionPath: string | null;
  viewId: string | null;
};
type SharedViewUrlResolutionResult = {
  invalidProjectId: boolean;
  invalidPath: boolean;
  invalidCollectionPath: boolean;
  invalidViewId: boolean;
};
type ResolvedCollectionViewsState = {
  topLevelItems: Array<
    | SharedViewLeafItem
    | SharedViewGroupItem
  >;
  flattenedViews: CollectionView[];
  activeView: CollectionView | null;
  activeViewId: string | null;
  activeGroupId: string | null;
  expandedGroupId: string | null;
  viewsById: Record<string, CollectionView>;
  parentGroupIdByViewId: Record<string, string | null>;
  lastActiveViewIdByGroupId: Record<string, string>;
};

function collectProtectedSharedViewIconPackIds(topLevelItems: Array<SharedViewLeafItem | SharedViewGroupItem>) {
  return collectProtectedIconPackIdsFromIcons(
    topLevelItems.flatMap((item) => (
      item.kind === "view"
        ? [item.icon].filter((icon): icon is SharedViewIconId => !!icon)
        : [
          item.icon,
          ...item.views.map((viewItem) => viewItem.icon),
        ].filter((icon): icon is SharedViewIconId => !!icon)
    )),
  );
}
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
const entryActionDismissedRunStorageKeyPrefix = "data-editor:entry-action-dismissed-run";
const emptyFilterGroup: FilterGroup = { topLevelRules: [], advancedRoot: null };
const emptySortRules: SortRule[] = [];
const buildDocumentStoreTyped = buildDocumentStore as (input: {
  documentId: string;
  model: DocumentModel;
  previousStore?: DocumentStore | null;
  collectionIdentityOverrides?: Map<string, string[]> | null;
}) => DocumentStore;
const resolveCanReorderRowsTyped = resolveCanReorderRows as unknown as (input: {
  model: DocumentModel | null;
  collectionPath: string;
  query: string;
  filters: FilterGroup;
  sorts: SortRule[];
  commandSaving: boolean;
  closing: boolean;
  rebuilding: boolean;
  restarting: boolean;
}) => boolean;
const duplicateRowByRowIdTyped = duplicateRowByRowId as (input: {
  documentId?: string;
  model: DocumentModel;
  store: DocumentStore;
  collectionPath: string;
  rowId: string;
  primaryKeyField?: string | null;
}) => { rowId: string; sourceIndex: number; sourceKey: string | null };
const runViewTyped = runView as (input: ViewInput) => ViewResult;
const sidebarTreePrefsStorageKey = "data-editor:__sidebar-tree-prefs";
type AutomationModelOption = { value: string; label: string };
type DeviceEntryActionBindingStatus = NonNullable<DeviceEntryActionBindings["bindingStatuses"]>[string];
type EntryActionDismissalIdentity = {
  actionId: string;
  projectId: string;
  sourcePath: string;
  collectionPath: string;
  rowId: string | null;
  sourceRowIndex: number | null;
};
const automationRuntimeInheritValue = "__inherit__";
const automationModelOptions: AutomationModelOption[] = [
  { value: "gpt-5.5", label: "5.5" },
  { value: "gpt-5.6-sol", label: "5.6 Sol" },
  { value: "gpt-5.6-terra", label: "5.6 Terra" },
  { value: "gpt-5.6-luna", label: "5.6 Luna" },
  { value: "gpt-5.4", label: "5.4" },
  { value: "gpt-5.4-mini", label: "5.4 Mini" },
  { value: "gpt-5.3-codex-spark", label: "5.3 Codex Spark" },
];

function entryActionDismissalStorageKey(identity: EntryActionDismissalIdentity) {
  const rowIdentity = identity.rowId ? `id:${identity.rowId}` : `index:${identity.sourceRowIndex ?? ""}`;
  return `${entryActionDismissedRunStorageKeyPrefix}:${encodeURIComponent([
    identity.projectId,
    identity.actionId,
    identity.sourcePath,
    identity.collectionPath,
    rowIdentity,
  ].join("|"))}`;
}

function isEntryActionRunDismissed(identity: EntryActionDismissalIdentity, runId: string) {
  try {
    return window.localStorage.getItem(entryActionDismissalStorageKey(identity)) === runId;
  } catch {
    return false;
  }
}

function dismissEntryActionRun(identity: EntryActionDismissalIdentity, runId: string) {
  try {
    window.localStorage.setItem(entryActionDismissalStorageKey(identity), runId);
  } catch {
    // Dismissal remains local to the current page when storage is unavailable.
  }
}

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

function emptySharedViewUrlResolutionResult(): SharedViewUrlResolutionResult {
  return {
    invalidProjectId: false,
    invalidPath: false,
    invalidCollectionPath: false,
    invalidViewId: false,
  };
}

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
  const viewIds: string[] = [];
  for (const item of collection?.items ?? []) {
    if (item.kind === "group") {
      for (const view of item.views) viewIds.push(view.view.id);
      continue;
    }
    viewIds.push(item.view.id);
  }
  return [
    "all",
    collection?.defaultViewId ?? "",
    ...viewIds,
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
      if (parts.at(-1) === "__detail-order" && parts.length >= 2) {
        const collectionPath = parts.slice(0, -1).join(":");
        if (collectionPath) addUniqueRecordValue(context.collectionPathsByFile, migration.oldPath, collectionPath);
      }
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

type PendingNestedOpenTarget = {
  rowId: string | null;
  sourceRowIndex: number | null;
  fieldName: string;
  requestKey: number;
};

export function App() {
  const [files, setFiles] = useState<DataFile[]>([]);
  const [projects, setProjects] = useState<ProjectDefinition[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false);
  const [automationSettingsOpen, setAutomationSettingsOpen] = useState(false);
  const [addProjectOpen, setAddProjectOpen] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [model, setModel] = useState<DocumentModel | null>(null);
  const [skillNodeContractEditorState, setSkillNodeContractEditorState] = useState<SkillNodeContractEditorState>(() => (
    createSkillNodeContractEditorState({ status: "loading" })
  ));
  const [collectionPath, setCollectionPath] = useState("$");
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);
  const [selectedRowIdState, setSelectedRowIdState] = useState<string | null>(null);
  const [dataDirty, setDataDirty] = useState(false);
  const [viewConfigDirty, setViewConfigDirty] = useState(false);
  const [profileDirty, setProfileDirty] = useState(false);
  const [viewDraftDirty, setViewDraftDirty] = useState(false);
  const [toolbarQueryOverride, setToolbarQueryOverride] = useState<string | null>(null);
  const [commandSaving, setCommandSaving] = useState(false);
  const [entryActionRunningId, setEntryActionRunningId] = useState<string | null>(null);
  const [entryActionErrorMessage, setEntryActionErrorMessage] = useState<string | null>(null);
  const [entryActionStatus, setEntryActionStatus] = useState<DetailEntryActionStatus | null>(null);
  const entryActionWatchIdRef = useRef(0);
  const [automationProfileState, setAutomationProfileState] = useState<UserAutomationProfile>({ rules: [] });
  const [automationBindingsState, setAutomationBindingsState] = useState<DeviceEntryActionBindings>({ defaults: {}, bindings: {} });
  const [autosaveState, setAutosaveState] = useState<AutosaveState>("idle");
  const [closing, setClosing] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [restarting, setRestarting] = useState(false);
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
  const [documentIndex, setDocumentIndex] = useState<DocumentIndexResponse>({ docRoot: null, entries: {} });
  const [documentIndexError, setDocumentIndexError] = useState<string | null>(null);
  const [activeDocumentFieldName, setActiveDocumentFieldName] = useState<string | null>(null);
  const [documentContent, setDocumentContent] = useState<DocumentContentResponse | null>(null);
  const [documentContentLoading, setDocumentContentLoading] = useState(false);
  const [documentContentError, setDocumentContentError] = useState<string | null>(null);
  const [addFieldOpen, setAddFieldOpen] = useState(false);
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldType, setNewFieldType] = useState<FieldDisplayType>("Text");
  const [newFieldApplyAll, setNewFieldApplyAll] = useState(false);
  const [pendingDeleteRow, setPendingDeleteRow] = useState<number | null>(null);
  const [pendingDeleteRowId, setPendingDeleteRowId] = useState<string | null>(null);
  const [pendingDeleteField, setPendingDeleteField] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [pendingNestedOpen, setPendingNestedOpen] = useState<PendingNestedOpenTarget | null>(null);
  const [filterBarVisible, setFilterBarVisible] = useState(true);
  const [tableTextEditMode, setTableTextEditMode] = useState(false);
  const enableTableTextEditMode = useCallback(() => {
    setTableTextEditMode((current) => current ? current : true);
  }, []);
  const [pendingOpenFilterRuleId, setPendingOpenFilterRuleId] = useState<string | null>(null);
  const [uiRevision, bumpUiRevision] = useState(0);
  const [layoutRevision, bumpLayoutRevision] = useState(0);
  const [tableRevision, bumpTableRevision] = useState(0);
  const [, setSharedViewIconPackVersion] = useState(0);
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
  const [sharedViewDirectSavePending, setSharedViewDirectSavePending] = useState(false);
  const [newProfileOpen, setNewProfileOpen] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const [relationConfigField, setRelationConfigField] = useState<string | null>(null);
  const [documentConfigField, setDocumentConfigField] = useState<string | null>(null);
  const [dismissedCandidateKeys, setDismissedCandidateKeys] = useState<string[]>([]);
  const [primaryKeyCandidateDialogOpen, setPrimaryKeyCandidateDialogOpen] = useState(false);
  const [selectedPrimaryKeyCandidate, setSelectedPrimaryKeyCandidate] = useState<string>("");
  const openRequestRef = useRef(0);
  const maintenanceRequestRef = useRef(0);
  const filesRef = useRef<DataFile[]>([]);
  const activeProjectIdRef = useRef<string | null>(null);
  const modelRef = useRef<DocumentModel | null>(null);
  const skillNodeContractEditorStateRef = useRef<SkillNodeContractEditorState>(skillNodeContractEditorState);
  const savedDocumentRootRef = useRef<unknown | null>(null);
  const selectedPathRef = useRef<string | null>(null);
  const pendingSharedViewUrlLocationRef = useRef<SharedViewUrlLocationState | null>(
    typeof window === "undefined" ? null : readSharedViewUrlLocation(window.location),
  );
  const sharedViewUrlResolutionRef = useRef<SharedViewUrlResolutionResult>(emptySharedViewUrlResolutionResult());
  const collectionPathRef = useRef("$");
  const selectedRowIdRef = useRef<string | null>(null);
  const selectedSourceRowIndexRef = useRef<number | null>(null);
  const titleFieldRef = useRef<string | null>(null);
  const dataDirtyRef = useRef(false);
  const viewConfigRef = useRef<ViewConfig>(emptyProjectViewConfig());
  const sharedViewDirectSaveRetryRef = useRef<null | (() => Promise<void>)>(null);
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
  const sharedViewsConfigRef = useRef<SharedViewsConfig>(emptySharedViewsConfig());
  const sharedViewDirectSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
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
  const [detailDocumentPanelOpen, setDetailDocumentPanelOpen] = useState(() => readDetailDocumentPanelOpen());
  const [detailDocumentPanelWidth, setDetailDocumentPanelWidth] = useState(() => readDetailDocumentPanelWidth());
  const [validationIssueOverrides, setValidationIssueOverrides] = useState<Record<string, ValidationIssue | null>>({});
  const primaryKeySyncSnapshotRef = useRef<PrimaryKeySyncSaveSnapshot | null>(null);
  const primaryKeySyncPlanRef = useRef<PrimaryKeySyncPlan | null>(null);
  const autosaveStateRef = useRef<AutosaveState>("idle");
  const autosaveInFlightRef = useRef(false);
  const commandSavingRef = useRef(false);
  const activeTextEditorRef = useRef<ActiveTextEditorHandle | null>(null);
  const closingRef = useRef(false);
  const rebuildingRef = useRef(false);
  const restartingRef = useRef(false);
  const profileSavePromiseRef = useRef<Promise<void> | null>(null);
  const loadedProjectIdRef = useRef<string | null>(null);
  const viewDraftDirtyRef = useRef(false);
  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? null,
    [projects, activeProjectId],
  );
  const activeSkillNodeContractEditorState = useMemo(() => {
    if (!isFormalSkillsDocumentPath(selectedPath) || !model || !skillNodeContractEditorState.canEdit) {
      return skillNodeContractEditorState;
    }
    const rootVersion = readSkillNodeContractVersion(model.root);
    if (rootVersion === skillNodeContractEditorState.version) return skillNodeContractEditorState;
    return createSkillNodeContractEditorState({
      status: "version_mismatch",
      error: {
        code: "SKILL_NODE_CONTRACT_DOCUMENT_VERSION_MISMATCH",
        message: `技能文档合同版本 ${String(rootVersion ?? "缺失")} 与项目合同版本 ${String(skillNodeContractEditorState.version)} 不一致，节点只读且禁止保存。`,
      },
    });
  }, [model, selectedPath, skillNodeContractEditorState]);
  const skillNodeContractFormModel = useMemo(
    () => createSkillNodeContractFormModel(activeSkillNodeContractEditorState),
    [activeSkillNodeContractEditorState],
  );
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
  useEffect(() => {
    sharedViewsConfigRef.current = sharedViewsConfig;
  }, [sharedViewsConfig]);

  function commitSharedViewsConfig(nextConfig: SharedViewsConfig) {
    sharedViewsConfigRef.current = nextConfig;
    setSharedViewsConfig(nextConfig);
  }
  const saveCoordinator = useMemo(
    () => createSaveCoordinator({
      delayMs: 800,
      getSnapshot: () => ({
        dirtyDomains: collectAutosaveDirtyDomains(),
      }),
      flush: async (reason, snapshot) => flushAutosaveTargets(reason, snapshot.dirtyDomains),
      onStatusChange: (nextState, details) => {
        setAutosaveState(nextState);
        recordWindowAutosaveDebugEvent({
          kind: "state",
          state: nextState,
          dirtyDomains: details.dirtyDomains,
          errorMessage: details.errorMessage ?? undefined,
        });
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
  useEffect(() => {
    skillNodeContractEditorStateRef.current = skillNodeContractEditorState;
  }, [skillNodeContractEditorState]);
  useEffect(() => { filesRef.current = files; }, [files]);
  useEffect(() => {
    setValidationIssueOverrides({});
  }, [selectedPath, collectionPath]);
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
  useEffect(() => { restartingRef.current = restarting; }, [restarting]);
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

  function finalizePendingSharedViewUrlResolution(options: { rewriteToCurrent?: boolean; resolvedViewId?: string | null } = {}) {
    if (typeof window === "undefined") return;
    const pending = pendingSharedViewUrlLocationRef.current;
    if (!pending) return;
    const resolution = sharedViewUrlResolutionRef.current;
    const shouldRewrite = options.rewriteToCurrent
      || resolution.invalidProjectId
      || resolution.invalidPath
      || resolution.invalidCollectionPath
      || resolution.invalidViewId;
    if (shouldRewrite) {
      const url = new URL(window.location.href);
      if (activeProjectIdRef.current && selectedPathRef.current) {
        writeSharedViewUrlLocation(url, {
          projectId: activeProjectIdRef.current,
          path: selectedPathRef.current,
          collectionPath: collectionPathRef.current,
          viewId: options.resolvedViewId ?? null,
        });
      } else {
        clearSharedViewUrlLocation(url);
      }
      window.history.replaceState(null, "", url.toString());
    }
    pendingSharedViewUrlLocationRef.current = null;
    sharedViewUrlResolutionRef.current = emptySharedViewUrlResolutionResult();
  }

  useEffect(() => {
    listProjects()
      .then(async (registry) => {
        setProjects(registry.projects);
        const pending = pendingSharedViewUrlLocationRef.current;
        const hasUrlProject = Boolean(
          pending?.projectId
          && registry.projects.some((project) => project.id === pending.projectId),
        );
        if (pending?.projectId && !hasUrlProject) {
          sharedViewUrlResolutionRef.current.invalidProjectId = true;
        }
        const nextProjectId = hasUrlProject ? pending?.projectId ?? null : registry.activeProjectId;
        if (hasUrlProject && nextProjectId && nextProjectId !== registry.activeProjectId) {
          await activateProject(nextProjectId);
        }
        setActiveProjectId(nextProjectId);
      })
      .catch((error) => setStatus(error.message));
  }, []);

  useEffect(() => {
    if (!activeProjectId) return;
    const resetProfile = loadedProjectIdRef.current !== null && loadedProjectIdRef.current !== activeProjectId;
    void reloadProjectWorkspace(activeProjectId, { resetProfile });
  }, [activeProjectId]);

  useEffect(() => {
    if (!activeProjectId) {
      setSkillNodeContractEditorState(createSkillNodeContractEditorState({ status: "loading" }));
      return;
    }
    let cancelled = false;
    setSkillNodeContractEditorState(createSkillNodeContractEditorState({ status: "loading" }));
    loadProjectCapabilities(activeProjectId)
      .then((capabilities) => {
        const hasSkillContractBinding = capabilities.status === "active"
          && capabilities.bindings.documentContracts.some((binding) => (
            binding.match.dataSourceId === "data"
            && binding.match.path === "content/skills.json"
            && binding.match.collection === "skills"
          ));
        if (!hasSkillContractBinding) return null;
        return loadSkillNodeContract(activeProjectId);
      })
      .then((loaded) => {
        if (cancelled) return;
        if (!loaded) {
          setSkillNodeContractEditorState(createSkillNodeContractEditorState({ status: "error" }));
          return;
        }
        setSkillNodeContractEditorState(createSkillNodeContractEditorState({
          status: "ready",
          contract: loaded.contract,
          version: loaded.version,
          etag: loaded.etag,
        }));
      })
      .catch((error) => {
        if (cancelled) return;
        const status: SkillNodeContractEditorState["status"] = error && typeof error === "object"
          && "code" in error && error.code === "SKILL_NODE_CONTRACT_VERSION_UNSUPPORTED"
          ? "version_mismatch"
          : "error";
        setSkillNodeContractEditorState(createSkillNodeContractEditorState({ status, error }));
      });
    return () => {
      cancelled = true;
    };
  }, [activeProjectId]);

  useEffect(() => {
    if (!activeProject) {
      setAutomationProfileState({ rules: [] });
      setAutomationBindingsState({ defaults: {}, bindings: {} });
      return;
    }
    let cancelled = false;
    Promise.all([
      loadAutomationProfile(activeProject.id),
      loadAutomationBindings(activeProject.id),
    ])
      .then(([profile, bindings]) => {
        if (cancelled) return;
        setAutomationProfileState(profile);
        setAutomationBindingsState(bindings);
      })
      .catch((error) => {
        if (cancelled) return;
        setAutomationProfileState({ rules: [] });
        setAutomationBindingsState({ defaults: {}, bindings: {} });
        setStatus(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (cancelled) return;
      });
    return () => {
      cancelled = true;
    };
  }, [activeProject]);

  useEffect(() => {
    if (!selectedViewProfileName) {
      setSelectedViewProfile(emptyUserViewProfile());
      localStorage.removeItem(selectedViewProfileStorageKey);
      setSidebarWidth(readSidebarWidth());
      setDetailPanelWidth(readDetailPanelWidth());
      setDetailDocumentPanelOpen(readDetailDocumentPanelOpen());
      setDetailDocumentPanelWidth(readDetailDocumentPanelWidth());
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
        setDetailDocumentPanelOpen(normalizedProfile.detailDocumentPanelOpen ?? false);
        setDetailDocumentPanelWidth(clampDetailDocumentPanelWidth(normalizedProfile.detailDocumentPanelWidth ?? defaultDetailDocumentPanelWidth));
      })
      .catch((error) => setStatus(error.message));
  }, [selectedViewProfileName, activeProjectId]);

  useEffect(() => {
    if (!selectedPath || !viewConfig.documentFiles[selectedPath]?.docRoot) {
      setDocumentIndex({ docRoot: null, entries: {} });
      setDocumentIndexError(null);
      return;
    }
    let cancelled = false;
    setDocumentIndexError(null);
    loadDocumentIndex(selectedPath, activeProjectId)
      .then((response) => {
        if (cancelled) return;
        setDocumentIndex(response);
      })
      .catch((error) => {
        if (cancelled) return;
        setDocumentIndex({ docRoot: viewConfig.documentFiles[selectedPath]?.docRoot ?? null, entries: {} });
        setDocumentIndexError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPath, activeProjectId, viewConfig.documentFiles]);

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
      commitSharedViewsConfig(migratedSharedViewsConfig);
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
        setDetailDocumentPanelOpen(normalizedProfile.detailDocumentPanelOpen ?? false);
        setDetailDocumentPanelWidth(clampDetailDocumentPanelWidth(normalizedProfile.detailDocumentPanelWidth ?? defaultDetailDocumentPanelWidth));
      } else if (!profileNameForInitialOrder) {
        setUiPreferences(readLocalUiPreferences(window.localStorage));
        setDetailDocumentPanelOpen(readDetailDocumentPanelOpen());
        setDetailDocumentPanelWidth(readDetailDocumentPanelWidth());
      }
      const sidebarTree = buildResolvedSidebarTree(nextFiles, profileNameForInitialOrder, normalizedInitialProfile, window.localStorage);
      const pendingUrlLocation = pendingSharedViewUrlLocationRef.current;
      const urlPathCandidate = pendingUrlLocation?.projectId && pendingUrlLocation.projectId !== projectId
        ? null
        : pendingUrlLocation?.path ?? null;
      const validUrlPath = urlPathCandidate && nextFiles.some((file) => file.path === urlPathCandidate)
        ? urlPathCandidate
        : null;
      if (urlPathCandidate && !validUrlPath) {
        sharedViewUrlResolutionRef.current.invalidPath = true;
      }
      const preferredPath = findSidebarFallbackFilePath(
        sidebarTree,
        validUrlPath ?? currentPageContext.selectedPath ?? selectedPathRef.current,
      );
      loadedProjectIdRef.current = projectId;
      if (preferredPath) {
        const targetCollection = preferredPath === validUrlPath
          ? (pendingUrlLocation?.collectionPath ?? "$")
          : preferredPath === currentPageContext.selectedPath
            ? currentPageContext.collectionPath
            : undefined;
        const opened = await openDocumentAt(preferredPath, targetCollection, undefined, false, projectId);
        if (
          pendingUrlLocation
          && preferredPath === validUrlPath
          && opened
          && opened.collectionPath !== (pendingUrlLocation.collectionPath ?? "$")
        ) {
          sharedViewUrlResolutionRef.current.invalidCollectionPath = true;
        }
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
    clearEntryActionFeedback();
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
    commitSharedViewsConfig(emptySharedViewsConfig());
    setLocalSharedViewDrafts(readLocalSharedViewDrafts(window.localStorage));
    setViewProfiles([]);
    if (options.resetProfile) {
      setSelectedViewProfileName(null);
      selectedViewProfileNameRef.current = null;
      setSelectedViewProfile(emptyUserViewProfile());
      selectedViewProfileRef.current = emptyUserViewProfile();
      setUiPreferences(readLocalUiPreferences(window.localStorage));
      setDetailDocumentPanelOpen(readDetailDocumentPanelOpen());
      setDetailDocumentPanelWidth(readDetailDocumentPanelWidth());
    }
    setDocumentIndex({ docRoot: null, entries: {} });
    setDocumentIndexError(null);
    setActiveDocumentFieldName(null);
    setDocumentContent(null);
    setDocumentContentLoading(false);
    setDocumentContentError(null);
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
      await createProject({ name: input.name, root: input.root });
      const registry = await listProjects();
      setProjects(registry.projects);
      setActiveProjectId(registry.activeProjectId);
      setAddProjectOpen(false);
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
    if (!selectedPath || !model) {
      setRelationIndexes({});
      setRelationOptions({});
      return;
    }
    if (deferRelationWarmupRef.current) {
      deferRelationWarmupRef.current = false;
      scheduleDeferredTask(relationWarmupHandleRef, () => {
        void loadRelationIndexes(viewConfig);
      });
      return;
    }
    void loadRelationIndexes(viewConfig);
  }, [viewConfig.relations, selectedPath, collectionPath, model, activeProjectId, tableRevision]);

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

  async function waitForEditorHealthState(target: "up" | "down", timeoutMs: number, pollMs: number) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      try {
        const health = await checkEditorHealth();
        if (Number.isInteger(Number(health.bridgePort)) && Number(health.bridgePort) > 0) {
          setBridgePort(Number(health.bridgePort));
        }
        if (target === "up") return true;
      } catch {
        if (target === "down") return true;
      }
      await new Promise((resolve) => window.setTimeout(resolve, pollMs));
    }
    return false;
  }

  async function recoverEditorService(port: number, options: { expectShutdownFirst?: boolean; timeoutMs?: number } = {}) {
    const {
      expectShutdownFirst = false,
      timeoutMs = 15000,
    } = options;
    const canUseHealthRecovery = expectShutdownFirst
      ? await waitForEditorHealthState("down", 5000, 150)
      : true;
    const recoveryCandidates: Promise<unknown>[] = [reopenEditor(port)];
    if (canUseHealthRecovery) {
      recoveryCandidates.push((async () => {
        const recovered = await waitForEditorHealthState("up", timeoutMs, 250);
        if (!recovered) throw new Error("Timed out waiting for editor service to recover.");
      })());
    }
    await Promise.race([
      Promise.any(recoveryCandidates),
      new Promise<never>((_, reject) => {
        window.setTimeout(() => reject(new Error("Timed out waiting for editor service to recover.")), timeoutMs);
      }),
    ]);
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
    preserveEntryActionFeedback = false,
  ): Promise<{ path: string; collectionPath: string; rowId: string | null } | null> {
    const requestId = openRequestRef.current + 1;
    openRequestRef.current = requestId;
    selectedPathRef.current = path;
    if (!preserveEntryActionFeedback) clearEntryActionFeedback();
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
      return null;
    }
    if (requestId !== openRequestRef.current) return null;
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
    return { path, collectionPath: nextCollection, rowId: nextSelectedRowId };
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
      sourceFilePath: selectedPath,
      sourceCollectionPath: collectionPath,
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
  const projectPageContext = useMemo(
    () => readProjectPageContext(readPageContextState(window.localStorage), activeProjectId),
    [activeProjectId, activeCollectionKey, sharedViewsConfig, draftSource],
  );
  const pendingPreferredViewId = useMemo(() => {
    const pending = pendingSharedViewUrlLocationRef.current;
    if (!pending || !activeProjectId || !selectedPath) return null;
    if (pending.projectId && pending.projectId !== activeProjectId) return null;
    if (pending.path && pending.path !== selectedPath) return null;
    if ((pending.collectionPath ?? "$") !== collectionPath) return null;
    return pending.viewId ?? null;
  }, [activeProjectId, selectedPath, collectionPath]);
  const resolvedCollectionViews = useMemo<ResolvedCollectionViewsState>(
    () => activeCollectionKey
      ? resolveSharedViewStructure({
        sharedViewsConfig,
        collectionKey: activeCollectionKey,
        draftState: draftSource,
        pageContext: projectPageContext,
        preferredViewId: pendingPreferredViewId,
      }) as ResolvedCollectionViewsState
      : {
        topLevelItems: [],
        flattenedViews: [],
        activeView: null,
        activeViewId: null,
        activeGroupId: null,
        expandedGroupId: null,
        viewsById: {},
        parentGroupIdByViewId: {},
        lastActiveViewIdByGroupId: {},
      },
    [activeCollectionKey, sharedViewsConfig, draftSource, projectPageContext, pendingPreferredViewId],
  );
  const collectionSharedViews = useMemo(
    () => activeCollectionKey ? resolvedCollectionViews.flattenedViews : [],
    [resolvedCollectionViews, activeCollectionKey],
  );
  const orderedCollectionViews = useMemo(
    () => collectionSharedViews,
    [collectionSharedViews],
  );
  const activeSharedView = useMemo(
    () => resolvedCollectionViews.activeView,
    [resolvedCollectionViews],
  );
  const activeView = useMemo(
    () => activeCollectionKey && activeSharedView
      ? mergeSharedViewWithDraft(activeSharedView, draftSource.viewDrafts?.[activeCollectionKey]?.[activeSharedView.id]) as CollectionView
      : null,
    [activeCollectionKey, activeSharedView, draftSource],
  );
  const activeViewContextKey = useMemo(
    () => buildViewContextKey(selectedPath, collectionPath, activeSharedView?.id ?? null),
    [selectedPath, collectionPath, activeSharedView?.id],
  );
  useEffect(() => {
    if (!activeViewContextKey) {
      setToolbarQueryOverride(null);
      return;
    }
    const persistedQuery = Object.hasOwn(projectPageContext.queryByView, activeViewContextKey)
      ? projectPageContext.queryByView[activeViewContextKey]
      : null;
    setToolbarQueryOverride(persistedQuery);
  }, [activeViewContextKey, projectPageContext.queryByView]);
  const previousVisibleRowViewsRef = useRef<TableRowView[] | null>(null);
  const previousViewResultRef = useRef<ViewResult | null>(null);
  const previousViewEngineRowsRef = useRef<ViewEngineRow[] | null>(null);
  const stableActiveViewRenderStateRef = useRef<{ query: string; filters: FilterGroup; sorts: SortRule[] } | null>(null);
  const activeToolbarQuery = toolbarQueryOverride ?? (activeView?.query ?? "");
  const activeViewLayoutId = activeSharedView?.id ?? null;
  useEffect(() => {
    const pending = pendingSharedViewUrlLocationRef.current;
    if (!pending || !activeProjectId || !selectedPath) return;
    if (pending.projectId && pending.projectId !== activeProjectId) return;
    if (pending.path && pending.path !== selectedPath && !sharedViewUrlResolutionRef.current.invalidPath) return;
    if (pending.viewId) {
      if ((pending.collectionPath ?? "$") !== collectionPath && !sharedViewUrlResolutionRef.current.invalidCollectionPath) return;
      if (sharedViewUrlResolutionRef.current.invalidPath || sharedViewUrlResolutionRef.current.invalidCollectionPath) {
        finalizePendingSharedViewUrlResolution({ rewriteToCurrent: true, resolvedViewId: activeViewLayoutId });
        return;
      }
      if (!activeCollectionKey) return;
      if (resolvedCollectionViews.viewsById[pending.viewId]) {
        const parentGroupId = resolvedCollectionViews.parentGroupIdByViewId?.[pending.viewId] ?? null;
        const currentDraftState = currentSharedViewDraftState();
        if (currentDraftState.lastActiveViews?.[activeCollectionKey] !== pending.viewId) {
          updateSharedViewDraftState({
            lastActiveViews: { ...currentDraftState.lastActiveViews, [activeCollectionKey]: pending.viewId },
            viewDrafts: { ...currentDraftState.viewDrafts },
            viewOrderDrafts: { ...currentDraftState.viewOrderDrafts },
            structureDrafts: { ...currentDraftState.structureDrafts },
          });
        }
        updatePageContextViewGrouping(window.localStorage, activeProjectId, {
          expandedGroupId: parentGroupId,
          lastActiveViewIdByGroupId: parentGroupId
            ? { ...projectPageContext.lastActiveViewIdByGroupId, [parentGroupId]: pending.viewId }
            : { ...projectPageContext.lastActiveViewIdByGroupId },
        });
        finalizePendingSharedViewUrlResolution({ resolvedViewId: pending.viewId });
        return;
      }
      sharedViewUrlResolutionRef.current.invalidViewId = true;
    }
    finalizePendingSharedViewUrlResolution({ rewriteToCurrent: true, resolvedViewId: activeViewLayoutId });
  }, [activeProjectId, activeCollectionKey, activeViewLayoutId, collectionPath, projectPageContext.lastActiveViewIdByGroupId, resolvedCollectionViews.parentGroupIdByViewId, resolvedCollectionViews.viewsById, selectedPath]);
  const activeViewHasFilters = Boolean(
    (activeView?.filters?.topLevelRules?.length ?? 0) > 0
    || activeView?.filters?.advancedRoot,
  );
  const activeViewSort = activeView?.sorts?.[0] ?? null;
  const activeViewRenderState = useMemo(() => {
    const nextState = {
      query: activeToolbarQuery,
      filters: activeView?.filters ?? emptyFilterGroup,
      sorts: activeView?.sorts ?? emptySortRules,
    };
    const previous = stableActiveViewRenderStateRef.current;
    if (
      previous
      && previous.query === nextState.query
      && sameViewFilters(previous.filters, nextState.filters)
      && sameSortRules(previous.sorts, nextState.sorts)
    ) {
      return previous;
    }
    stableActiveViewRenderStateRef.current = nextState;
    return nextState;
  }, [activeToolbarQuery, activeView?.filters, activeView?.sorts]);
  const canReorderRows = useMemo(() => resolveCanReorderRowsTyped({
    model,
    collectionPath,
    query: activeViewRenderState.query,
    filters: activeViewRenderState.filters,
    sorts: activeViewRenderState.sorts,
    commandSaving,
    closing,
    rebuilding,
    restarting,
  }), [
    model,
    collectionPath,
    activeViewRenderState,
    commandSaving,
    closing,
    rebuilding,
    restarting,
  ]);
  const dirtyViewIds = useMemo(() => {
    if (!activeCollectionKey) return new Set<string>();
    return new Set(Object.keys(draftSource.viewDrafts?.[activeCollectionKey] ?? {}));
  }, [draftSource, activeCollectionKey]);
  const activeViewDirty = Boolean(
    activeCollectionKey
    && activeSharedView
    && draftSource.viewDrafts?.[activeCollectionKey]?.[activeSharedView.id],
  );
  const viewOrderDirty = Boolean(
    activeCollectionKey
    && (
      draftSource.viewOrderDrafts?.[activeCollectionKey]?.length
      || draftSource.structureDrafts?.[activeCollectionKey]?.items?.length
    ),
  );
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
    () => model ? discoverProjectedFields(
      getOrderedFields(model, collectionPath, tableFieldConfig.order, backlinkColumns.map((column) => column.fieldName)),
      { sourcePath: selectedPath, collectionPath },
    ) : [],
    [model, selectedPath, collectionPath, tableFieldConfig.order, backlinkColumns],
  );
  const projectedRows = useMemo(
    () => rows.map((row) => projectDerivedFields(row, { sourcePath: selectedPath, collectionPath })),
    [rows, selectedPath, collectionPath],
  );
  const fieldViewConfigs = useMemo(
    () => model ? buildFieldViewConfigs(selectedPath, collectionPath, model, viewConfig) : {},
    [selectedPath, collectionPath, model, viewConfig],
  );
  const viewFilterFieldTypes = useMemo(
    () => Object.fromEntries(allFields.map((field) => [
      field,
      derivedFieldTypes[field as keyof typeof derivedFieldTypes] ?? (selectedPath && viewConfig.relations[buildRelationKey({ sourceFile: selectedPath, sourceCollection: collectionPath, fieldPath: [field] })]
        ? "Relation"
        : inferViewFilterFieldType(field, projectedRows, tableFieldConfig.displayTypes)),
    ])) as Record<string, FieldDisplayType>,
    [allFields, projectedRows, tableFieldConfig.displayTypes, selectedPath, collectionPath, viewConfig.relations],
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
          options[field] = buildValueFilterOptions(field, projectedRows, fieldViewConfigs[field], fieldType);
        }
      }
      return options;
    },
    [allFields, selectedPath, collectionPath, viewConfig.relations, relationOptions, viewFilterFieldTypes, projectedRows, fieldViewConfigs],
  );
  const viewSortOptionOrders = useMemo(
    () => Object.fromEntries(
      Object.entries(viewFilterOptions).map(([field, options]) => [field, options.map((option) => String(option.value))]),
    ) as Record<string, string[]>,
    [viewFilterOptions],
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
      optionOrdersByField: viewSortOptionOrders,
      derivedFieldProjection: { sourcePath: selectedPath, collectionPath },
    });
    if (perfState.active && perfState.awaitingViewRows) {
      markPerf("detail-reorder:after-view-rows");
      measurePerf("detail-reorder:view-rows", "detail-reorder:before-view-rows", "detail-reorder:after-view-rows");
      perfState.awaitingViewRows = false;
    }
    return stabilizeViewResult(previousViewResultRef.current, nextViewResult);
  }, [viewEngineRows, activeViewRenderState, viewFilterFieldTypes, viewSortOptionOrders]);
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
  const projectedVisibleRowViews = useMemo(
    () => visibleRowViews.map((view) => ({
      ...view,
      row: projectDerivedFields(view.row, { sourcePath: selectedPath, collectionPath }),
    })),
    [visibleRowViews, selectedPath, collectionPath],
  );
  const selectedDocumentFields = useMemo(() => {
    return buildSelectedDocumentFields({
      sourcePath: selectedPath,
      collectionPath,
      row: selectedRow,
      primaryKeyField: activeValidationPrimaryKeyField,
      displayTypes: fieldConfig.displayTypes,
      documentFieldConfigs: viewConfig.documentFields,
      documentIndexEntries: documentIndex.entries,
    }) as Array<{
      fieldName: string;
      key: string;
      documentId: string;
      label: string;
      indexEntry: DocumentIndexResponse["entries"][string] | null;
    }>;
  }, [selectedPath, selectedRow, activeValidationPrimaryKeyField, fieldConfig.displayTypes, collectionPath, viewConfig.documentFields, documentIndex.entries]);
  const activeDocumentField = useMemo(
    () => findPreferredActiveDocumentField({
      selectedDocumentFields,
      activeFieldName: activeDocumentFieldName,
      preferLinkedField: detailDocumentPanelOpen,
    }) as {
      fieldName: string;
      key: string;
      documentId: string;
      label: string;
      indexEntry: DocumentIndexResponse["entries"][string] | null;
    } | null,
    [selectedDocumentFields, activeDocumentFieldName, detailDocumentPanelOpen],
  );
  useEffect(() => {
    setActiveDocumentFieldName(activeDocumentField?.fieldName ?? null);
  }, [activeDocumentField]);
  const detailDocumentPanelVisible = useMemo(() => shouldOpenDetailDocumentPanel({
    detailOpen,
    panelPreferenceOpen: detailDocumentPanelOpen,
    selectedDocumentFields,
  }), [detailOpen, detailDocumentPanelOpen, selectedDocumentFields]);
  const activeDocumentId = activeDocumentField?.documentId ?? null;
  useEffect(() => {
    if (!selectedPath || !activeDocumentId) {
      setDocumentContent(null);
      setDocumentContentLoading(false);
      setDocumentContentError(null);
      return;
    }
    let cancelled = false;
    setDocumentContentLoading(true);
    setDocumentContentError(null);
    loadDocumentContent(selectedPath, activeDocumentId, activeProjectId, { refresh: true })
      .then((response) => {
        if (cancelled) return;
        setDocumentContent(response);
      })
      .catch((error) => {
        if (cancelled) return;
        setDocumentContent(null);
        setDocumentContentError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (cancelled) return;
        setDocumentContentLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPath, activeDocumentId, activeProjectId]);
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
  const configuredTitleField = useMemo(
    () => selectedPath ? (viewConfig.titleFields[buildCollectionKey(selectedPath, collectionPath)] ?? null) : null,
    [selectedPath, collectionPath, viewConfig.titleFields],
  );
  const titleField = useMemo(
    () => model ? findTitleField(getMainColumns(model, collectionPath), rows, configuredTitleField) : null,
    [model, collectionPath, rows, configuredTitleField],
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
  const documentConfigKey = useMemo(
    () => selectedPath && documentConfigField
      ? buildDocumentFieldKey({ sourceFile: selectedPath, sourceCollection: collectionPath, fieldPath: [documentConfigField] })
      : null,
    [selectedPath, collectionPath, documentConfigField],
  );
  const documentFieldConfigEnabled = documentConfigKey ? viewConfig.documentFields[documentConfigKey]?.enabled === true : false;
  const documentResolvedCount = useMemo(
    () => Object.values(documentIndex.entries).filter((entry) => entry?.status === "resolved").length,
    [documentIndex.entries],
  );
  const documentConflictCount = useMemo(
    () => Object.values(documentIndex.entries).filter((entry) => entry?.status === "conflict").length,
    [documentIndex.entries],
  );
  const configuredDocumentFields = useMemo(
    () => selectedPath
      ? Object.entries(viewConfig.documentFields)
        .filter(([, config]) => config?.enabled === true)
        .map(([key]) => parseDocumentFieldKey(key))
        .filter((parsed): parsed is NonNullable<ReturnType<typeof parseDocumentFieldKey>> => Boolean(parsed))
        .filter((parsed) => parsed.sourceFile === selectedPath && parsed.sourceCollection === collectionPath && parsed.fieldPath.length === 1)
        .map((parsed) => parsed.fieldPath[0]!)
      : [],
    [selectedPath, collectionPath, viewConfig.documentFields],
  );
  const documentFieldOptions = useMemo(
    () => Object.entries(fieldConfig.displayTypes)
      .filter(([, displayType]) => displayType === "Document")
      .map(([fieldName]) => ({
        fieldName,
        enabled: configuredDocumentFields.includes(fieldName),
      })),
    [fieldConfig.displayTypes, configuredDocumentFields],
  );
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
  const effectiveValidationSnapshot = useMemo(
    () => applyValidationIssueOverrides(validationSnapshot, validationIssueOverrides),
    [validationSnapshot, validationIssueOverrides],
  );
  const handleReorderRows = useCallback((
    sourceRowId: string,
    targetRowId: string,
    placement: "before" | "after",
  ) => {
    if (!canReorderRows || !model || !documentStore || !collectionStore) return;
    mutate(() => {
      const result = reorderRowsByRowId({
        model,
        store: documentStore,
        collectionPath,
        sourceRowId,
        targetRowId,
        placement,
      });
      const nextRowIds = [...collectionStore.rowIds];
      const identityIndex = nextRowIds.indexOf(sourceRowId);
      if (identityIndex < 0) throw new Error(`Unknown rowId: ${sourceRowId}`);
      nextRowIds.splice(identityIndex, 1);
      nextRowIds.splice(result.sourceIndex, 0, sourceRowId);
      const nextStore = buildDocumentStoreTyped({
        documentId: selectedPath ?? "document",
        model,
        previousStore: documentStore,
        collectionIdentityOverrides: new Map([[collectionPath, nextRowIds]]),
      });
      documentStoreRef.current = nextStore;
      prebuiltDocumentStoreRef.current = {
        documentId: selectedPath ?? "document",
        model,
        store: nextStore,
      };
      setSelectedSourceRow(result.sourceIndex, sourceRowId);
    });
  }, [canReorderRows, model, documentStore, collectionStore, collectionPath, selectedPath]);
  const handleDuplicateRow = useCallback((rowIndex: number, rowId: string | null) => {
    if (!model || !documentStore || !rowId) return;
    mutate(() => {
      const duplicate = duplicateRowByRowIdTyped({
        documentId: selectedPath ?? "document",
        model,
        store: documentStore,
        collectionPath,
        rowId,
        primaryKeyField: activeValidationPrimaryKeyField,
      });
      setSelectedSourceRow(duplicate.sourceIndex, duplicate.rowId);
    });
  }, [model, documentStore, selectedPath, collectionPath, activeValidationPrimaryKeyField]);
  const tableSnapshot = useMemo<TableSnapshot>(() => ({
    schemaModel: model!,
    sourcePath: selectedPath,
    collectionPath,
    rowViews: projectedVisibleRowViews,
    allRows: projectedRows,
    fieldConfig: tableFieldConfig,
    fieldViewConfigs,
    backlinkColumns,
    backlinkValuesByRowId: backlinkValuesByRowIdState,
    relationOptions,
    relationConfigs: viewConfig.relations,
    documentIndexEntries: documentIndex.entries,
    documentConfiguredFields: configuredDocumentFields,
    revision: tableRevision,
    sort: activeViewSort,
    validation: effectiveValidationSnapshot,
    titleField,
    primaryKeyField: activeValidationPrimaryKeyField,
    scrollRestoreKey,
    initialScrollPosition,
    textEditable: tableTextEditMode,
    canReorderRows,
    onEnableTextEditMode: enableTableTextEditMode,
    onRegisterActiveTextEditor: registerActiveTextEditor,
  }), [
    model,
    selectedPath,
    collectionPath,
    projectedVisibleRowViews,
    projectedRows,
    tableFieldConfig,
    fieldViewConfigs,
    backlinkColumns,
    backlinkValuesByRowIdState,
    relationOptions,
    viewConfig.relations,
    documentIndex.entries,
    configuredDocumentFields,
    tableRevision,
    activeViewSort,
    effectiveValidationSnapshot,
    titleField,
    activeValidationPrimaryKeyField,
    scrollRestoreKey,
    initialScrollPosition,
    tableTextEditMode,
    canReorderRows,
    enableTableTextEditMode,
    registerActiveTextEditor,
  ]);
  const visibleEntryActions = useMemo(
    () => resolveVisibleEntryActions({
      profile: automationProfileState,
      bindings: automationBindingsState,
      selectedPath,
      collectionPath,
    }),
    [automationProfileState, automationBindingsState, selectedPath, collectionPath],
  );
  useEffect(() => {
    if (!detailOpen || entryActionRunningId || !activeProjectId || !selectedPath || selectedSourceRowIndex == null) return;
    let cancelled = false;
    void Promise.all(visibleEntryActions.map(async (action) => {
      const response = await loadLatestEntryActionResult({
        actionId: action.id,
        sourcePath: selectedPath,
        collectionPath,
        rowId: selectedRowId,
        sourceRowIndex: selectedSourceRowIndex,
      }, activeProjectId);
      return response.run;
    }))
      .then(async (runs) => {
        if (cancelled) return;
        const latest = runs
          .filter((run): run is EntryActionRunResult => run != null)
          .sort((left, right) => String(right.finishedAt ?? right.startedAt ?? right.createdAt ?? "").localeCompare(String(left.finishedAt ?? left.startedAt ?? left.createdAt ?? "")))[0];
        if (!latest?.actionId) return;
        const action = visibleEntryActions.find((candidate) => candidate.id === latest.actionId);
        if (!action) return;
        if (isEntryActionRunDismissed({
          actionId: action.id,
          projectId: activeProjectId,
          sourcePath: selectedPath,
          collectionPath,
          rowId: selectedRowId,
          sourceRowIndex: selectedSourceRowIndex,
        }, latest.runId)) return;
        const output = latest.outputPath
          ? (await loadEntryActionOutput(latest.runId, activeProjectId).catch(() => null))?.output ?? null
          : null;
        if (cancelled) return;
        setEntryActionStatus(buildEntryActionDetailStatus(action.id, action.label, latest, output));
        setEntryActionErrorMessage(latest.message ?? null);
      })
      .catch(() => {
        // Status recovery is best-effort and must not block opening a detail panel.
      });
    return () => { cancelled = true; };
  }, [detailOpen, entryActionRunningId, activeProjectId, selectedPath, collectionPath, selectedRowId, selectedSourceRowIndex, visibleEntryActions]);
  const initialNestedTarget = useMemo(() => {
    if (!pendingNestedOpen) return null;
    if (pendingNestedOpen.rowId !== selectedRowId) return null;
    if (pendingNestedOpen.sourceRowIndex !== selectedSourceRowIndex) return null;
    return pendingNestedOpen;
  }, [pendingNestedOpen, selectedRowId, selectedSourceRowIndex]);
  const detailSnapshot = useMemo<DetailSnapshot>(() => ({
    open: detailOpen,
    panelWidth: detailPanelWidth,
    documentPanel: {
      open: detailDocumentPanelVisible,
      width: detailDocumentPanelWidth,
      activeFieldName: activeDocumentFieldName,
      fields: Object.fromEntries(selectedDocumentFields.map((entry) => [entry.fieldName, entry.label])),
      status: documentContentError
        ? "error"
        : documentContentLoading
          ? "loading"
          : activeDocumentField?.documentId
            ? (documentContent?.status ?? "missing")
            : "empty",
      fieldName: activeDocumentField?.fieldName ?? null,
      documentId: activeDocumentField?.documentId || null,
      title: documentContent?.status === "resolved"
        ? (documentContent.title ?? activeDocumentField?.label ?? activeDocumentField?.documentId ?? null)
        : activeDocumentField?.label ?? null,
      relativePath: documentContent?.status === "resolved" ? documentContent.relativePath : null,
      docRoot: documentIndex.docRoot,
      content: documentContent?.status === "resolved" ? documentContent.content : null,
      matches: documentContent?.status === "conflict" ? documentContent.matches : [],
      errorMessage: documentContentError ?? documentIndexError,
    },
    row: selectedRow,
    allRows: rows,
    rowId: selectedRowId,
    sourceRowIndex: selectedSourceRowIndex,
    rowCount: visibleRowViews.length,
    visibleRowPosition: selectedVisibleRowPosition,
    previousRowTarget: previousVisibleRowTarget,
    nextRowTarget: nextVisibleRowTarget,
    sourcePath: selectedPath,
    collectionPath,
    titleField,
    primaryKeyField: activeValidationPrimaryKeyField,
    detailOrder: fieldConfig.detailOrder,
    displayTypes: fieldConfig.displayTypes,
    fieldViewConfigs,
    validation: effectiveValidationSnapshot,
    relationOptions,
    relationConfigs: viewConfig.relations,
    relationBacklinks,
    primaryKeyImpacts,
    primaryKeySyncPlan,
    primaryKeySyncResult,
    commandSaving,
    entryActions: visibleEntryActions,
    entryActionRunningId,
    entryActionErrorMessage,
    entryActionStatus,
  }), [
    detailOpen,
    detailPanelWidth,
    detailDocumentPanelOpen,
    detailDocumentPanelWidth,
    activeDocumentFieldName,
    selectedDocumentFields,
    activeDocumentField,
    documentContent,
    documentContentLoading,
    documentContentError,
    documentIndex.docRoot,
    documentIndexError,
    selectedRow,
    rows,
    selectedRowId,
    selectedSourceRowIndex,
    visibleRowViews.length,
    selectedVisibleRowPosition,
    previousVisibleRowTarget,
    nextVisibleRowTarget,
    selectedPath,
    collectionPath,
    titleField,
    activeValidationPrimaryKeyField,
    fieldConfig.detailOrder,
    fieldConfig.displayTypes,
    fieldViewConfigs,
    effectiveValidationSnapshot,
    relationOptions,
    viewConfig.relations,
    relationBacklinks,
    primaryKeyImpacts,
    primaryKeySyncPlan,
    primaryKeySyncResult,
    commandSaving,
    visibleEntryActions,
    entryActionRunningId,
    entryActionErrorMessage,
    entryActionStatus,
  ]);
  const sharedViewCollaborationMode = selectedViewProfileName
    ? (selectedViewProfile?.sharedViewCollaborationMode === "personal" ? "personal" : "team")
    : "team";
  const isPersonalSharedViewMode = sharedViewCollaborationMode === "personal";
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
    restarting,
    status: statusText,
    hiddenFields,
    sharedViewPublishVisible: !isPersonalSharedViewMode && Boolean(
      activeCollectionKey
      && activeSharedView
      && hasViewDraft(currentSharedViewDraftState(), activeCollectionKey, activeSharedView.id),
    ),
    sharedViewPublishEnabled: !isPersonalSharedViewMode && Boolean(
      activeCollectionKey
      && activeSharedView
      && !commandSaving
      && hasViewDraft(currentSharedViewDraftState(), activeCollectionKey, activeSharedView.id),
    ),
    sharedViewPublishTooltip: "保存团队共享视图",
    sharedViewCollaborationMode,
    canUsePersonalSharedViewMode: Boolean(selectedViewProfileName),
    sharedViewModeHelpText: selectedViewProfileName
      ? sharedViewCollaborationMode === "personal"
        ? "共享视图改动将直接保存到项目，不再需要团队保存"
        : "共享视图改动先保存为草稿，需要手动发布"
      : "需先选择或创建命名视图配置",
    sharedViewDirectSaveRetryVisible: sharedViewDirectSavePending,
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
    restarting,
    statusText,
    hiddenFields,
    activeCollectionKey,
    activeSharedView,
    isPersonalSharedViewMode,
    sharedViewCollaborationMode,
    sharedViewDirectSavePending,
    selectedViewProfile,
  ]);
  const viewTabsSnapshot = useMemo<ViewTabsSnapshot>(() => ({
    views: orderedCollectionViews,
    topLevelItems: resolvedCollectionViews.topLevelItems,
    activeViewId: activeSharedView?.id ?? null,
    activeGroupId: resolvedCollectionViews.activeGroupId,
    expandedGroupId: resolvedCollectionViews.expandedGroupId,
    lastActiveViewIdByGroupId: resolvedCollectionViews.lastActiveViewIdByGroupId,
    dirtyViewIds,
    commandSaving,
    manualSaveDirty: toolbarDirty,
    filterBarVisible,
    hasActiveFilters: activeViewHasFilters,
    tableTextEditMode,
    viewOrderDirty,
    selectedFilePath: selectedPath,
    documentRoot: selectedPath ? (viewConfig.documentFiles[selectedPath]?.docRoot ?? "") : "",
    documentFields: documentFieldOptions,
    documentResolvedCount,
    documentConflictCount,
    documentIndexError,
  }), [
    orderedCollectionViews,
    resolvedCollectionViews,
    activeSharedView,
    dirtyViewIds,
    commandSaving,
    toolbarDirty,
    filterBarVisible,
    activeViewHasFilters,
    tableTextEditMode,
    viewOrderDirty,
    selectedPath,
    viewConfig.documentFiles,
    documentFieldOptions,
    documentResolvedCount,
    documentConflictCount,
    documentIndexError,
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
  const protectedSharedViewIconPackIds = useMemo(
    () => collectProtectedSharedViewIconPackIds(resolvedCollectionViews.topLevelItems),
    [resolvedCollectionViews.topLevelItems],
  );
  const appFrameStyle = useMemo(() => ({ "--sidebar-width": `${sidebarWidth}px` }) as CSSProperties, [sidebarWidth]);

  useEffect(() => {
    if (!protectedSharedViewIconPackIds.length) return;
    const missingPackIds = protectedSharedViewIconPackIds.filter((packId) => !isSharedViewIconPackLoaded(packId as any));
    if (!missingPackIds.length) return;
    let cancelled = false;
    void (async () => {
      await Promise.all(missingPackIds.map((packId) => loadSharedViewIconPack(packId as any)));
      if (!cancelled) {
        setSharedViewIconPackVersion((current) => current + 1);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [protectedSharedViewIconPackIds]);

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
      detailDocumentPanelOpen: current.detailDocumentPanelOpen,
      detailDocumentPanelWidth: current.detailDocumentPanelWidth,
      favoriteSharedViewIconIds: [...(current.favoriteSharedViewIconIds ?? [])],
      fileOrder: [...current.fileOrder],
      sidebarTree: cloneStoredSidebarTreeState(current.sidebarTree),
      lastActiveViews: { ...current.lastActiveViews },
      viewDrafts: { ...current.viewDrafts },
      viewOrderDrafts: { ...current.viewOrderDrafts },
      sharedViewCollaborationMode: current.sharedViewCollaborationMode,
      structureDrafts: { ...current.structureDrafts },
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
            ...(value.overrides ? { overrides: cloneLayoutOverrides(value.overrides) } : {}),
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
      const nextProfile = mutateProfileViewLayoutState({
        profile: draft,
        path: selectedPath,
        collectionPath,
        viewId: activeViewLayoutId,
        mutator,
      });
      draft.viewLayouts = nextProfile.viewLayouts;
      draft.collections = nextProfile.collections;
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

  function reportSharedDraftSaveFailure(error: unknown) {
    setStatus(error instanceof Error ? error.message : String(error));
  }

  function persistSharedDraftProfileState(next: SharedViewDraftState) {
    if (!selectedViewProfileNameRef.current) return;
    selectedViewProfileRef.current = {
      ...selectedViewProfileRef.current,
      lastActiveViews: next.lastActiveViews,
      viewDrafts: next.viewDrafts,
      viewOrderDrafts: next.viewOrderDrafts,
      structureDrafts: next.structureDrafts,
    };
    setViewDraftDirty(hasSharedDrafts(next));
    void commitProfileSave(selectedViewProfileNameRef.current!, selectedViewProfileRef.current).catch(reportSharedDraftSaveFailure);
  }

  function updateSharedViewDraftAndPersist(mutator: (draft: SharedViewDraftState) => SharedViewDraftState) {
    if (!selectedViewProfileName) return false;
    const next = mutator(currentSharedViewDraftState());
    mutateSelectedViewProfile((draft) => {
      draft.lastActiveViews = next.lastActiveViews;
      draft.viewDrafts = next.viewDrafts;
      draft.viewOrderDrafts = next.viewOrderDrafts;
      draft.structureDrafts = next.structureDrafts;
    });
    persistSharedDraftProfileState(next);
    return true;
  }

  function replaceSharedViewDraftStateAndPersist(next: SharedViewDraftState) {
    if (!selectedViewProfileName) return false;
    mutateSelectedViewProfile((draft) => {
      draft.lastActiveViews = next.lastActiveViews;
      draft.viewDrafts = next.viewDrafts;
      draft.viewOrderDrafts = next.viewOrderDrafts;
      draft.structureDrafts = next.structureDrafts;
    });
    persistSharedDraftProfileState(next);
    return true;
  }

  async function enqueueSharedViewDirectSave(
    mutator: (config: SharedViewsConfig) => SharedViewsConfig,
    draftFallback?: SharedViewDraftState,
    successStatus?: string,
  ) {
    const fallbackCollectionKey = activeCollectionKey;
    sharedViewDirectSaveQueueRef.current = sharedViewDirectSaveQueueRef.current.then(async () => {
      const nextConfig = mutator(sharedViewsConfigRef.current);
      try {
        await saveSharedViews(nextConfig, activeProjectId);
        sharedViewsConfigRef.current = nextConfig;
        commitSharedViewsConfig(nextConfig);
        if (draftFallback && fallbackCollectionKey) {
          updateSharedViewDraftState(clearCollectionSharedDrafts(currentSharedViewDraftState(), fallbackCollectionKey));
        }
        setSharedViewDirectSavePending(false);
        sharedViewDirectSaveRetryRef.current = null;
        if (successStatus) setStatus(successStatus);
      } catch (error) {
        if (draftFallback) {
          updateSharedViewDraftState(draftFallback);
          sharedViewDirectSaveRetryRef.current = async () => {
            await saveSharedViews(nextConfig, activeProjectId);
            sharedViewsConfigRef.current = nextConfig;
            commitSharedViewsConfig(nextConfig);
            if (fallbackCollectionKey) {
              updateSharedViewDraftState(clearCollectionSharedDrafts(currentSharedViewDraftState(), fallbackCollectionKey));
            }
            setSharedViewDirectSavePending(false);
            sharedViewDirectSaveRetryRef.current = null;
            setStatus(successStatus ?? "");
          };
        }
        setSharedViewDirectSavePending(true);
        setStatus("共享视图自动保存失败");
      }
    });
    return sharedViewDirectSaveQueueRef.current;
  }

  function updateActiveViewDraft(patch: Partial<CollectionView>) {
    if (commandSaving) return;
    if (!activeCollectionKey || !activeSharedView) return;
    if (!activeView) return;
    const viewId = activeSharedView.id;
    if (isPersonalSharedViewMode) {
      const nextActiveView = {
        ...activeView,
        ...patch,
      };
      const draftFallback = {
        lastActiveViews: { ...currentSharedViewDraftState().lastActiveViews },
        viewDrafts: {
          ...currentSharedViewDraftState().viewDrafts,
          [activeCollectionKey]: {
            ...(currentSharedViewDraftState().viewDrafts[activeCollectionKey] ?? {}),
            [viewId]: {
              ...(currentSharedViewDraftState().viewDrafts[activeCollectionKey]?.[viewId] ?? {}),
              ...patch,
            },
          },
        },
        viewOrderDrafts: { ...currentSharedViewDraftState().viewOrderDrafts },
        structureDrafts: { ...currentSharedViewDraftState().structureDrafts },
      };
      void enqueueSharedViewDirectSave(
        (currentConfig) => updateSharedViewConfig(currentConfig, activeCollectionKey, viewId, nextActiveView) as SharedViewsConfig,
        draftFallback,
      );
      return;
    }
    if (updateSharedViewDraftAndPersist((current) => ({
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
      structureDrafts: { ...current.structureDrafts },
    }))) {
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
        structureDrafts: { ...current.structureDrafts },
      };
      writeLocalSharedViewDrafts(window.localStorage, next);
      return next;
    });
    setViewDraftDirty(true);
  }

  function handleToolbarQueryChange(value: string) {
    if (!activeSharedView) return;
    const fallbackQuery = activeView?.query ?? "";
    const nextOverride = value === fallbackQuery ? null : value;
    setToolbarQueryOverride(nextOverride);
    updatePageContextQuery(window.localStorage, activeProjectId, {
      path: selectedPath,
      collectionPath,
      viewId: activeSharedView.id,
      query: value,
      fallbackQuery,
    });
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
    const projectId = activeProjectIdRef.current;
    const snapshot = cloneDataRoot(normalizeUserViewProfile(profile));
    const previousTask = profileSavePromiseRef.current?.catch(() => {}) ?? Promise.resolve();
    const task = previousTask.then(() => saveViewProfile(name, snapshot, projectId));
    const trackedTask = task.finally(() => {
      if (profileSavePromiseRef.current === trackedTask) profileSavePromiseRef.current = null;
    });
    profileSavePromiseRef.current = trackedTask;
    try {
      await trackedTask;
    } catch (error) {
      if (profileSavePromiseRef.current === trackedTask) profileSavePromiseRef.current = null;
      throw error;
    }
  }

  async function flushPendingProfileSave() {
    if (profileSavePromiseRef.current) await profileSavePromiseRef.current;
  }

  function getRowIdAtSourceIndex(sourceIndex: number | null, store = collectionStore) {
    if (sourceIndex == null || !store) return null;
    return store.rowViews[sourceIndex]?.rowId ?? null;
  }

  function clearEntryActionFeedback() {
    entryActionWatchIdRef.current += 1;
    setEntryActionErrorMessage(null);
    setEntryActionStatus(null);
  }

  function dismissEntryActionStatus(status: DetailEntryActionStatus) {
    if (status.runId && activeProjectId && selectedPath && selectedSourceRowIndex != null) {
      dismissEntryActionRun({
        actionId: status.actionId,
        projectId: activeProjectId,
        sourcePath: selectedPath,
        collectionPath,
        rowId: selectedRowId,
        sourceRowIndex: selectedSourceRowIndex,
      }, status.runId);
    }
    clearEntryActionFeedback();
  }

  function buildCurrentEntryActionFeedbackSelection(): EntryActionFeedbackSelection {
    return {
      sourcePath: selectedPathRef.current,
      collectionPath: collectionPathRef.current,
      rowId: selectedRowIdRef.current,
      sourceRowIndex: selectedSourceRowIndexRef.current,
    };
  }

  function clearEntryActionFeedbackForSelection(nextSelection: EntryActionFeedbackSelection) {
    if (shouldPreserveEntryActionFeedback(buildCurrentEntryActionFeedbackSelection(), nextSelection)) {
      return;
    }
    clearEntryActionFeedback();
  }

  function setSelectedSourceRow(sourceIndex: number | null, rowId: string | null = getRowIdAtSourceIndex(sourceIndex)) {
    clearEntryActionFeedbackForSelection({
      sourcePath: selectedPathRef.current,
      collectionPath: collectionPathRef.current,
      rowId,
      sourceRowIndex: sourceIndex,
    });
    setSelectedRowIndex(sourceIndex);
    setSelectedRowIdState(rowId);
  }

  function flushSelectedSourceRow(sourceIndex: number | null, rowId: string | null = getRowIdAtSourceIndex(sourceIndex)) {
    flushSync(() => {
      clearEntryActionFeedbackForSelection({
        sourcePath: selectedPathRef.current,
        collectionPath: collectionPathRef.current,
        rowId,
        sourceRowIndex: sourceIndex,
      });
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

  function updateValidationIssueOverride(
    rowIndex: number | null,
    rowId: string | null,
    fieldName: string,
    issue: ValidationIssue | null,
  ) {
    const resolvedRowIndex = rowIndex ?? resolveSourceIndexFromRowId(rowId, null);
    if (resolvedRowIndex == null) return;
    const issueKey = buildIssueKey(collectionStore, resolvedRowIndex, fieldName);
    setValidationIssueOverrides((current) => {
      const next = { ...current };
      if (issue) {
        next[issueKey] = issue;
      } else {
        delete next[issueKey];
      }
      return next;
    });
  }

  function resolveCellEditWrite(
    rowIndex: number | null,
    rowId: string | null,
    fieldName: string,
    value: unknown,
  ) {
    const resolvedRowIndex = rowIndex ?? resolveSourceIndexFromRowId(rowId, null);
    if (fieldName === activeValidationPrimaryKeyField && activeValidationPrimaryKeyField) {
      const result = resolveAutoSuffixedPrimaryKeyValue({
        rows,
        fieldName,
        value,
        excludeRowIndex: resolvedRowIndex ?? undefined,
      });
      return {
        value: result.value,
        issue: result.adjusted
          ? { severity: "warning" as const, message: `输入值重复，已自动改为 ${result.value}` }
          : null,
      };
    }
    return { value, issue: null };
  }

  function handleEditCell(rowIndex: number, fieldName: string, value: unknown) {
    if (!model || isDerivedField(fieldName)) return;
    const nextEdit = resolveCellEditWrite(rowIndex, null, fieldName, value);
    updateValidationIssueOverride(rowIndex, null, fieldName, nextEdit.issue);
    validationInvalidationRef.current = resolveValidationInvalidation(fieldName, null, rowIndex);
    mutate(() => setCellValue(model, collectionPath, rowIndex, fieldName, nextEdit.value));
  }

  function handleEditCellByRowId(rowId: string, fieldName: string, value: unknown) {
    if (!model || !documentStore || isDerivedField(fieldName)) return;
    const nextEdit = resolveCellEditWrite(null, rowId, fieldName, value);
    updateValidationIssueOverride(null, rowId, fieldName, nextEdit.issue);
    validationInvalidationRef.current = resolveValidationInvalidation(fieldName, rowId, null);
    mutate(() => setCellValueByRowId({ model, store: documentStore, collectionPath, rowId, fieldName, value: nextEdit.value }));
  }

  function handleTableEditCell(rowIndex: number, rowId: string | null, fieldName: string, value: unknown) {
    if (rowId) {
      handleEditCellByRowId(rowId, fieldName, value);
      return;
    }
    handleEditCell(rowIndex, fieldName, value);
  }

  function handleChangeFieldType(fieldName: string, displayType: FieldDisplayType) {
    if (!selectedPath || !model || (displayType !== "Text" && displayType !== "Select" && displayType !== "Document")) return;
    const rowsInCollection = getRows(model, collectionPath) as DataRecord[];
    const relationKey = buildRelationKey({ sourceFile: selectedPath, sourceCollection: collectionPath, fieldPath: [fieldName] });
    mutateViewConfig((draft) => {
      const key = fieldViewConfigKey(selectedPath, collectionPath, fieldName);
      if (!key) return;
      const current = ensureFieldViewConfig(draft, key);
      current.type = displayType as RealFieldType;
      if (displayType === "Document") {
        delete draft.relations[relationKey];
      }
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
    if (!canConfigureRelationForField(fieldName)) {
      setStatus(`只有非标题、非主键且未启用关联文档的 Text、Select 或 Multi-select 字段可以设为关联字段`);
      return;
    }
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

  function handleConfigureDocument(fieldName: string) {
    if (!selectedPath) return;
    if (!canConfigureDocumentForField(fieldName)) {
      setStatus(`只有未配置关联的 Text 或 Document 字段可以设为关联文档字段`);
      return;
    }
    setDocumentConfigField(fieldName);
  }

  function handleClearDocument(fieldName: string) {
    if (!selectedPath) return;
    const key = buildDocumentFieldKey({ sourceFile: selectedPath, sourceCollection: collectionPath, fieldPath: [fieldName] });
    mutateViewConfig((draft) => {
      delete draft.documentFields[key];
    });
    setStatus(`已取消字段 ${fieldName} 的关联文档配置`);
  }

  function confirmDocumentFieldConfig(enabled: boolean) {
    if (!selectedPath || !documentConfigField) return;
    setDocumentFieldEnabled(documentConfigField, enabled);
    setDocumentConfigField(null);
  }

  function setDocumentFieldEnabled(fieldName: string, enabled: boolean) {
    if (!selectedPath) return;
    if (enabled && !canConfigureDocumentForField(fieldName)) {
      setStatus(`只有未配置关联的 Text 或 Document 字段可以设为关联文档字段`);
      return;
    }
    const key = buildDocumentFieldKey({ sourceFile: selectedPath, sourceCollection: collectionPath, fieldPath: [fieldName] });
    const relationKey = buildRelationKey({ sourceFile: selectedPath, sourceCollection: collectionPath, fieldPath: [fieldName] });
    mutateViewConfig((draft) => {
      if (enabled) {
        delete draft.relations[relationKey];
        draft.documentFields[key] = { enabled: true };
      } else {
        delete draft.documentFields[key];
      }
    });
    setStatus(enabled ? `已启用字段 ${fieldName} 的关联文档` : `已关闭字段 ${fieldName} 的关联文档`);
  }

  function handleSaveDocumentRoot(docRoot: string) {
    if (!selectedPath) return;
    const nextDocRoot = docRoot.trim();
    mutateViewConfig((draft) => {
      if (!nextDocRoot) {
        delete draft.documentFiles[selectedPath];
        return;
      }
      draft.documentFiles[selectedPath] = { docRoot: nextDocRoot };
    });
    setStatus(nextDocRoot ? `已更新 ${selectedPath} 的文档根目录` : `已清除 ${selectedPath} 的文档根目录`);
  }

  async function handleRefreshDocumentIndex() {
    if (!selectedPath) return;
    setDocumentIndexError(null);
    const currentDocumentId = activeDocumentId;
    if (currentDocumentId) {
      setDocumentContentLoading(true);
      setDocumentContentError(null);
    }
    try {
      const response = await loadDocumentIndex(selectedPath, activeProjectId, { refresh: true });
      setDocumentIndex(response);
      if (currentDocumentId) {
        const nextContent = await loadDocumentContent(selectedPath, currentDocumentId, activeProjectId, { refresh: true });
        setDocumentContent(nextContent);
        setDocumentContentError(null);
      }
      setStatus(`已重新加载 ${selectedPath} 的文档索引`);
    } catch (error) {
      setDocumentIndex({ docRoot: viewConfig.documentFiles[selectedPath]?.docRoot ?? null, entries: {} });
      setDocumentIndexError(error instanceof Error ? error.message : String(error));
      if (currentDocumentId) {
        setDocumentContent(null);
        setDocumentContentError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (currentDocumentId) setDocumentContentLoading(false);
    }
  }

  function confirmRelationConfig(config: RelationConfig) {
    if (!selectedPath || !relationConfigField) return;
    if (!canConfigureRelationForField(relationConfigField)) {
      setStatus(`只有非标题、非主键且未启用关联文档的 Text、Select 或 Multi-select 字段可以设为关联字段`);
      setRelationConfigField(null);
      return;
    }
    const key = buildRelationKey({ sourceFile: selectedPath, sourceCollection: collectionPath, fieldPath: [relationConfigField] });
    const documentKey = buildDocumentFieldKey({ sourceFile: selectedPath, sourceCollection: collectionPath, fieldPath: [relationConfigField] });
    mutateViewConfig((draft) => {
      delete draft.documentFields[documentKey];
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
    assignPrimaryKeyField(selectedPrimaryKeyCandidate);
    if (selectedCollectionKey) {
      setDismissedCandidateKeys((current) => current.filter((key) => key !== selectedCollectionKey));
    }
    setPrimaryKeyCandidateDialogOpen(false);
  }

  function handleSetTitleField(fieldName: string) {
    if (!selectedPath) return;
    if (!canSetTitleField(fieldName)) {
      setStatus(`只有未配置关联的 Text 字段可以设为标题字段`);
      return;
    }
    const collectionKey = buildCollectionKey(selectedPath, collectionPath);
    if (viewConfig.titleFields[collectionKey] === fieldName) return;
    mutateViewConfig((draft) => {
      draft.titleFields[collectionKey] = fieldName;
    });
    setStatus(`已将 ${fieldName} 设为标题字段`);
  }

  function handleSetPrimaryKeyField(fieldName: string) {
    if (!selectedPath) return;
    if (!canSetPrimaryKeyField(fieldName)) {
      setStatus("只有未配置关联的 Text 字段可以设为主键ID");
      return;
    }
    assignPrimaryKeyField(fieldName);
    if (selectedCollectionKey) {
      setDismissedCandidateKeys((current) => current.filter((key) => key !== selectedCollectionKey));
    }
    setStatus(`已将 ${fieldName} 设为主键ID`);
  }

  function assignPrimaryKeyField(fieldName: string) {
    if (!selectedPath) return;
    const collectionKey = buildCollectionKey(selectedPath, collectionPath);
    if (viewConfig.primaryKeys[collectionKey] === fieldName) return;
    mutateViewConfig((draft) => {
      draft.primaryKeys[collectionKey] = fieldName;
    });
  }

  function getCurrentBaseFieldType(fieldName: string): FieldDisplayType {
    if (!model) return fieldConfig.displayTypes[fieldName] ?? "Text";
    const rowsInCollection = getRows(model, collectionPath) as DataRecord[];
    return inferViewFilterFieldType(fieldName, rowsInCollection, fieldConfig.displayTypes);
  }

  function fieldHasRelationConfig(fieldName: string): boolean {
    if (!selectedPath) return false;
    const relationKey = buildRelationKey({ sourceFile: selectedPath, sourceCollection: collectionPath, fieldPath: [fieldName] });
    return Boolean(viewConfig.relations[relationKey]);
  }

  function canSetTitleField(fieldName: string): boolean {
    return getCurrentBaseFieldType(fieldName) === "Text" && !fieldHasRelationConfig(fieldName);
  }

  function canSetPrimaryKeyField(fieldName: string): boolean {
    return getCurrentBaseFieldType(fieldName) === "Text" && !fieldHasRelationConfig(fieldName);
  }

  function canConfigureRelationForField(fieldName: string): boolean {
    if (!selectedPath) return false;
    const collectionKey = buildCollectionKey(selectedPath, collectionPath);
    const documentKey = buildDocumentFieldKey({ sourceFile: selectedPath, sourceCollection: collectionPath, fieldPath: [fieldName] });
    const baseType = getCurrentBaseFieldType(fieldName);
    return (baseType === "Text" || baseType === "Select" || baseType === "Multi-select")
      && viewConfig.titleFields[collectionKey] !== fieldName
      && viewConfig.primaryKeys[collectionKey] !== fieldName
      && !viewConfig.documentFields[documentKey]?.enabled;
  }

  function canConfigureDocumentForField(fieldName: string): boolean {
    const baseType = getCurrentBaseFieldType(fieldName);
    return (baseType === "Text" || baseType === "Document") && !fieldHasRelationConfig(fieldName);
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
    const currentRules = activeView.filters?.topLevelRules ?? [];
    const existingRule = currentRules.find((rule) => rule.field === fieldName);
    if (existingRule) {
      setFilterBarVisible(true);
      setPendingOpenFilterRuleId(existingRule.id);
      return;
    }
    const nextRule = createDefaultFilterRule(fieldName, fieldType, currentRules);
    setFilterBarVisible(true);
    setPendingOpenFilterRuleId(nextRule.id);
    updateActiveViewDraft({ filters: withRules(activeView.filters, [...currentRules, nextRule]) as FilterGroup });
  }

  async function handleCreateFormalFilterOption(input: CreateFilterOptionInput): Promise<MultiSelectOptionView[]> {
    if (!selectedPath) return input.options;
    const normalized = input.value.trim();
    if (!normalized) return input.options;
    const nextOptions = input.options.some((option) => option.value === normalized)
      ? input.options
      : [...input.options, { value: normalized, label: normalized, color: null }];
    mutateOptionFieldTransaction({
      mutateViewConfigDraft: (draft) => {
        const key = fieldViewConfigKey(selectedPath, collectionPath, input.field);
        if (!key) return;
        const current = ensureFieldViewConfig(draft, key);
        draft.fields[key] = {
          ...current,
          selectOptions: input.fieldType === "Select"
            ? buildOptionConfigFromOptions(nextOptions) as typeof current.selectOptions
            : current.selectOptions,
          multiSelectOptions: input.fieldType === "Multi-select"
            ? buildOptionConfigFromOptions(nextOptions) as typeof current.multiSelectOptions
            : current.multiSelectOptions,
        };
      },
    });
    return nextOptions;
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
    }, activeViewLayoutId, activeSnapshot.sidebarWidth ?? sidebarWidth, activeSnapshot.detailPanelWidth ?? detailPanelWidth, detailDocumentPanelOpen, detailDocumentPanelWidth, normalizeFileOrder(
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

  async function handleRunDetailEntryAction(actionId: string) {
    if (entryActionRunningId) return;
    if (!activeProjectId || !selectedPath || selectedSourceRowIndex == null) return;
    const actionLabel = visibleEntryActions.find((action) => action.id === actionId)?.label ?? actionId;
    setEntryActionErrorMessage(null);
    setEntryActionStatus({
      actionId,
      tone: "running",
      title: `${actionLabel} 运行中`,
      detail: "正在保存当前条目并等待自动化执行完成。",
    });
    const watchId = entryActionWatchIdRef.current + 1;
    entryActionWatchIdRef.current = watchId;
    setEntryActionRunningId(actionId);
    try {
      flushActiveTextEditorDraft();
      const flushResult = await saveCoordinator.flush("flush");
      if (flushResult.outcome === "blocked-confirmation") {
        const blockedMessage = describeEntryActionFlushBlockedMessage(actionLabel, flushResult);
        setEntryActionErrorMessage(blockedMessage);
        setEntryActionStatus({
          actionId,
          tone: "warning",
          title: `${actionLabel} 尚未发起`,
          detail: blockedMessage,
        });
        return;
      }
      if (flushResult.outcome === "error") {
        const failedMessage = "当前改动保存失败，自动化尚未发起。";
        setEntryActionErrorMessage(failedMessage);
        setEntryActionStatus({
          actionId,
          tone: "error",
          title: `${actionLabel} 执行失败`,
          detail: failedMessage,
        });
        return;
      }
      const sourceRow = getRows(model, collectionPath)[selectedSourceRowIndex];
      if (!sourceRow || typeof sourceRow !== "object") throw new Error("当前条目已变化，无法建立安全的自动化目标。");
      const result = await runEntryAction({
        projectId: activeProjectId,
        actionId,
        sourcePath: selectedPath,
        collectionPath,
        rowId: selectedRowId,
        sourceRowIndex: selectedSourceRowIndex,
        expectedRowDigest: rowDigest(sourceRow),
        idempotencyKey: crypto.randomUUID(),
      });
      const started = result.status === "promotion_pending"
        ? await (async () => {
          await openDocumentAt(selectedPath, collectionPath, undefined, detailOpen, activeProjectId, result.receipt.durableId);
          return ackStartEntryAction({ projectId: activeProjectId, pendingActionToken: result.pendingActionToken });
        })()
        : result;
      if (started.message) {
        setEntryActionErrorMessage(started.message);
      }
      const waitOutcome = await waitForEntryActionResultWithBackground({
        loadResult: loadEntryActionResult,
        onEnterBackgroundWait: () => {
          setEntryActionStatus({
            actionId,
            runId: started.runId,
            tone: "running",
            title: `${actionLabel} 仍在执行`,
            detail: "自动化耗时较长，仍在后台等待完成结果。结果返回后会自动更新。",
          });
        },
        onPendingResult: (pendingResult) => {
          setEntryActionStatus(buildEntryActionDetailStatus(actionId, actionLabel, pendingResult));
        },
        projectId: activeProjectId,
        runId: started.runId,
        shouldContinue: () => entryActionWatchIdRef.current === watchId,
      });
      const finalResult = resolveEntryActionWaitOutcome(actionId, actionLabel, waitOutcome);
      if (!finalResult) return;
      const output = finalResult.outputPath
        ? (await loadEntryActionOutput(finalResult.runId, activeProjectId).catch(() => null))?.output ?? null
        : null;
      const finalStatus = buildEntryActionDetailStatus(actionId, actionLabel, finalResult, output);
      setEntryActionStatus(finalStatus);
      if (finalResult.message) setEntryActionErrorMessage(finalResult.message);
      if (finalResult.outcome === "completed_with_writeback" || finalResult.outcome === "completed_without_changes") {
        await openDocumentAt(
          selectedPathRef.current ?? selectedPath,
          collectionPathRef.current,
          selectedSourceRowIndexRef.current ?? selectedSourceRowIndex,
          true,
          activeProjectId,
          selectedRowIdRef.current ?? selectedRowId,
          true,
        );
      }
    } catch (error) {
      if (error instanceof EntryActionResultWaitCancelledError) return;
      const errorMessage = error instanceof Error ? error.message : String(error);
      setEntryActionErrorMessage(errorMessage);
      setEntryActionStatus({
        actionId,
        tone: "error",
        title: `${actionLabel} 执行失败`,
        detail: errorMessage,
      });
    } finally {
      setEntryActionRunningId(null);
    }
  }

  function describeEntryActionFlushBlockedMessage(
    actionLabel: string,
    flushResult: Awaited<ReturnType<typeof saveCoordinator.flush>>,
  ) {
    if (flushResult.outcome !== "blocked-confirmation") {
      return `${actionLabel} 尚未发起。`;
    }
    if (flushResult.reason === "primary-key-blocking") {
      return flushResult.message
        ? `当前条目未保存，且主键同步校验未通过：${flushResult.message}`
        : "当前条目未保存，且主键同步校验未通过，自动化尚未发起。";
    }
    if (flushResult.reason === "primary-key-confirmation") {
      return flushResult.message
        ? `当前条目未保存，且需要先确认主键同步影响：${flushResult.message}`
        : "当前条目未保存，且需要先确认主键同步影响，自动化尚未发起。请先处理顶部待确认。";
    }
    return flushResult.message ?? "当前条目还有待确认的保存项，自动化尚未发起。请先处理顶部待确认。";
  }

  function buildEntryActionDetailStatus(
    actionId: string,
    actionLabel: string,
    result: EntryActionRunResult,
    output: string | null = null,
  ): DetailEntryActionStatus {
    if (result.outcome === "completed_with_writeback") {
      const changedFields = result.writebackCheck?.changedFields?.length
        ? `已观察到字段变更：${result.writebackCheck.changedFields.join("、")}`
        : "已观察到目标条目写回。";
      if (result.reason === "codex_exec_timeout") {
        return {
          actionId,
          runId: result.runId,
          tone: "warning",
          title: `${actionLabel} 已写回（执行超时）`,
          detail: result.message ?? `自动化在等待上限内未正常结束，但${changedFields}`,
          output,
        };
      }
      return {
        actionId,
        runId: result.runId,
        tone: "success",
        title: `${actionLabel} 已写回`,
        detail: result.message ?? changedFields,
        output,
      };
    }
    if (result.outcome === "completed_without_changes") {
      return {
        actionId,
        runId: result.runId,
        tone: "warning",
        title: `${actionLabel} 已完成（无变更）`,
        detail: result.message ?? "自动化已完成，正式文件没有提交变更。",
        output,
      };
    }
    if (result.outcome === "rejected" || result.outcome === "conflicted") {
      return {
        actionId,
        runId: result.runId,
        tone: "warning",
        title: result.outcome === "conflicted" ? `${actionLabel} 提交冲突` : `${actionLabel} 未执行`,
        detail: result.message ?? result.reason ?? (result.outcome === "conflicted" ? "自动化提交与当前文件冲突，未写入。" : "自动化请求被拒绝，未进入执行。"),
        output,
      };
    }
    if (result.outcome === "timed_out") {
      return { actionId, runId: result.runId, tone: "warning", title: `${actionLabel} 执行超时`, detail: result.message ?? "自动化执行超时，已安全结束。", output };
    }
    if (result.outcome === "failed_needs_recovery") {
      return { actionId, runId: result.runId, tone: "error", title: `${actionLabel} 等待恢复`, detail: result.message ?? "自动化未能证明安全终态，已保留恢复证据。", output };
    }
    if (result.outcome === "failed") {
      return {
        actionId,
        runId: result.runId,
        tone: "error",
        title: `${actionLabel} 执行失败`,
        detail: result.message ?? result.reason ?? "自动化执行失败。",
        output,
      };
    }
    return {
      actionId,
      runId: result.runId,
      startedAt: result.startedAt,
      tone: "running",
      title: `${actionLabel} 运行中`,
      detail: "自动化仍在执行，正在等待完成结果。",
      output,
    };
  }

  async function waitForEntryActionResult(runId: string, projectId: string): Promise<EntryActionRunResult> {
    const outcome = await waitForEntryActionResultWithBackground({
      loadResult: loadEntryActionResult,
      projectId,
      runId,
    });
    if (outcome.kind === "completed") return outcome.result;
    throw new Error("自动化后台等待超时，仍未收到完成结果。");
  }

  function resolveEntryActionWaitOutcome(
    actionId: string,
    actionLabel: string,
    outcome: WaitForEntryActionResultOutcome,
  ) {
    if (outcome.kind === "completed") return outcome.result;
    setEntryActionStatus({
      actionId,
      tone: "warning",
      title: `${actionLabel} 仍未完成`,
      detail: "自动化已长时间运行，当前页面暂时停止等待。你可以稍后刷新页面再次查看最终写回结果。",
    });
    return null;
  }

  function persistDetailDocumentPanelOpen(nextOpen: boolean) {
    setDetailDocumentPanelOpen(nextOpen);
    if (mutateSelectedViewProfile((draft) => { draft.detailDocumentPanelOpen = nextOpen; })) return;
    localStorage.setItem(detailDocumentPanelOpenStorageKey, nextOpen ? "1" : "0");
  }

  function handleDetailDocumentPanelWidthChange(width: number) {
    setDetailDocumentPanelWidth(clampDetailDocumentPanelWidth(width));
  }

  function commitDetailDocumentPanelWidth(width: number) {
    const nextWidth = clampDetailDocumentPanelWidth(width);
    setDetailDocumentPanelWidth(nextWidth);
    if (mutateSelectedViewProfile((draft) => { draft.detailDocumentPanelWidth = nextWidth; })) return;
    localStorage.setItem(detailDocumentPanelWidthStorageKey, String(nextWidth));
  }

  function toggleDocumentPanel(fieldName?: string) {
    if (fieldName) setActiveDocumentFieldName(fieldName);
    const shouldClose = detailDocumentPanelOpen && (!fieldName || fieldName === activeDocumentFieldName);
    persistDetailDocumentPanelOpen(!shouldClose);
  }

  function openDetail(rowIndex: number) {
    const nextRowId = getRowIdAtSourceIndex(rowIndex);
    flushSync(() => {
      clearEntryActionFeedbackForSelection({
        sourcePath: selectedPathRef.current,
        collectionPath: collectionPathRef.current,
        rowId: nextRowId,
        sourceRowIndex: rowIndex,
      });
      setSelectedRowIndex(rowIndex);
      setSelectedRowIdState(nextRowId);
      setDetailOpen(true);
    });
  }

  function openDetailForRow(rowIndex: number, rowId: string | null) {
    const resolvedSourceIndex = resolveSourceIndexFromRowId(rowId, rowIndex);
    const resolvedRowId = rowId ?? getRowIdAtSourceIndex(resolvedSourceIndex);
    flushSync(() => {
      clearEntryActionFeedbackForSelection({
        sourcePath: selectedPathRef.current,
        collectionPath: collectionPathRef.current,
        rowId: resolvedRowId,
        sourceRowIndex: resolvedSourceIndex,
      });
      setSelectedRowIndex(resolvedSourceIndex);
      setSelectedRowIdState(resolvedRowId);
      setDetailOpen(true);
    });
  }

  function openNestedDetailForRow(rowIndex: number, rowId: string | null, fieldName: string) {
    const resolvedSourceIndex = resolveSourceIndexFromRowId(rowId, rowIndex);
    const resolvedRowId = rowId ?? getRowIdAtSourceIndex(resolvedSourceIndex);
    flushSync(() => {
      clearEntryActionFeedbackForSelection({
        sourcePath: selectedPathRef.current,
        collectionPath: collectionPathRef.current,
        rowId: resolvedRowId,
        sourceRowIndex: resolvedSourceIndex,
      });
      setSelectedRowIndex(resolvedSourceIndex);
      setSelectedRowIdState(resolvedRowId);
      setDetailOpen(true);
      setPendingNestedOpen({
        rowId: resolvedRowId,
        sourceRowIndex: resolvedSourceIndex,
        fieldName,
        requestKey: Date.now() + Math.random(),
      });
    });
  }

  function handleAddRow() {
    if (!model) return;
    const columns = getMainColumns(model, collectionPath);
    const nextRow: DataRecord = {};
    for (const fieldName of columns) {
      nextRow[fieldName] = defaultEmptyValue(viewFilterFieldTypes[fieldName] ?? fieldConfig.displayTypes[fieldName]);
    }
    const seededValues = deriveNewRowSeedValues(activeViewRenderState.filters, viewFilterFieldTypes);
    for (const [fieldName, value] of Object.entries(seededValues)) {
      if (columns.includes(fieldName)) nextRow[fieldName] = value;
    }
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
    if (selectedPath && (newFieldType === "Text" || newFieldType === "Select" || newFieldType === "Document")) {
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
    setToolbarQueryOverride(null);
    updatePageContextQuery(window.localStorage, activeProjectId, {
      path: selectedPath,
      collectionPath,
      viewId: activeViewLayoutId,
      query: activeView?.query ?? "",
      fallbackQuery: activeView?.query ?? "",
    });
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
      draft.detailDocumentPanelOpen = result.profile.detailDocumentPanelOpen;
      draft.detailDocumentPanelWidth = result.profile.detailDocumentPanelWidth;
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
      setDetailDocumentPanelOpen(false);
      setDetailDocumentPanelWidth(defaultDetailDocumentPanelWidth);
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
    setDetailDocumentPanelOpen(readDetailDocumentPanelOpen());
    setDetailDocumentPanelWidth(readDetailDocumentPanelWidth());
    bumpLayoutRevision((value) => value + 1);
    bumpTableRevision((value) => value + 1);
  }

  function updateSharedViewDraftState(next: SharedViewDraftState) {
    if (replaceSharedViewDraftStateAndPersist(next)) return;
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
    const parentGroupId = resolvedCollectionViews.parentGroupIdByViewId?.[viewId] ?? null;
    const nextLastActiveViewIdByGroupId = parentGroupId
      ? { ...projectPageContext.lastActiveViewIdByGroupId, [parentGroupId]: viewId }
      : { ...projectPageContext.lastActiveViewIdByGroupId };
    updateSharedViewDraftState({
      lastActiveViews: { ...current.lastActiveViews, [activeCollectionKey]: viewId },
      viewDrafts: { ...current.viewDrafts },
      viewOrderDrafts: { ...current.viewOrderDrafts },
      structureDrafts: { ...current.structureDrafts },
    });
    updatePageContextViewGrouping(window.localStorage, activeProjectId, {
      expandedGroupId: parentGroupId,
      lastActiveViewIdByGroupId: nextLastActiveViewIdByGroupId,
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
      commitSharedViewsConfig(nextConfig);
      const current = currentSharedViewDraftState();
      updateSharedViewDraftState({
        lastActiveViews: { ...current.lastActiveViews, [activeCollectionKey]: result.view.id },
        viewDrafts: { ...current.viewDrafts },
        viewOrderDrafts: { ...current.viewOrderDrafts },
        structureDrafts: { ...current.structureDrafts },
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
      commitSharedViewsConfig(nextConfig);
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
        structureDrafts: { ...current.structureDrafts },
      });
      setStatus("已创建团队共享视图副本");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setCommandSaving(false);
    }
  }

  async function handleDuplicateSharedViewGroup(groupId: string) {
    if (commandSaving || !activeCollectionKey || !selectedPath) return;
    const sourceGroup = resolvedCollectionViews.topLevelItems.find((item) => item.kind === "group" && item.id === groupId);
    if (!sourceGroup || sourceGroup.kind !== "group" || sourceGroup.views.length === 0) return;
    const current = currentSharedViewDraftState();
    const currentCollectionDrafts = current.viewDrafts?.[activeCollectionKey] ?? {};
    const resolvedGroupSnapshot = {
      kind: "group" as const,
      id: sourceGroup.id,
      name: sourceGroup.name,
      icon: sourceGroup.icon,
      views: sourceGroup.views.map((item) => ({
        ...item,
        view: mergeSharedViewWithDraft(item.view, currentCollectionDrafts[item.view.id]) as CollectionView,
      })),
    };
    setCommandSaving(true);
    setStatus("");
    try {
      const result = duplicateViewGroupConfig({
        sharedViewsConfig,
        collectionKey: activeCollectionKey,
        groupId,
        resolvedTopLevelItems: resolvedCollectionViews.topLevelItems,
        resolvedGroupSnapshot,
      });
      if (!result.group || !result.firstViewId) {
        setStatus("无法复制当前视图组");
        return;
      }
      const nextConfig = result.config as SharedViewsConfig;
      await saveSharedViews(nextConfig, activeProjectId);
      commitSharedViewsConfig(nextConfig);

      const duplicatedViewDraftsById: Record<string, Partial<CollectionView>> = {};
      for (const [sourceViewId, targetViewId] of Object.entries(result.sourceToTargetViewIdMap)) {
        const sourceDraft = currentCollectionDrafts[sourceViewId];
        if (!sourceDraft) continue;
        duplicatedViewDraftsById[targetViewId] = structuredClone(sourceDraft) as Partial<CollectionView>;
      }
      updateSharedViewDraftState({
        lastActiveViews: { ...current.lastActiveViews, [activeCollectionKey]: result.firstViewId },
        viewDrafts: {
          ...current.viewDrafts,
          [activeCollectionKey]: {
            ...(current.viewDrafts?.[activeCollectionKey] ?? {}),
            ...duplicatedViewDraftsById,
          },
        },
        viewOrderDrafts: { ...current.viewOrderDrafts },
        structureDrafts: { ...current.structureDrafts },
      });

      let layoutCopyFailed = false;
      try {
        if (selectedViewProfileName) {
          mutateSelectedViewProfile((draftProfile) => {
            let nextProfile = draftProfile;
            for (const [sourceViewId, targetViewId] of Object.entries(result.sourceToTargetViewIdMap)) {
              const copyResult = copyViewLayoutState({
                mode: "profile",
                path: selectedPath,
                collectionPath,
                sourceViewId,
                targetViewId,
                profile: nextProfile,
                localStorage: null,
              });
              nextProfile = copyResult.profile;
            }
            draftProfile.viewLayouts = nextProfile.viewLayouts;
            draftProfile.collections = nextProfile.collections;
          });
        } else {
          for (const [sourceViewId, targetViewId] of Object.entries(result.sourceToTargetViewIdMap)) {
            copyViewLayoutState({
              mode: "local",
              path: selectedPath,
              collectionPath,
              sourceViewId,
              targetViewId,
              profile: null,
              localStorage: window.localStorage,
            });
          }
        }
      } catch {
        layoutCopyFailed = true;
      }

      updatePageContextViewGrouping(window.localStorage, activeProjectId, {
        expandedGroupId: result.group.id,
        lastActiveViewIdByGroupId: {
          ...projectPageContext.lastActiveViewIdByGroupId,
          [result.group.id]: result.firstViewId,
        },
      });
      setSelectedSourceRow(0);
      setDetailOpen(false);
      setStatus(layoutCopyFailed ? "视图组已复制，但部分布局复制失败" : "已复制视图组");
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
      commitSharedViewsConfig(nextConfig);
      setStatus("已重命名团队共享视图");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setCommandSaving(false);
    }
  }

  async function handleUpdateSharedViewIcon(viewId: string, icon: SharedViewIconId) {
    if (commandSaving || !activeCollectionKey) return;
    setCommandSaving(true);
    setStatus("");
    try {
      const nextConfig = updateSharedViewIconConfig(sharedViewsConfig, activeCollectionKey, viewId, icon) as SharedViewsConfig;
      await saveSharedViews(nextConfig, activeProjectId);
      commitSharedViewsConfig(nextConfig);
      setStatus("已更新团队共享视图图标");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setCommandSaving(false);
    }
  }

  function handleToggleFavoriteSharedViewIcon(icon: SharedViewIconId) {
    if (!selectedViewProfileName) return;
    const nextProfile = mutateSelectedViewProfile((draft) => {
      const current = new Set(draft.favoriteSharedViewIconIds ?? []);
      if (current.has(icon)) {
        current.delete(icon);
      } else {
        current.add(icon);
      }
      draft.favoriteSharedViewIconIds = [...current];
    });
    if (nextProfile) {
      void commitProfileSave(selectedViewProfileNameRef.current!, nextProfile);
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
      commitSharedViewsConfig(nextConfig);
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

  function handleReorderSharedViews(operation: ViewTabReorderOperation) {
    if (commandSaving || !activeCollectionKey) return;
    if (isPersonalSharedViewMode) {
      const directDraftState = draftSharedViewStructure({
        draftState: currentSharedViewDraftState(),
        collectionKey: activeCollectionKey,
        topLevelItems: resolvedCollectionViews.topLevelItems,
        operation,
      });
      void enqueueSharedViewDirectSave((currentConfig) => {
        const structureDrafts = directDraftState.structureDrafts as NonNullable<SharedViewDraftState["structureDrafts"]> | undefined;
        const structureDraft = structureDrafts?.[activeCollectionKey];
        return structureDraft?.items?.length
          ? applyStructureDraftToConfig(currentConfig, activeCollectionKey, structureDraft) as SharedViewsConfig
          : currentConfig;
      }, directDraftState);
      return;
    }
    const next = draftSharedViewStructure({
      draftState: currentSharedViewDraftState(),
      collectionKey: activeCollectionKey,
      topLevelItems: resolvedCollectionViews.topLevelItems,
      operation,
    });
    updateSharedViewDraftState(next);
    const previousGroupId = "sourceViewId" in operation
      ? resolvedCollectionViews.parentGroupIdByViewId?.[operation.sourceViewId] ?? null
      : null;
    const previousGroupItem = previousGroupId
      ? resolvedCollectionViews.topLevelItems.find((item) => item.kind === "group" && item.id === previousGroupId)
      : null;
    const previousGroupViews = previousGroupItem?.kind === "group" ? previousGroupItem.views : [];
    const nextLastActiveViewIdByGroupId = { ...projectPageContext.lastActiveViewIdByGroupId };
    if ("sourceViewId" in operation && previousGroupId && nextLastActiveViewIdByGroupId[previousGroupId] === operation.sourceViewId) {
      delete nextLastActiveViewIdByGroupId[previousGroupId];
    }
    if (operation.type === "group") {
      nextLastActiveViewIdByGroupId[operation.groupId] = operation.sourceViewId;
    }
    updatePageContextViewGrouping(window.localStorage, activeProjectId, {
      expandedGroupId: operation.type === "group"
        ? operation.groupId
        : previousGroupId && previousGroupViews.length === 1 && projectPageContext.expandedGroupId === previousGroupId
          ? null
          : "sourceViewId" in operation && activeSharedView?.id === operation.sourceViewId
            ? null
            : projectPageContext.expandedGroupId,
      lastActiveViewIdByGroupId: nextLastActiveViewIdByGroupId,
    });
  }

  function handleResetSharedViewDraft() {
    if (commandSaving || !activeCollectionKey || !activeSharedView) return;
    setSharedViewDirectSavePending(false);
    sharedViewDirectSaveRetryRef.current = null;
    setStatus("");
    if (mutateSelectedViewProfile((draft) => {
      const result = resetActiveSharedViewDraft(draft, activeCollectionKey, activeSharedView.id);
      draft.lastActiveViews = result.draftState.lastActiveViews;
      draft.viewDrafts = result.draftState.viewDrafts;
      draft.viewOrderDrafts = result.draftState.viewOrderDrafts;
      draft.structureDrafts = result.draftState.structureDrafts;
      setViewDraftDirty(result.dirty);
    })) return;
    setLocalSharedViewDrafts((current) => {
      const result = resetActiveSharedViewDraft(current, activeCollectionKey, activeSharedView.id);
      writeLocalSharedViewDrafts(window.localStorage, result.draftState);
      setViewDraftDirty(result.dirty);
      return result.draftState;
    });
  }

  async function handleCreateTopLevelSharedView() {
    await handleCreateSharedView();
  }

  async function handleCreateSharedViewGroup() {
    if (commandSaving || !activeCollectionKey || !activeSharedView || !activeView) return;
    setCommandSaving(true);
    setStatus("");
    try {
      const result = createViewGroupConfig({
        sharedViewsConfig,
        collectionKey: activeCollectionKey,
        activeViewId: activeSharedView.id,
        activeViewSnapshot: activeView,
      });
      const nextConfig = result.config as SharedViewsConfig;
      await saveSharedViews(nextConfig, activeProjectId);
      commitSharedViewsConfig(nextConfig);
      const current = currentSharedViewDraftState();
      updateSharedViewDraftState({
        lastActiveViews: { ...current.lastActiveViews, [activeCollectionKey]: result.view.id },
        viewDrafts: { ...current.viewDrafts },
        viewOrderDrafts: { ...current.viewOrderDrafts },
        structureDrafts: { ...current.structureDrafts },
      });
      updatePageContextViewGrouping(window.localStorage, activeProjectId, {
        expandedGroupId: result.group.id,
        lastActiveViewIdByGroupId: {
          ...projectPageContext.lastActiveViewIdByGroupId,
          [result.group.id]: result.view.id,
        },
      });
      setStatus("已创建视图组");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setCommandSaving(false);
    }
  }

  async function handleCreateSharedViewInGroup(groupId: string) {
    if (commandSaving || !activeCollectionKey || !activeView) return;
    setCommandSaving(true);
    setStatus("");
    try {
      const result = createViewInGroupConfig({
        sharedViewsConfig,
        collectionKey: activeCollectionKey,
        groupId,
        activeViewSnapshot: activeView,
      });
      const nextConfig = result.config as SharedViewsConfig;
      await saveSharedViews(nextConfig, activeProjectId);
      commitSharedViewsConfig(nextConfig);
      const current = currentSharedViewDraftState();
      updateSharedViewDraftState({
        lastActiveViews: { ...current.lastActiveViews, [activeCollectionKey]: result.view.id },
        viewDrafts: { ...current.viewDrafts },
        viewOrderDrafts: { ...current.viewOrderDrafts },
        structureDrafts: { ...current.structureDrafts },
      });
      updatePageContextViewGrouping(window.localStorage, activeProjectId, {
        expandedGroupId: groupId,
        lastActiveViewIdByGroupId: {
          ...projectPageContext.lastActiveViewIdByGroupId,
          [groupId]: result.view.id,
        },
      });
      setStatus("已在组内创建视图");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setCommandSaving(false);
    }
  }

  async function handleRenameSharedViewGroup(groupId: string, name: string) {
    if (commandSaving || !activeCollectionKey) return;
    setCommandSaving(true);
    setStatus("");
    try {
      const nextConfig = renameViewGroupConfig({
        sharedViewsConfig,
        collectionKey: activeCollectionKey,
        groupId,
        name,
      }) as SharedViewsConfig;
      await saveSharedViews(nextConfig, activeProjectId);
      commitSharedViewsConfig(nextConfig);
      setStatus("已重命名视图组");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setCommandSaving(false);
    }
  }

  async function handleDeleteSharedViewGroup(groupId: string) {
    if (commandSaving || !activeCollectionKey) return;
    setCommandSaving(true);
    setStatus("");
    try {
      const nextConfig = deleteViewGroupConfig({
        sharedViewsConfig,
        collectionKey: activeCollectionKey,
        groupId,
      }) as SharedViewsConfig;
      await saveSharedViews(nextConfig, activeProjectId);
      commitSharedViewsConfig(nextConfig);
      const nextLastActiveViewIdByGroupId = { ...projectPageContext.lastActiveViewIdByGroupId };
      delete nextLastActiveViewIdByGroupId[groupId];
      updatePageContextViewGrouping(window.localStorage, activeProjectId, {
        expandedGroupId: projectPageContext.expandedGroupId === groupId ? null : projectPageContext.expandedGroupId,
        lastActiveViewIdByGroupId: nextLastActiveViewIdByGroupId,
      });
      setStatus("已删除视图组");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setCommandSaving(false);
    }
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
      commitSharedViewsConfig(nextConfig);
      updateSharedViewDraftState(result.draftState);
      setStatus("已保存当前团队共享视图");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setCommandSaving(false);
    }
  }

  async function publishCurrentSharedDraftsForModeSwitch() {
    const current = currentSharedViewDraftState();
    const collectionKeys = collectDraftCollectionKeys(current);
    if (!collectionKeys.length) return;
    let nextConfig = sharedViewsConfig;
    let nextDraftState = current;
    for (const collectionKey of collectionKeys) {
      const activeViewId = nextDraftState.lastActiveViews?.[collectionKey]
        ?? (collectionKey === activeCollectionKey ? activeSharedView?.id ?? null : null);
      if (!activeViewId) continue;
      const result = saveSharedViewDraftsToConfig(nextConfig, nextDraftState, collectionKey, activeViewId);
      nextConfig = result.config as SharedViewsConfig;
      nextDraftState = clearCollectionSharedDrafts(nextDraftState, collectionKey);
    }
    await saveSharedViews(nextConfig, activeProjectId);
      commitSharedViewsConfig(nextConfig);
    updateSharedViewDraftState(nextDraftState);
  }

  async function handleChangeSharedViewCollaborationMode(mode: "team" | "personal") {
    if (!selectedViewProfileName) return;
    const currentMode = resolveSharedViewCollaborationMode(selectedViewProfileName, selectedViewProfileRef.current);
    if (mode === currentMode) return;
    setCommandSaving(true);
    setStatus("");
    try {
      if (mode === "personal") {
        await publishCurrentSharedDraftsForModeSwitch();
      }
      const nextProfile = mutateSelectedViewProfile((draft) => {
        draft.sharedViewCollaborationMode = mode;
      });
      if (!nextProfile) return;
      await commitProfileSave(selectedViewProfileName, nextProfile);
      setSelectedViewProfile(nextProfile);
      selectedViewProfileRef.current = nextProfile;
      setStatus(mode === "personal" ? "已切换到个人模式" : "已切换到团队模式");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setCommandSaving(false);
    }
  }

  function handleRetrySharedViewDirectSave() {
    if (!sharedViewDirectSaveRetryRef.current) return;
    void sharedViewDirectSaveRetryRef.current().catch((error) => {
      setStatus("共享视图自动保存失败");
    });
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
    if (commandSavingRef.current || closingRef.current || rebuildingRef.current || restartingRef.current) return { outcome: "deferred" } as const;
    if (dirtyDomains.includes("document") && currentDataDirty && currentModel && isFormalSkillsDocumentPath(currentSelectedPath) && skillNodeContractEditorStateRef.current.contract) {
      const contractState = skillNodeContractEditorStateRef.current;
      const derivedRuleCheck = contractState.contract
        ? validateSkillNodeDerivedRuleConflicts(contractState.contract, currentModel.root)
        : { ok: true, issues: [] };
      if (!derivedRuleCheck.ok) {
        const firstIssue = derivedRuleCheck.issues[0];
        const remaining = derivedRuleCheck.issues.length - 1;
        const blockingMessage = `技能节点合同阻断保存：${firstIssue.skillId} 的 ${firstIssue.fieldPath}：${firstIssue.message}${remaining > 0 ? `（另有 ${remaining} 项冲突）` : ""}`;
        setStatus(blockingMessage);
        return {
          outcome: "blocked-confirmation",
          message: blockingMessage,
        } as const;
      }
      const saveCheck = contractState.canEdit && contractState.version != null && contractState.etag
        ? validateSkillNodeContractSaveToken({
          token: { version: contractState.version, etag: contractState.etag },
          documentRoot: currentModel.root,
          expectedVersion: contractState.version,
          expectedEtag: contractState.etag,
        })
        : {
          ok: false as const,
          code: "SKILL_NODE_CONTRACT_SAVE_BLOCKED",
          message: readErrorMessage(contractState.error) ?? `技能节点合同状态为 ${contractState.status}，禁止保存技能文档。`,
        };
      if (!saveCheck.ok) {
        const message = "message" in saveCheck ? String(saveCheck.message) : "技能节点合同校验失败。";
        const blockingMessage = `技能节点合同阻断保存：${message}`;
        setStatus(blockingMessage);
        return {
          outcome: "blocked-confirmation",
          message: blockingMessage,
        } as const;
      }
    }
    if (currentDataDirty && currentModel && currentSelectedPath && !currentPrimaryKeySyncPlan) {
      currentPrimaryKeySyncPlan = await resolvePrimaryKeySyncPlanForFlush(currentModel, currentSelectedPath, currentViewConfig);
    }
    if (currentDataDirty && currentModel && currentSelectedPath && shouldInterceptPrimaryKeySyncPlan(currentPrimaryKeySyncPlan, currentDataDirty, false)) {
      if (currentPrimaryKeySyncPlan?.blockingIssues.length) {
        const blockingMessage = describePrimaryKeySyncBlockingIssues(currentPrimaryKeySyncPlan);
        setStatus(blockingMessage);
        return {
          outcome: "blocked-confirmation",
          reason: "primary-key-blocking",
          message: blockingMessage,
        } as const;
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
      return {
        outcome: "blocked-confirmation",
        reason: "primary-key-confirmation",
        message: "当前改动需要先确认主键同步影响。",
      } as const;
    }
    autosaveInFlightRef.current = true;
    setStatus("");
    try {
      if (dirtyDomains.includes("document") && currentDataDirty && currentModel && currentSelectedPath) {
        const saveResult = await saveDocument(currentSelectedPath, currentModel.root, currentProjectId, currentModel.documentEtag);
        if (saveResult.documentEtag) currentModel.documentEtag = saveResult.documentEtag;
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
      if (!currentModel || !currentSelectedPath || commandSaving || closing || rebuilding || restarting) return;
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
    if (closing || commandSaving || rebuilding || restarting) return;
    const closeConfirmMessage = globalDirty
      ? "确认关闭服务？当前有未保存更改，关闭后这些更改会丢失。"
      : "确认关闭服务？关闭后需要重新打开才能继续使用编辑器。";
    if (!window.confirm(closeConfirmMessage)) return;
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
    if (rebuilding || restarting || closing || commandSaving) return;
    if (globalDirty && !window.confirm("有未保存更改，刷新构建会丢失这些更改。是否继续刷新构建？")) return;
    setRebuilding(true);
    setStatus("");
    setDisconnectMessage("");
    setServiceLifecycleState("recovering");
    try {
      flushActiveTextEditorDraft();
      await saveCoordinator.flush("flush");
      await rebuildFrontend();
      manualClosedRef.current = false;
      await shutdownServer();
      await recoverEditorService(bridgePortRef.current, { expectShutdownFirst: true });
      rememberTransientStatus("构建并重启成功，页面已刷新");
      window.location.reload();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`构建失败：${message}`);
      setRebuilding(false);
      setDisconnectMessage("");
      setServiceLifecycleState("running");
    }
  }

  async function handleRestartServer() {
    if (restarting || rebuilding || closing || commandSaving) return;
    if (globalDirty && !window.confirm("有未保存更改，重启服务会丢失这些更改。是否继续重启服务？")) return;
    setRestarting(true);
    setStatus("");
    setDisconnectMessage("");
    setServiceLifecycleState("recovering");
    try {
      flushActiveTextEditorDraft();
      await saveCoordinator.flush("flush");
      manualClosedRef.current = false;
      await shutdownServer();
      await recoverEditorService(bridgePortRef.current, { expectShutdownFirst: true });
      rememberTransientStatus("服务已重启，页面已刷新");
      window.location.reload();
    } catch (error) {
      setRestarting(false);
      setDisconnectMessage(error instanceof Error ? error.message : String(error));
      setServiceLifecycleState("disconnected");
    }
  }

  async function handleRecoverEditor() {
    if (closing || rebuilding || restarting || commandSaving) return;
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
          onOpenAddProject={() => setAddProjectOpen(true)}
          onOpenProjectSettings={() => setProjectSettingsOpen(true)}
          onOpenAutomationSettings={() => setAutomationSettingsOpen(true)}
        />
        <div className="sidebar-resize-handle" onPointerDown={beginSidebarResize} aria-label="调整左侧栏宽度" role="separator" />
        <section className="empty-state">{status || "Loading..."}</section>
        <ProjectSettingsDialog
          open={projectSettingsOpen}
          projects={projects}
          activeProjectId={activeProjectId}
          onOpenChange={setProjectSettingsOpen}
          onSaveProject={saveProjectSettings}
        />
        <AutomationSettingsDialog
          open={automationSettingsOpen}
          project={activeProject}
          files={files}
          profile={automationProfileState}
          bindings={automationBindingsState}
          favoriteIconIds={selectedViewProfile.favoriteSharedViewIconIds ?? []}
          favoritesEnabled={!!selectedViewProfileName}
          onToggleFavoriteIcon={handleToggleFavoriteSharedViewIcon}
          onOpenChange={setAutomationSettingsOpen}
          onSaved={(nextProfile, nextBindings) => {
            setAutomationProfileState(nextProfile);
            setAutomationBindingsState(nextBindings);
          }}
        />
        <AddProjectDialog
          open={addProjectOpen}
          onOpenChange={setAddProjectOpen}
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
        onOpenAddProject={() => setAddProjectOpen(true)}
        onOpenProjectSettings={() => setProjectSettingsOpen(true)}
        onOpenAutomationSettings={() => setAutomationSettingsOpen(true)}
      />
      <div className="sidebar-resize-handle" onPointerDown={beginSidebarResize} aria-label="调整左侧栏宽度" role="separator" />
      <section className="workspace">
        <Toolbar
          snapshot={toolbarSnapshot}
          onQueryChange={handleToolbarQueryChange}
          onSaveSharedViewPublish={() => void handleSaveViewForEveryone()}
          onChangeSharedViewCollaborationMode={(mode) => { void handleChangeSharedViewCollaborationMode(mode); }}
          onRetrySharedViewDirectSave={handleRetrySharedViewDirectSave}
          onRefreshBuild={handleRefreshBuild}
          onRestartServer={handleRestartServer}
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
                  activeProjectId={activeProjectId}
                  selectedPath={selectedPath}
                  collectionPath={collectionPath}
                  onSelectView={handleSelectSharedView}
                  onAddRow={handleAddRow}
                  onManualSave={() => void persistChanges()}
                  onCreateTopLevelView={handleCreateTopLevelSharedView}
                  onCreateViewGroup={handleCreateSharedViewGroup}
                  onCreateViewInGroup={handleCreateSharedViewInGroup}
                  onRenameGroup={handleRenameSharedViewGroup}
                  onDuplicateGroup={handleDuplicateSharedViewGroup}
                  onDeleteGroup={handleDeleteSharedViewGroup}
                  onRenameView={handleRenameSharedView}
                  onDeleteView={handleDeleteSharedView}
                  onDuplicateView={handleDuplicateSharedView}
                  onUpdateViewIcon={handleUpdateSharedViewIcon}
                  favoriteIconIds={selectedViewProfile.favoriteSharedViewIconIds ?? []}
                  favoritesEnabled={!!selectedViewProfileName}
                  onToggleFavoriteIcon={handleToggleFavoriteSharedViewIcon}
                  onReorderViews={handleReorderSharedViews}
                  onToggleFilterBar={() => setFilterBarVisible((value) => !value)}
                  onToggleTableTextEditMode={() => setTableTextEditMode((value) => !value)}
                  onSetDocumentFieldEnabled={setDocumentFieldEnabled}
                  onSaveDocumentRoot={handleSaveDocumentRoot}
                  onRefreshDocumentIndex={handleRefreshDocumentIndex}
                  protectedIconPackIds={protectedSharedViewIconPackIds}
                />
              </Profiler>
              {filterBarVisible ? (
                <Profiler id="view-filter-bar" onRender={handleDetailReorderProfilerRender}>
                  <ViewFilterBar
                    snapshot={viewFilterBarSnapshot}
                    onChangeFilters={(filters) => updateActiveViewDraft({ filters })}
                    onChangeSorts={(sorts) => updateActiveViewDraft({ sorts })}
                    onAddFilter={handleAddFilter}
                    onCreateFormalOption={handleCreateFormalFilterOption}
                    onAutoOpenRuleHandled={() => setPendingOpenFilterRuleId(null)}
                    onResetView={handleResetSharedViewDraft}
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
                  onOpenNestedDetail={openNestedDetailForRow}
                  onOpenBacklink={handleOpenBacklink}
                  onEditCell={handleTableEditCell}
                  onCommitMultiSelectDraft={handleTableCommitMultiSelectOptionFieldDraft}
                  onCommitSelectDraft={handleTableCommitSelectOptionFieldDraft}
                  onChangeFieldType={handleChangeFieldType}
                  onHideField={handleHideField}
                  onToggleWrapField={handleToggleWrapField}
                  onSetTitleField={handleSetTitleField}
                  onSetPrimaryKeyField={handleSetPrimaryKeyField}
                  onResizeField={handleResizeField}
                  onMoveField={handleMoveField}
                  onReorderFields={handleReorderFields}
                  onSort={handleSort}
                  onAddFilter={handleAddFilter}
                  onConfigureRelation={handleConfigureRelation}
                  onClearRelation={handleClearRelation}
                  onConfigureDocument={handleConfigureDocument}
                  onClearDocument={handleClearDocument}
                  onOpenRelationTarget={handleOpenRelationTarget}
                  onAddRow={handleAddRow}
                  onDuplicateRow={handleDuplicateRow}
                  onReorderRows={handleReorderRows}
                  onDeleteRow={handleDeleteRow}
                  onAddField={handleAddField}
                  onDeleteField={handleDeleteField}
                />
              </Profiler>
              <Profiler id="detail-panel" onRender={handleDetailReorderProfilerRender}>
                <DetailPanel
                  snapshot={detailSnapshot}
                  contractFormModel={skillNodeContractFormModel}
                  initialNestedTarget={initialNestedTarget}
                  onConsumeInitialNestedTarget={(requestKey) => {
                    setPendingNestedOpen((current) => current?.requestKey === requestKey ? null : current);
                  }}
                  onCommitMultiSelectDraft={(fieldName, patch) => selectedRowId && handleCommitMultiSelectOptionFieldDraftByRowId(selectedRowId, fieldName, patch)}
                  onCommitSelectDraft={(fieldName, patch) => selectedRowId && handleCommitSelectOptionFieldDraftByRowId(selectedRowId, fieldName, patch)}
                  onOpenBacklink={handleOpenBacklink}
                  onRequestSyncSave={() => void persistChanges(true)}
                  onClearEntryActionStatus={dismissEntryActionStatus}
                  onOpenRelationTarget={handleOpenRelationTarget}
                  onSelectRow={selectRowById}
                  onClose={() => setDetailOpen(false)}
                  onPanelWidthChange={handleDetailPanelWidthChange}
                  onPanelWidthCommit={commitDetailPanelWidth}
                  onToggleDocumentPanel={toggleDocumentPanel}
                  onCloseDocumentPanel={() => persistDetailDocumentPanelOpen(false)}
                  onDocumentPanelWidthChange={handleDetailDocumentPanelWidthChange}
                  onDocumentPanelWidthCommit={commitDetailDocumentPanelWidth}
                  onEditField={(fieldName, value) => selectedRowId && handleEditCellByRowId(selectedRowId, fieldName, value)}
                  onReorderFields={handleReorderDetailFields}
                  onRunEntryAction={(actionId) => void handleRunDetailEntryAction(actionId)}
                  onRegisterActiveTextEditor={registerActiveTextEditor}
                />
              </Profiler>
            </div>
          </Profiler>
        ) : (
          <div className="main-content">
            <ViewTabs
              snapshot={viewTabsSnapshot}
              activeProjectId={activeProjectId}
              selectedPath={selectedPath}
              collectionPath={collectionPath}
              onSelectView={handleSelectSharedView}
              onAddRow={handleAddRow}
              onManualSave={() => void persistChanges()}
              onCreateTopLevelView={handleCreateTopLevelSharedView}
              onCreateViewGroup={handleCreateSharedViewGroup}
              onCreateViewInGroup={handleCreateSharedViewInGroup}
              onRenameGroup={handleRenameSharedViewGroup}
              onDuplicateGroup={handleDuplicateSharedViewGroup}
              onDeleteGroup={handleDeleteSharedViewGroup}
              onRenameView={handleRenameSharedView}
              onDeleteView={handleDeleteSharedView}
              onDuplicateView={handleDuplicateSharedView}
              onUpdateViewIcon={handleUpdateSharedViewIcon}
              favoriteIconIds={selectedViewProfile.favoriteSharedViewIconIds ?? []}
              favoritesEnabled={!!selectedViewProfileName}
              onToggleFavoriteIcon={handleToggleFavoriteSharedViewIcon}
              onReorderViews={handleReorderSharedViews}
              onToggleFilterBar={() => setFilterBarVisible((value) => !value)}
              onToggleTableTextEditMode={() => setTableTextEditMode((value) => !value)}
              onSetDocumentFieldEnabled={setDocumentFieldEnabled}
              onSaveDocumentRoot={handleSaveDocumentRoot}
              onRefreshDocumentIndex={handleRefreshDocumentIndex}
              protectedIconPackIds={protectedSharedViewIconPackIds}
            />
            {filterBarVisible ? (
              <ViewFilterBar
                snapshot={viewFilterBarSnapshot}
                onChangeFilters={(filters) => updateActiveViewDraft({ filters })}
                onChangeSorts={(sorts) => updateActiveViewDraft({ sorts })}
                onAddFilter={handleAddFilter}
                onCreateFormalOption={handleCreateFormalFilterOption}
                onAutoOpenRuleHandled={() => setPendingOpenFilterRuleId(null)}
                onResetView={handleResetSharedViewDraft}
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
              onOpenNestedDetail={openNestedDetailForRow}
              onOpenBacklink={handleOpenBacklink}
              onEditCell={handleTableEditCell}
              onCommitMultiSelectDraft={handleTableCommitMultiSelectOptionFieldDraft}
              onCommitSelectDraft={handleTableCommitSelectOptionFieldDraft}
              onChangeFieldType={handleChangeFieldType}
              onHideField={handleHideField}
              onToggleWrapField={handleToggleWrapField}
              onSetTitleField={handleSetTitleField}
              onSetPrimaryKeyField={handleSetPrimaryKeyField}
              onResizeField={handleResizeField}
              onMoveField={handleMoveField}
              onReorderFields={handleReorderFields}
              onSort={handleSort}
              onAddFilter={handleAddFilter}
              onConfigureRelation={handleConfigureRelation}
              onClearRelation={handleClearRelation}
              onConfigureDocument={handleConfigureDocument}
              onClearDocument={handleClearDocument}
              onOpenRelationTarget={handleOpenRelationTarget}
              onAddRow={handleAddRow}
              onDuplicateRow={handleDuplicateRow}
              onReorderRows={handleReorderRows}
              onDeleteRow={handleDeleteRow}
              onAddField={handleAddField}
              onDeleteField={handleDeleteField}
            />
            <DetailPanel
              snapshot={detailSnapshot}
              contractFormModel={skillNodeContractFormModel}
              initialNestedTarget={initialNestedTarget}
              onConsumeInitialNestedTarget={(requestKey) => {
                setPendingNestedOpen((current) => current?.requestKey === requestKey ? null : current);
              }}
              onCommitMultiSelectDraft={(fieldName, patch) => selectedRowId && handleCommitMultiSelectOptionFieldDraftByRowId(selectedRowId, fieldName, patch)}
              onCommitSelectDraft={(fieldName, patch) => selectedRowId && handleCommitSelectOptionFieldDraftByRowId(selectedRowId, fieldName, patch)}
              onOpenBacklink={handleOpenBacklink}
              onRequestSyncSave={() => void persistChanges(true)}
              onClearEntryActionStatus={dismissEntryActionStatus}
              onOpenRelationTarget={handleOpenRelationTarget}
              onSelectRow={selectRowById}
              onClose={() => setDetailOpen(false)}
              onPanelWidthChange={handleDetailPanelWidthChange}
              onPanelWidthCommit={commitDetailPanelWidth}
              onToggleDocumentPanel={toggleDocumentPanel}
              onCloseDocumentPanel={() => persistDetailDocumentPanelOpen(false)}
              onDocumentPanelWidthChange={handleDetailDocumentPanelWidthChange}
              onDocumentPanelWidthCommit={commitDetailDocumentPanelWidth}
              onEditField={(fieldName, value) => selectedRowId && handleEditCellByRowId(selectedRowId, fieldName, value)}
              onReorderFields={handleReorderDetailFields}
              onRunEntryAction={(actionId) => void handleRunDetailEntryAction(actionId)}
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
      <DocumentFieldConfigDialog
        open={documentConfigField != null}
        fieldName={documentConfigField}
        sourcePath={selectedPath}
        docRoot={selectedPath ? (viewConfig.documentFiles[selectedPath]?.docRoot ?? null) : null}
        enabled={documentFieldConfigEnabled}
        onOpenChange={(open) => !open && setDocumentConfigField(null)}
        onConfirm={confirmDocumentFieldConfig}
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
      />
      <AutomationSettingsDialog
        open={automationSettingsOpen}
        project={activeProject}
        files={files}
        profile={automationProfileState}
        bindings={automationBindingsState}
        favoriteIconIds={selectedViewProfile.favoriteSharedViewIconIds ?? []}
        favoritesEnabled={!!selectedViewProfileName}
        onToggleFavoriteIcon={handleToggleFavoriteSharedViewIcon}
        onOpenChange={setAutomationSettingsOpen}
        onSaved={(nextProfile, nextBindings) => {
          setAutomationProfileState(nextProfile);
          setAutomationBindingsState(nextBindings);
        }}
      />
      <AddProjectDialog
        open={addProjectOpen}
        onOpenChange={setAddProjectOpen}
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
                    {["Text", "Select", "Document"].map((type) => (
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
}) {
  const activeProject = props.projects.find((project) => project.id === props.activeProjectId) ?? null;
  const [name, setName] = useState("");
  const [root, setRoot] = useState("");
  const [sourcesText, setSourcesText] = useState("");

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
                  rows={Math.min(8, Math.max(3, activeProject.dataSources.length + 1))}
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
          <div className="dialog-actions">
            <Dialog.Close className="primary-button">Close</Dialog.Close>
            <button className="primary-button" disabled={!activeProject} onClick={saveCurrentProject} type="button">Save Project</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function AutomationSettingsDialog(props: {
  open: boolean;
  project: ProjectDefinition | null;
  files: DataFile[];
  profile: UserAutomationProfile;
  bindings: DeviceEntryActionBindings;
  favoriteIconIds: SharedViewIconId[];
  favoritesEnabled: boolean;
  onToggleFavoriteIcon: (iconId: SharedViewIconId) => void;
  onOpenChange: (open: boolean) => void;
  onSaved: (profile: UserAutomationProfile, bindings: DeviceEntryActionBindings) => void;
}) {
  const [profile, setProfile] = useState<UserAutomationProfile>(props.profile);
  const [bindings, setBindings] = useState<DeviceEntryActionBindings>(props.bindings);
  const [targetCatalog, setTargetCatalog] = useState<AutomationTargetCatalogItem[]>([]);
  const [targetCatalogLoading, setTargetCatalogLoading] = useState(false);
  const [targetCatalogError, setTargetCatalogError] = useState<string | null>(null);
  const [skillCatalog, setSkillCatalog] = useState<AutomationSkillCatalog>({ provider: "codex", loadedAt: "", skills: [] });
  const [skillCatalogLoading, setSkillCatalogLoading] = useState(false);
  const [skillCatalogError, setSkillCatalogError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadedProjectId, setLoadedProjectId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [selectedRuleIndex, setSelectedRuleIndex] = useState<number | null>(null);
  const [iconPickerOpenRuleId, setIconPickerOpenRuleId] = useState<string | null>(null);
  const [skillPickerOpenRuleId, setSkillPickerOpenRuleId] = useState<string | null>(null);
  const [skillPickerQuery, setSkillPickerQuery] = useState("");
  const [targetPickerOpenId, setTargetPickerOpenId] = useState<string | null>(null);
  const [targetPickerQuery, setTargetPickerQuery] = useState("");
  const [ruleSearchQuery, setRuleSearchQuery] = useState("");
  const [, setAutomationIconPackVersion] = useState(0);
  const profileRef = useRef(profile);
  const bindingsRef = useRef(bindings);
  const commitProfile = useCallback((updater: UserAutomationProfile | ((current: UserAutomationProfile) => UserAutomationProfile)) => {
    const current = profileRef.current;
    const next = typeof updater === "function"
      ? (updater as (current: UserAutomationProfile) => UserAutomationProfile)(current)
      : updater;
    profileRef.current = next;
    setProfile(next);
  }, []);
  const commitBindings = useCallback((updater: DeviceEntryActionBindings | ((current: DeviceEntryActionBindings) => DeviceEntryActionBindings)) => {
    const current = bindingsRef.current;
    const next = typeof updater === "function"
      ? (updater as (current: DeviceEntryActionBindings) => DeviceEntryActionBindings)(current)
      : updater;
    bindingsRef.current = next;
    setBindings(next);
  }, []);
  const rules = profile.rules;
  const filteredRuleIndexes = useMemo(() => {
    const query = ruleSearchQuery.trim().toLowerCase();
    if (!query) return rules.map((_, index) => index);
    return rules.flatMap((rule, index) => {
      const binding = bindings.bindings[rule.id];
      const label = rule.label.trim().toLowerCase();
      const ruleId = rule.id.trim().toLowerCase();
      const skill = binding?.skill?.trim().toLowerCase() ?? "";
      return label.includes(query) || ruleId.includes(query) || skill.includes(query) ? [index] : [];
    });
  }, [bindings.bindings, ruleSearchQuery, rules]);
  const targetCatalogByFile = useMemo(
    () => Object.fromEntries(targetCatalog.map((item) => [item.file, item])) as Record<string, AutomationTargetCatalogItem>,
    [targetCatalog],
  );

  useEffect(() => {
    if (!props.open) return;
    commitProfile(props.profile);
    commitBindings(pruneOrphanAutomationRuleBindings(
      props.bindings,
      props.profile.rules.map((rule) => rule.id),
    ));
    setSelectedRuleIndex((current) => normalizeAutomationRuleSelection(current, props.profile.rules.length));
  }, [commitBindings, commitProfile, props.open, props.profile, props.bindings]);

  useEffect(() => {
    if (props.open) return;
    setSelectedRuleIndex(null);
    setIconPickerOpenRuleId(null);
    setSkillPickerOpenRuleId(null);
    setSkillPickerQuery("");
    setTargetPickerOpenId(null);
    setTargetPickerQuery("");
    setRuleSearchQuery("");
  }, [props.open]);

  useEffect(() => {
    setSelectedRuleIndex((current) => normalizeAutomationRuleSelection(current, rules.length));
  }, [rules.length]);

  useEffect(() => {
    setSelectedRuleIndex((current) => normalizeVisibleAutomationRuleSelection(
      current,
      filteredRuleIndexes,
      Boolean(ruleSearchQuery.trim()),
    ));
  }, [filteredRuleIndexes, ruleSearchQuery]);

  const refreshSkillCatalog = useCallback(async (projectId: string) => {
    setSkillCatalogLoading(true);
    setSkillCatalogError(null);
    try {
      const nextCatalog = await loadAutomationSkillCatalog(projectId);
      setSkillCatalog(nextCatalog);
    } catch (catalogError) {
      setSkillCatalogError(catalogError instanceof Error ? catalogError.message : String(catalogError));
    } finally {
      setSkillCatalogLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!props.open || !props.project?.id) return;
    let cancelled = false;
    setLoading(true);
    setLoadedProjectId((current) => (current === props.project!.id ? current : null));
    setError(null);
    setSaveMessage(null);
    Promise.all([
      loadAutomationProfile(props.project.id),
      loadAutomationBindings(props.project.id),
    ])
      .then(([nextProfile, nextBindings]) => {
        if (cancelled) return;
        commitProfile(nextProfile);
        commitBindings(pruneOrphanAutomationRuleBindings(
          nextBindings,
          nextProfile.rules.map((rule) => rule.id),
        ));
        setLoadedProjectId(props.project!.id);
      })
      .catch((loadError) => {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [props.open, props.project?.id]);

  useEffect(() => {
    if (!props.open || !props.project?.id) return;
    void refreshSkillCatalog(props.project.id);
  }, [props.open, props.project?.id, refreshSkillCatalog]);

  useEffect(() => {
    if (!props.open || !props.project?.id) return;
    let cancelled = false;
    setTargetCatalogLoading(true);
    setTargetCatalogError(null);
    Promise.all(props.files.map(async (file) => {
      try {
        const model = await loadDocument(file.path, props.project!.id) as DocumentModel;
        return {
          file: file.path,
          label: file.displayPath ?? file.path,
          collections: model.collections.map((collection) => collection.path),
          error: null,
        };
      } catch (catalogError) {
        return {
          file: file.path,
          label: file.displayPath ?? file.path,
          collections: [],
          error: catalogError instanceof Error ? catalogError.message : String(catalogError),
        };
      }
    }))
      .then((items) => {
        if (cancelled) return;
        setTargetCatalog(items.map((item) => ({
          file: item.file,
          label: item.label,
          collections: item.collections,
        })));
        const failedCount = items.filter((item) => item.error).length;
        setTargetCatalogError(failedCount ? `有 ${failedCount} 个文件未能读取可选集合，仍可继续编辑已加载的目标。` : null);
      })
      .finally(() => {
        if (!cancelled) setTargetCatalogLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [props.open, props.project?.id, props.files]);

  const controlsDisabled = saving || loading || !props.project || loadedProjectId !== props.project.id || loadedProjectId === null;
  const skillCatalogMap = useMemo(
    () => new Map(skillCatalog.skills.map((item) => [item.id, item])),
    [skillCatalog.skills],
  );
  const bindingDefaults = bindings.defaults ?? {};
  const effectiveBindingDefaultModel = bindingDefaults.model?.trim() || defaultAutomationRuntime.model;
  const effectiveBindingDefaultReasoning = bindingDefaults.reasoning ?? defaultAutomationRuntime.reasoning;
  const effectiveBindingDefaultVerbosity = bindingDefaults.verbosity ?? defaultAutomationRuntime.verbosity;
  const effectiveBindingDefaultTimeoutMs = bindingDefaults.timeoutMs ?? defaultAutomationRuntime.timeoutMs;
  const bindingDefaultModelOptions = useMemo(
    () => buildAutomationModelOptions(bindingDefaults.model),
    [bindingDefaults.model],
  );
  const activeRules = rules.filter((rule) => rule.enabled);
  const bindingCounts = activeRules.reduce((summary, rule) => {
    const binding = bindings.bindings[rule.id];
    const bindingStatus = bindings.bindingStatuses?.[rule.id];
    if (!binding) {
      summary.missing += 1;
      return summary;
    }
    if (!binding.enabled || !binding.skill.trim() || bindingStatus?.status === "invalid") {
      summary.invalid += 1;
      return summary;
    }
    summary.ready += 1;
    return summary;
  }, { ready: 0, missing: 0, invalid: 0 });
  const validationIssues = useMemo(
    () => validateAutomationSettings(profile, bindings),
    [profile, bindings],
  );
  const validationIssuesByRuleId = useMemo(
    () => buildAutomationValidationIssuesByRuleId(profile, bindings),
    [profile, bindings],
  );
  const protectedIconPackIds = useMemo(
    () => collectProtectedIconPackIdsFromIcons(
      rules
        .map((rule) => rule.icon?.trim())
        .filter((iconId): iconId is SharedViewIconId => !!iconId),
    ),
    [rules],
  );

  useEffect(() => {
    if (!protectedIconPackIds.length) return;
    const missingPackIds = protectedIconPackIds.filter((packId) => !isSharedViewIconPackLoaded(packId as any));
    if (!missingPackIds.length) return;
    let cancelled = false;
    void (async () => {
      await Promise.all(missingPackIds.map((packId) => loadSharedViewIconPack(packId as any)));
      if (!cancelled) {
        setAutomationIconPackVersion((current) => current + 1);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [protectedIconPackIds]);

  function renderRuleIcon(iconId: SharedViewIconId, size = 18) {
    const IconComponent = readSharedViewIconComponent(iconId) ?? sharedViewFallbackIcon;
    return <IconComponent size={size} />;
  }

  function updateRule(index: number, nextRule: EntryActionRule) {
    commitProfile((current) => {
      if (!current.rules[index]) return current;
      return {
        rules: current.rules.map((rule, currentIndex) => (currentIndex === index ? nextRule : rule)),
      };
    });
  }

  function updateRuleWith(index: number, updater: (rule: EntryActionRule) => EntryActionRule) {
    commitProfile((current) => {
      const rule = current.rules[index];
      if (!rule) return current;
      return {
        rules: current.rules.map((currentRule, currentIndex) => (
          currentIndex === index ? updater(rule) : currentRule
        )),
      };
    });
  }

  function updateRuleField<K extends keyof EntryActionRule>(index: number, field: K, value: EntryActionRule[K]) {
    updateRuleWith(index, (rule) => ({ ...rule, [field]: value }));
  }

  function updateRuleRuntimeField(index: number, field: "model" | "timeoutMs", value: string) {
    updateRuleWith(index, (rule) => {
      const nextRuntime = { ...(rule.runtime ?? {}) };
      if (field === "model") {
        const normalized = value.trim();
        if (normalized) nextRuntime.model = normalized;
        else delete nextRuntime.model;
      } else {
        const normalized = value.trim();
        if (!normalized) delete nextRuntime.timeoutMs;
        else {
          const parsed = Number(normalized);
          nextRuntime.timeoutMs = Number.isInteger(parsed) ? parsed : Number.NaN;
        }
      }
      return {
        ...rule,
        runtime: nextRuntime.model == null && nextRuntime.reasoning == null && nextRuntime.verbosity == null && nextRuntime.timeoutMs == null
          ? undefined
          : nextRuntime,
      };
    });
  }

  function updateRuleRuntimeSelectField(index: number, field: "reasoning" | "verbosity", value: string) {
    updateRuleWith(index, (rule) => {
      const nextRuntime = { ...(rule.runtime ?? {}) };
      if (!value.trim()) {
        delete nextRuntime[field];
      } else {
        nextRuntime[field] = value as never;
      }
      return {
        ...rule,
        runtime: nextRuntime.model == null && nextRuntime.reasoning == null && nextRuntime.verbosity == null && nextRuntime.timeoutMs == null
          ? undefined
          : nextRuntime,
      };
    });
  }

  function updateRuleTargets(index: number, nextTargets: EntryActionTarget[]) {
    updateRuleWith(index, (rule) => ({
      ...rule,
      targets: nextTargets,
    }));
  }

  function addRuleTarget(index: number) {
    const file = targetCatalog[0]?.file ?? "";
    const collection = resolveTargetCollectionOptions(targetCatalogByFile, file)[0] ?? "$";
    updateRuleWith(index, (rule) => ({
      ...rule,
      targets: [...rule.targets, { file, collection }],
    }));
  }

  function removeRuleTarget(index: number, targetIndex: number) {
    updateRuleWith(index, (rule) => ({
      ...rule,
      targets: rule.targets.filter((_, currentIndex) => currentIndex !== targetIndex),
    }));
  }

  function updateRuleTargetFile(index: number, targetIndex: number, file: string) {
    updateRuleWith(index, (rule) => ({
      ...rule,
      targets: rule.targets.map((target, currentIndex) => {
        if (currentIndex !== targetIndex) return target;
        const collectionOptions = resolveTargetCollectionOptions(targetCatalogByFile, file, target.collection);
        return {
          ...target,
          file,
          collection: collectionOptions[0] ?? target.collection,
        };
      }),
    }));
  }

  function updateRuleTargetCollection(index: number, targetIndex: number, collection: string) {
    updateRuleWith(index, (rule) => ({
      ...rule,
      targets: rule.targets.map((target, currentIndex) => (
        currentIndex === targetIndex ? { ...target, collection } : target
      )),
    }));
  }

  function updateRuleTargetTextArtifact(index: number, targetIndex: number, enabled: boolean) {
    updateRuleWith(index, (rule) => ({
      ...rule,
      targets: rule.targets.map((target, currentIndex) => {
        if (currentIndex !== targetIndex) return target;
        if (!enabled) {
          const { textArtifact: _textArtifact, ...nextTarget } = target;
          return nextTarget;
        }
        return {
          ...target,
          textArtifact: target.textArtifact ?? {
            pathTemplate: "docs/{value}.md",
            sourceField: "id",
            allowCreate: true,
            allowUpdate: true,
            maxBytes: 131072,
          },
        };
      }),
    }));
  }

  function updateRuleTargetTextArtifactField(index: number, targetIndex: number, field: keyof NonNullable<EntryActionTarget["textArtifact"]>, value: string | boolean | number) {
    updateRuleWith(index, (rule) => ({
      ...rule,
      targets: rule.targets.map((target, currentIndex) => (
        currentIndex === targetIndex && target.textArtifact
          ? { ...target, textArtifact: { ...target.textArtifact, [field]: value } }
          : target
      )),
    }));
  }

  function buildTargetPickerId(targetIndex: number, kind: "file" | "collection") {
    return `${kind}:${targetIndex}`;
  }

  function updateRuleId(index: number, nextIdRaw: string) {
    const rule = profileRef.current.rules[index];
    if (!rule) return;
    const nextId = nextIdRaw.trim();
    const previousId = rule.id;
    updateRule(index, { ...rule, id: nextId });
    if (previousId === nextId) return;
    commitBindings(remapAutomationRuleBindingKey(bindingsRef.current, previousId, nextId));
  }

  function updateBinding(ruleId: string, nextBinding: EntryActionBinding) {
    commitBindings((current) => ({
      ...current,
      bindings: {
        ...current.bindings,
        [ruleId]: nextBinding,
      },
    }));
  }

  function updateBindingDefaultsField(field: "model" | "timeoutMs", value: string) {
    commitBindings((current) => {
      const nextDefaults = { ...(current.defaults ?? {}) };
      if (field === "model") {
        const normalized = value.trim();
        if (normalized) nextDefaults.model = normalized;
        else delete nextDefaults.model;
      } else {
        const normalized = value.trim();
        if (!normalized) delete nextDefaults.timeoutMs;
        else {
          const parsed = Number(normalized);
          nextDefaults.timeoutMs = Number.isInteger(parsed) ? parsed : Number.NaN;
        }
      }
      return { ...current, defaults: nextDefaults };
    });
  }

  function updateBindingDefaultsSelectField(field: "reasoning" | "verbosity", value: string) {
    commitBindings((current) => {
      const nextDefaults = { ...(current.defaults ?? {}) };
      if (!value.trim()) delete nextDefaults[field];
      else nextDefaults[field] = value as never;
      return { ...current, defaults: nextDefaults };
    });
  }

  function removeRule(index: number) {
    const rule = rules[index];
    const nextSelectedRuleIndex = automationRuleSelectionAfterRemoval(selectedRuleIndex, index, rules.length);
    commitProfile((current) => ({
      rules: current.rules.filter((_, currentIndex) => currentIndex !== index),
    }));
    setSelectedRuleIndex(nextSelectedRuleIndex);
    if (!rule) return;
    commitBindings(removeAutomationRuleBinding(bindingsRef.current, rule.id));
  }

  function addRule() {
    const nextIdBase = "action";
    let nextId = `${nextIdBase}-${rules.length + 1}`;
    let counter = rules.length + 1;
    const existingIds = new Set(rules.map((rule) => rule.id));
    while (existingIds.has(nextId)) {
      counter += 1;
      nextId = `${nextIdBase}-${counter}`;
    }
    commitProfile((current) => ({
      rules: [
        ...current.rules,
        {
          id: nextId,
          label: "",
          icon: "wand",
          enabled: true,
          targets: [],
          payload: {
            includeRow: true,
            includeNeighbors: false,
          },
        },
      ],
    }));
    commitBindings((current) => ({
      ...current,
      bindings: {
        ...current.bindings,
        [nextId]: {
          provider: "codex",
          skill: "",
          enabled: true,
        },
      },
    }));
    setSelectedRuleIndex(rules.length);
  }

  async function saveAutomationSettings() {
    if (!props.project?.id) return;
    const latestProfile = profileRef.current;
    const latestBindings = pruneOrphanAutomationRuleBindings(
      bindingsRef.current,
      latestProfile.rules.map((rule) => rule.id),
    );
    commitBindings(latestBindings);
    const latestValidationIssues = validateAutomationSettings(latestProfile, latestBindings);
    if (latestValidationIssues.length > 0) {
      setError("请先修正自动化设置中的校验问题，再保存。");
      setSaveMessage(null);
      return;
    }
    setSaving(true);
    setError(null);
    setSaveMessage(null);
    try {
      await validateAutomationBindings(latestBindings, props.project.id);
      try {
        await saveAutomationProfile(latestProfile, props.project.id);
      } catch (profileSaveError) {
        throw new Error(`规则配置保存失败：${profileSaveError instanceof Error ? profileSaveError.message : String(profileSaveError)}`);
      }
      try {
        await saveAutomationBindings(latestBindings, props.project.id);
      } catch (bindingsSaveError) {
        throw new Error(`本机默认配置保存失败：${bindingsSaveError instanceof Error ? bindingsSaveError.message : String(bindingsSaveError)}`);
      }
      const refreshedBindings = await loadAutomationBindings(props.project.id);
      commitBindings(refreshedBindings);
      props.onSaved(latestProfile, refreshedBindings);
      setSaveMessage("自动化设置已保存。");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content automation-settings-dialog">
          <Dialog.Title>自动化设置</Dialog.Title>
          <div className="automation-settings-frame">
            {props.project ? (
              <div className="automation-settings">
                <div className="automation-settings-overview">
                  <div className="automation-settings-summary">
                    <div className="automation-settings-summary__title">
                      <strong>{props.project.name}</strong>
                      <small>当前项目的个人自动化入口与本机绑定</small>
                    </div>
                    <div className="automation-settings-summary__stats" aria-label="自动化配置摘要">
                      <span className="automation-stat-chip">{rules.length} 条规则</span>
                      <span className="automation-stat-chip ok">{bindingCounts.ready} 条绑定就绪</span>
                      <span className="automation-stat-chip">{bindingCounts.missing} 条缺失</span>
                      <span className="automation-stat-chip warn">{bindingCounts.invalid} 条无效</span>
                    </div>
                  </div>
                  <div className="automation-storage-note">
                    <strong>存储位置</strong>
                    <small>规则保存在个人自动化配置档；本机技能绑定与默认运行参数保存在项目本地 `.data-editor/local/automation-bindings.json`。</small>
                  </div>
                </div>
                <div className="automation-rule-section">
                  <div className="automation-rule-section__label">本机默认运行参数</div>
                  <div className="automation-rule-grid">
                    <label className="dialog-field">
                      <span>默认模型</span>
                      <Select.Root
                        value={bindingDefaults.model ?? automationRuntimeInheritValue}
                        onValueChange={(value) => updateBindingDefaultsField("model", value === automationRuntimeInheritValue ? "" : value)}
                      >
                        <Select.Trigger className="select-trigger" disabled={controlsDisabled}>
                          <Select.Value placeholder={buildAutomationInheritedOptionLabel("系统默认", defaultAutomationRuntime.model)} />
                          <Select.Icon asChild><icons.chevronDown size={16} /></Select.Icon>
                        </Select.Trigger>
                        <Select.Portal>
                          <Select.Content className="menu-content select-content" position="popper" sideOffset={6}>
                            <Select.Viewport>
                              <Select.Item className="menu-item" value={automationRuntimeInheritValue}><Select.ItemText>{buildAutomationInheritedOptionLabel("系统默认", defaultAutomationRuntime.model)}</Select.ItemText></Select.Item>
                              {bindingDefaultModelOptions.map((option) => (
                                <Select.Item className="menu-item" key={option.value} value={option.value}><Select.ItemText>{option.label}</Select.ItemText></Select.Item>
                              ))}
                            </Select.Viewport>
                          </Select.Content>
                        </Select.Portal>
                      </Select.Root>
                    </label>
                    <label className="dialog-field">
                      <span>默认推理强度</span>
                      <Select.Root
                        value={bindingDefaults.reasoning ?? automationRuntimeInheritValue}
                        onValueChange={(value) => updateBindingDefaultsSelectField("reasoning", value === automationRuntimeInheritValue ? "" : value)}
                      >
                        <Select.Trigger className="select-trigger" disabled={controlsDisabled}>
                          <Select.Value placeholder={buildAutomationInheritedOptionLabel("系统默认", defaultAutomationRuntime.reasoning)} />
                          <Select.Icon asChild><icons.chevronDown size={16} /></Select.Icon>
                        </Select.Trigger>
                        <Select.Portal>
                          <Select.Content className="menu-content select-content" position="popper" sideOffset={6}>
                            <Select.Viewport>
                              <Select.Item className="menu-item" value={automationRuntimeInheritValue}><Select.ItemText>{buildAutomationInheritedOptionLabel("系统默认", defaultAutomationRuntime.reasoning)}</Select.ItemText></Select.Item>
                              {["none", "low", "medium", "high", "xhigh"].map((value) => (
                                <Select.Item className="menu-item" key={value} value={value}><Select.ItemText>{value}</Select.ItemText></Select.Item>
                              ))}
                            </Select.Viewport>
                          </Select.Content>
                        </Select.Portal>
                      </Select.Root>
                    </label>
                    <label className="dialog-field">
                      <span>默认输出详略</span>
                      <Select.Root
                        value={bindingDefaults.verbosity ?? automationRuntimeInheritValue}
                        onValueChange={(value) => updateBindingDefaultsSelectField("verbosity", value === automationRuntimeInheritValue ? "" : value)}
                      >
                        <Select.Trigger className="select-trigger" disabled={controlsDisabled}>
                          <Select.Value placeholder={buildAutomationInheritedOptionLabel("系统默认", defaultAutomationRuntime.verbosity)} />
                          <Select.Icon asChild><icons.chevronDown size={16} /></Select.Icon>
                        </Select.Trigger>
                        <Select.Portal>
                          <Select.Content className="menu-content select-content" position="popper" sideOffset={6}>
                            <Select.Viewport>
                              <Select.Item className="menu-item" value={automationRuntimeInheritValue}><Select.ItemText>{buildAutomationInheritedOptionLabel("系统默认", defaultAutomationRuntime.verbosity)}</Select.ItemText></Select.Item>
                              {["low", "medium", "high"].map((value) => (
                                <Select.Item className="menu-item" key={value} value={value}><Select.ItemText>{value}</Select.ItemText></Select.Item>
                              ))}
                            </Select.Viewport>
                          </Select.Content>
                        </Select.Portal>
                      </Select.Root>
                    </label>
                    <label className="dialog-field">
                      <span>默认超时（毫秒）</span>
                      <input
                        value={bindingDefaults.timeoutMs == null ? "" : String(bindingDefaults.timeoutMs)}
                        onChange={(event) => updateBindingDefaultsField("timeoutMs", event.target.value)}
                        placeholder={`留空使用系统默认 ${defaultAutomationRuntime.timeoutMs}`}
                        inputMode="numeric"
                        disabled={controlsDisabled}
                      />
                    </label>
                  </div>
                  <small>模型使用 `-m` 下发；推理强度与输出详略会通过 Codex CLI 的 config override 下发。</small>
                </div>
                {skillCatalogError ? <div className="dialog-help">{skillCatalogError}</div> : null}
                {loading ? <div className="automation-settings-loading">正在加载自动化设置...</div> : null}
                <div className="automation-settings-header">
                  <div className="automation-settings-header__title">
                    <div className="sidebar-label">规则列表</div>
                    <small>{rules.length ? "按动作规则逐条配置入口、目标范围和本机绑定" : "先新增一条动作规则，再继续填写字段与绑定"}</small>
                  </div>
                  <button className="automation-add-rule-button" disabled={controlsDisabled} onClick={addRule} type="button">
                    <icons.addField size={16} />
                    <span>新增动作</span>
                  </button>
                </div>
                {rules.length ? (
                  <div className="automation-rules-shell">
                    <div className="automation-rule-nav-panel">
                      <label className="automation-rule-nav-search">
                        <icons.search size={14} />
                        <input
                          type="text"
                          value={ruleSearchQuery}
                          onChange={(event) => setRuleSearchQuery(event.target.value)}
                          placeholder="搜索规则名称、Rule Id 或技能"
                        />
                      </label>
                      <div className="automation-rule-nav">
                        {filteredRuleIndexes.length ? filteredRuleIndexes.map((ruleIndex) => {
                          const rule = rules[ruleIndex];
                          const binding = bindings.bindings[rule.id] ?? {
                            provider: "codex" as const,
                            skill: "",
                            enabled: true,
                          };
                          const bindingStatus = bindings.bindingStatuses?.[rule.id];
                          const issueCount = (
                            validationIssuesByRuleId[rule.id]
                            ?? validationIssuesByRuleId[`__index_${ruleIndex}`]
                            ?? []
                          ).length;
                          const skillUiState = resolveAutomationSkillUiState(binding, bindingStatus, skillCatalogMap);
                          const isSelected = ruleIndex === selectedRuleIndex;
                          return (
                            <button
                              key={`rule-nav-${ruleIndex}`}
                              type="button"
                              className={`automation-rule-nav-item ${isSelected ? "is-selected" : ""}`}
                              onClick={() => setSelectedRuleIndex(ruleIndex)}
                            >
                              <span className="automation-rule-nav-item__icon" data-view-icon={rule.icon || sharedViewDefaultIconId}>
                                {renderRuleIcon((rule.icon || sharedViewDefaultIconId) as SharedViewIconId, 16)}
                              </span>
                              <span className="automation-rule-nav-item__body">
                                <strong>{rule.label || rule.id || `动作 ${ruleIndex + 1}`}</strong>
                                <small>{binding.skill.trim() || "未选择技能"}</small>
                              </span>
                              <span className="automation-rule-nav-item__meta">
                                <span className={`automation-rule-nav-item__status automation-rule-nav-item__status--${resolveAutomationSkillTone(skillUiState.kind)}`}>
                                  {describeAutomationRuleStatus(rule, binding, issueCount)}
                                </span>
                                {issueCount > 0 ? <span className="automation-rule-nav-item__issue-count">{issueCount}</span> : null}
                              </span>
                            </button>
                          );
                        }) : (
                          <div className="automation-rule-nav-empty">
                            <strong>没有匹配的规则</strong>
                            <small>试试搜索按钮名称、Rule Id 或技能名。</small>
                          </div>
                        )}
                      </div>
                    </div>
                    {(() => {
                      const selectedIndex = selectedRuleIndex ?? -1;
                      const selectedRule = selectedIndex >= 0 ? rules[selectedIndex] : null;
                      if (!selectedRule) {
                        return (
                          <div className="automation-rule-empty-detail">
                            <strong>请选择一条规则</strong>
                            <small>左侧点击具体规则后，再在右侧编辑它的入口、目标和执行选项。</small>
                          </div>
                        );
                      }
                      const binding = bindings.bindings[selectedRule.id] ?? {
                        provider: "codex" as const,
                        skill: "",
                        enabled: true,
                      };
                      const selectedRuleIssues = validationIssuesByRuleId[selectedRule.id]
                        ?? validationIssuesByRuleId[`__index_${selectedIndex}`]
                        ?? [];
                      const bindingStatus = bindings.bindingStatuses?.[selectedRule.id];
                      const skillUiState = resolveAutomationSkillUiState(binding, bindingStatus, skillCatalogMap);
                      const skillSelectValue = isAbsoluteSkillPath(binding.skill) ? "" : binding.skill;
                      const ruleModelOptions = buildAutomationModelOptions(selectedRule.runtime?.model);
                      return (
                        <section className="automation-rule-card">
                          <div className="automation-rule-card__header">
                            <div className="automation-rule-card__title-group">
                              <strong>{selectedRule.label || selectedRule.id || `动作 ${selectedIndex + 1}`}</strong>
                              <small>{selectedRule.enabled ? "规则已启用" : "规则未启用"} · {binding.enabled ? "本机绑定已启用" : "本机绑定未启用"}</small>
                            </div>
                            <button className="ghost-button danger-button" disabled={controlsDisabled} onClick={() => removeRule(selectedIndex)} type="button">删除</button>
                          </div>
                          {selectedRuleIssues.length ? (
                            <div className="automation-validation-panel">
                              <strong>当前规则的校验问题</strong>
                              <ul className="automation-validation-list">
                                {selectedRuleIssues.map((issue) => (
                                  <li key={issue}>{issue}</li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                          <div className="automation-rule-section">
                            <div className="automation-rule-section__label">基础信息</div>
                            <div className="automation-rule-grid">
                              <label className="dialog-field">
                                <span>Rule Id</span>
                                <input value={selectedRule.id} onChange={(event) => updateRuleId(selectedIndex, event.target.value)} />
                              </label>
                              <label className="dialog-field">
                                <span>按钮名称</span>
                                <input value={selectedRule.label} onChange={(event) => updateRuleField(selectedIndex, "label", event.target.value)} />
                              </label>
                              <label className="dialog-field">
                                <span>图标</span>
                                <SharedViewIconPicker
                                  open={iconPickerOpenRuleId === selectedRule.id}
                                  onOpenChange={(open) => setIconPickerOpenRuleId(open ? selectedRule.id : null)}
                                  value={(selectedRule.icon || sharedViewDefaultIconId) as SharedViewIconId}
                                  onSelectIcon={(iconId) => updateRuleField(selectedIndex, "icon", iconId)}
                                  favoriteIconIds={props.favoriteIconIds}
                                  favoritesEnabled={props.favoritesEnabled}
                                  onToggleFavoriteIcon={props.onToggleFavoriteIcon}
                                  protectedIconPackIds={protectedIconPackIds}
                                  trigger={(
                                    <button type="button" className="automation-icon-field-trigger" aria-label="打开图标选择器">
                                      <span className="automation-icon-field-trigger__preview" data-view-icon={selectedRule.icon || sharedViewDefaultIconId}>
                                        {renderRuleIcon((selectedRule.icon || sharedViewDefaultIconId) as SharedViewIconId)}
                                      </span>
                                      <span className="automation-icon-field-trigger__value">{selectedRule.icon || sharedViewDefaultIconId}</span>
                                      <icons.chevronDown size={16} />
                                    </button>
                                  )}
                                />
                              </label>
                              <label className="dialog-field">
                                <span>技能</span>
                                <div className="automation-skill-field-row">
                                  <SearchablePicker
                                    open={skillPickerOpenRuleId === selectedRule.id}
                                    onOpenChange={(open) => {
                                      setSkillPickerOpenRuleId(open ? selectedRule.id : null);
                                    }}
                                    query={skillPickerQuery}
                                    onQueryChange={setSkillPickerQuery}
                                    searchAriaLabel="筛选技能"
                                    searchPlaceholder="筛选技能..."
                                    listAriaLabel="技能候选列表"
                                    contentClassName="automation-skill-picker-content"
                                    shellClassName="automation-skill-picker-shell"
                                    listClassName="automation-skill-picker-list"
                                    emptyContent={<div className="automation-skill-picker-empty">没有匹配的技能。</div>}
                                    trigger={(
                                      <button
                                        type="button"
                                        role="combobox"
                                        aria-expanded={skillPickerOpenRuleId === selectedRule.id}
                                        className={`select-trigger automation-skill-select-trigger automation-skill-select-trigger--${resolveAutomationSkillTone(skillUiState.kind)}`}
                                        aria-label="技能"
                                      >
                                        <span className="automation-skill-select-trigger__value">
                                          {skillSelectValue
                                            ? resolveAutomationSkillCatalogLabel(skillCatalogMap, skillSelectValue)
                                            : "从列表选择技能"}
                                        </span>
                                        <icons.chevronDown size={16} />
                                      </button>
                                    )}
                                  >
                                            <button
                                              className="searchable-picker-option automation-skill-picker-option"
                                              type="button"
                                              onClick={() => {
                                                updateBinding(selectedRule.id, { ...binding, skill: "" });
                                                setSkillPickerOpenRuleId(null);
                                                setSkillPickerQuery("");
                                              }}
                                            >
                                              <span className="automation-skill-picker-option__title">清空当前技能</span>
                                              <span className="automation-skill-picker-option__meta">移除这条规则的技能选择。</span>
                                            </button>
                                            {skillCatalog.skills
                                              .filter((item) => matchesAutomationSkillQuery(item, skillPickerQuery))
                                              .map((item) => (
                                                <button
                                                  className={`searchable-picker-option automation-skill-picker-option ${item.id === skillSelectValue ? "is-selected" : ""}`}
                                                  key={item.id}
                                                  type="button"
                                                  onClick={() => {
                                                    updateBinding(selectedRule.id, { ...binding, skill: item.id });
                                                    setSkillPickerOpenRuleId(null);
                                                    setSkillPickerQuery("");
                                                  }}
                                                >
                                                  <span className="automation-skill-picker-option__title">{item.label}</span>
                                                  <span className="automation-skill-picker-option__meta">{describeAutomationSkillCatalogSource(item)}</span>
                                                </button>
                                              ))}
                                  </SearchablePicker>
                                  <button
                                    aria-label="刷新技能列表"
                                    className="ghost-button automation-skill-refresh-icon"
                                    disabled={controlsDisabled || skillCatalogLoading || !props.project?.id}
                                    onClick={() => props.project?.id ? void refreshSkillCatalog(props.project.id) : undefined}
                                    title={skillCatalogLoading ? "刷新中..." : "刷新技能列表"}
                                    type="button"
                                  >
                                    <icons.refresh size={16} />
                                  </button>
                                </div>
                              </label>
                            </div>
                          </div>
                          <div className="automation-rule-section">
                            <div className="automation-rule-section__label">目标范围</div>
                            <div className="automation-target-editor">
                              <div className="automation-target-summary">
                                {selectedRule.targets.length ? selectedRule.targets.map((target, targetIndex) => (
                                  <span className="automation-target-chip" key={`${target.file}:${target.collection}:${targetIndex}`}>
                                    {describeAutomationTarget(target, targetCatalogByFile)}
                                  </span>
                                )) : (
                                  <small className="automation-target-empty">还没有目标。一个目标表示“某个文件里的某个 collection”。</small>
                                )}
                              </div>
                              {targetCatalogLoading ? <div className="automation-settings-loading">正在加载目标候选...</div> : null}
                              {targetCatalogError ? <div className="dialog-help">{targetCatalogError}</div> : null}
                              <div className="automation-target-list">
                                {selectedRule.targets.map((target, targetIndex) => {
                                  const collectionOptions = resolveTargetCollectionOptions(targetCatalogByFile, target.file, target.collection);
                                  const filePickerId = buildTargetPickerId(targetIndex, "file");
                                  const collectionPickerId = buildTargetPickerId(targetIndex, "collection");
                                  const visibleFileOptions = buildTargetFileOptions(targetCatalog, target.file)
                                    .filter((option) => matchesAutomationTargetFileQuery(option, targetPickerQuery));
                                  const visibleCollectionOptions = collectionOptions
                                    .filter((collection) => matchesAutomationTargetCollectionQuery(collection, targetPickerQuery));
                                  return (
                                    <div className="automation-target-row" key={`${target.file}:${target.collection}:${targetIndex}`}>
                                      <label className="dialog-field">
                                        <span>目标文件 {targetIndex + 1}</span>
                                        <SearchablePicker
                                          open={targetPickerOpenId === filePickerId}
                                          onOpenChange={(open) => {
                                            setTargetPickerOpenId(open ? filePickerId : null);
                                          }}
                                          query={targetPickerQuery}
                                          onQueryChange={setTargetPickerQuery}
                                          searchAriaLabel="筛选目标文件"
                                          searchPlaceholder="筛选文件..."
                                          listAriaLabel="目标文件候选列表"
                                          contentClassName="automation-target-picker-content"
                                          shellClassName="automation-skill-picker-shell"
                                          listClassName="automation-target-picker-list"
                                          emptyContent={<div className="searchable-picker-empty">没有匹配的文件。</div>}
                                          trigger={(
                                            <button
                                              type="button"
                                              role="combobox"
                                              aria-expanded={targetPickerOpenId === filePickerId}
                                              className="select-trigger automation-target-picker-trigger"
                                              aria-label={`目标文件 ${targetIndex + 1}`}
                                              title={target.file}
                                            >
                                              <span className="automation-target-picker-trigger__value">
                                                {describeTargetFileName(target.file)}
                                              </span>
                                              <icons.chevronDown size={16} />
                                            </button>
                                          )}
                                        >
                                          {visibleFileOptions.map((option) => (
                                            <button
                                              className={`searchable-picker-option automation-target-picker-option ${option.file === target.file ? "is-selected" : ""}`}
                                              key={option.file}
                                              type="button"
                                              onClick={() => {
                                                updateRuleTargetFile(selectedIndex, targetIndex, option.file);
                                                setTargetPickerOpenId(null);
                                                setTargetPickerQuery("");
                                              }}
                                              title={option.file}
                                            >
                                              <span className="searchable-picker-option__title">{describeTargetFileName(option.file)}</span>
                                            </button>
                                          ))}
                                        </SearchablePicker>
                                      </label>
                                      <label className="dialog-field">
                                        <span>目标集合 {targetIndex + 1}</span>
                                        <SearchablePicker
                                          open={targetPickerOpenId === collectionPickerId}
                                          onOpenChange={(open) => {
                                            setTargetPickerOpenId(open ? collectionPickerId : null);
                                          }}
                                          query={targetPickerQuery}
                                          onQueryChange={setTargetPickerQuery}
                                          searchAriaLabel="筛选目标集合"
                                          searchPlaceholder="筛选集合..."
                                          listAriaLabel="目标集合候选列表"
                                          contentClassName="automation-target-picker-content"
                                          shellClassName="automation-skill-picker-shell"
                                          listClassName="automation-target-picker-list"
                                          emptyContent={<div className="automation-skill-picker-empty">没有匹配的集合。</div>}
                                          trigger={(
                                            <button
                                              type="button"
                                              role="combobox"
                                              aria-expanded={targetPickerOpenId === collectionPickerId}
                                              className="select-trigger automation-target-picker-trigger"
                                              aria-label={`目标集合 ${targetIndex + 1}`}
                                              disabled={!target.file}
                                            >
                                              <span className="automation-target-picker-trigger__value">
                                                {describeCollectionPath(target.collection)}
                                              </span>
                                              <icons.chevronDown size={16} />
                                            </button>
                                          )}
                                        >
                                                  {visibleCollectionOptions.length ? visibleCollectionOptions.map((collection) => (
                                                    <button
                                                      className={`searchable-picker-option automation-skill-picker-option automation-target-picker-option ${collection === target.collection ? "is-selected" : ""}`}
                                                      key={collection}
                                                      type="button"
                                                      onClick={() => {
                                                        updateRuleTargetCollection(selectedIndex, targetIndex, collection);
                                                        setTargetPickerOpenId(null);
                                                        setTargetPickerQuery("");
                                                      }}
                                                    >
                                                      <span className="automation-skill-picker-option__title">{describeCollectionPath(collection)}</span>
                                                    </button>
                                                  )) : null}
                                        </SearchablePicker>
                                      </label>
                                      <div className="automation-target-remove-slot">
                                        <span className="automation-target-remove-slot__spacer" aria-hidden="true">操作</span>
                                        <button
                                          aria-label={`删除目标 ${targetIndex + 1}`}
                                          className="ghost-button icon-button danger-button automation-target-remove"
                                          disabled={controlsDisabled}
                                          onClick={() => removeRuleTarget(selectedIndex, targetIndex)}
                                          title="删除目标"
                                          type="button"
                                        >
                                          <icons.close size={15} />
                                        </button>
                                      </div>
                                      <div className="automation-target-artifact">
                                        <label className="dialog-check">
                                          <input
                                            checked={Boolean(target.textArtifact)}
                                            disabled={controlsDisabled}
                                            onChange={(event) => updateRuleTargetTextArtifact(selectedIndex, targetIndex, event.target.checked)}
                                            type="checkbox"
                                          />
                                          <span>允许此目标读写 Markdown 文档</span>
                                        </label>
                                        {target.textArtifact ? (
                                          <div className="automation-target-artifact__fields">
                                            <label className="dialog-field">
                                              <span>文档路径模板</span>
                                              <input disabled={controlsDisabled} onChange={(event) => updateRuleTargetTextArtifactField(selectedIndex, targetIndex, "pathTemplate", event.target.value)} value={target.textArtifact.pathTemplate} />
                                            </label>
                                            <label className="dialog-field">
                                              <span>条目标识字段</span>
                                              <input disabled={controlsDisabled} onChange={(event) => updateRuleTargetTextArtifactField(selectedIndex, targetIndex, "sourceField", event.target.value)} value={target.textArtifact.sourceField} />
                                            </label>
                                            <label className="dialog-field">
                                              <span>最大字节数</span>
                                              <input disabled={controlsDisabled} min={1} onChange={(event) => updateRuleTargetTextArtifactField(selectedIndex, targetIndex, "maxBytes", Number(event.target.value))} type="number" value={target.textArtifact.maxBytes} />
                                            </label>
                                            <label className="dialog-check"><input checked={target.textArtifact.allowCreate} disabled={controlsDisabled} onChange={(event) => updateRuleTargetTextArtifactField(selectedIndex, targetIndex, "allowCreate", event.target.checked)} type="checkbox" /><span>允许新建</span></label>
                                            <label className="dialog-check"><input checked={target.textArtifact.allowUpdate} disabled={controlsDisabled} onChange={(event) => updateRuleTargetTextArtifactField(selectedIndex, targetIndex, "allowUpdate", event.target.checked)} type="checkbox" /><span>允许更新</span></label>
                                          </div>
                                        ) : null}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                              <div className="automation-target-actions">
                                <button className="ghost-button" disabled={controlsDisabled || targetCatalogLoading || targetCatalog.length === 0} onClick={() => addRuleTarget(selectedIndex)} type="button">
                                  新增目标
                                </button>
                                <small>根数组或根对象会显示为“根集合 ($)”，因此即使多个文件都叫 `$`，也会和文件路径一起区分。</small>
                              </div>
                            </div>
                          </div>
                          <div className="automation-rule-section">
                            <div className="automation-rule-section__label">执行选项</div>
                            <div className="automation-rule-grid">
                              <label className="dialog-field">
                                <span>模型</span>
                                <Select.Root
                                  value={selectedRule.runtime?.model ?? automationRuntimeInheritValue}
                                  onValueChange={(value) => updateRuleRuntimeField(selectedIndex, "model", value === automationRuntimeInheritValue ? "" : value)}
                                >
                                  <Select.Trigger className="select-trigger" disabled={controlsDisabled}>
                                    <Select.Value placeholder={buildAutomationInheritedOptionLabel("默认", effectiveBindingDefaultModel)} />
                                    <Select.Icon asChild><icons.chevronDown size={16} /></Select.Icon>
                                  </Select.Trigger>
                                  <Select.Portal>
                                    <Select.Content className="menu-content select-content" position="popper" sideOffset={6}>
                                      <Select.Viewport>
                                        <Select.Item className="menu-item" value={automationRuntimeInheritValue}><Select.ItemText>{buildAutomationInheritedOptionLabel("默认", effectiveBindingDefaultModel)}</Select.ItemText></Select.Item>
                                        {ruleModelOptions.map((option) => (
                                          <Select.Item className="menu-item" key={option.value} value={option.value}><Select.ItemText>{option.label}</Select.ItemText></Select.Item>
                                        ))}
                                      </Select.Viewport>
                                    </Select.Content>
                                  </Select.Portal>
                                </Select.Root>
                              </label>
                              <label className="dialog-field">
                                <span>推理强度</span>
                                <Select.Root
                                  value={selectedRule.runtime?.reasoning ?? automationRuntimeInheritValue}
                                  onValueChange={(value) => updateRuleRuntimeSelectField(selectedIndex, "reasoning", value === automationRuntimeInheritValue ? "" : value)}
                                >
                                  <Select.Trigger className="select-trigger" disabled={controlsDisabled}>
                                    <Select.Value placeholder={buildAutomationInheritedOptionLabel("默认", effectiveBindingDefaultReasoning)} />
                                    <Select.Icon asChild><icons.chevronDown size={16} /></Select.Icon>
                                  </Select.Trigger>
                                  <Select.Portal>
                                    <Select.Content className="menu-content select-content" position="popper" sideOffset={6}>
                                      <Select.Viewport>
                                        <Select.Item className="menu-item" value={automationRuntimeInheritValue}><Select.ItemText>{buildAutomationInheritedOptionLabel("默认", effectiveBindingDefaultReasoning)}</Select.ItemText></Select.Item>
                                        {["none", "low", "medium", "high", "xhigh"].map((value) => (
                                          <Select.Item className="menu-item" key={value} value={value}><Select.ItemText>{value}</Select.ItemText></Select.Item>
                                        ))}
                                      </Select.Viewport>
                                    </Select.Content>
                                  </Select.Portal>
                                </Select.Root>
                              </label>
                              <label className="dialog-field">
                                <span>输出详略</span>
                                <Select.Root
                                  value={selectedRule.runtime?.verbosity ?? automationRuntimeInheritValue}
                                  onValueChange={(value) => updateRuleRuntimeSelectField(selectedIndex, "verbosity", value === automationRuntimeInheritValue ? "" : value)}
                                >
                                  <Select.Trigger className="select-trigger" disabled={controlsDisabled}>
                                    <Select.Value placeholder={buildAutomationInheritedOptionLabel("默认", effectiveBindingDefaultVerbosity)} />
                                    <Select.Icon asChild><icons.chevronDown size={16} /></Select.Icon>
                                  </Select.Trigger>
                                  <Select.Portal>
                                    <Select.Content className="menu-content select-content" position="popper" sideOffset={6}>
                                      <Select.Viewport>
                                        <Select.Item className="menu-item" value={automationRuntimeInheritValue}><Select.ItemText>{buildAutomationInheritedOptionLabel("默认", effectiveBindingDefaultVerbosity)}</Select.ItemText></Select.Item>
                                        {["low", "medium", "high"].map((value) => (
                                          <Select.Item className="menu-item" key={value} value={value}><Select.ItemText>{value}</Select.ItemText></Select.Item>
                                        ))}
                                      </Select.Viewport>
                                    </Select.Content>
                                  </Select.Portal>
                                </Select.Root>
                              </label>
                              <label className="dialog-field">
                                <span>超时（毫秒）</span>
                                <input
                                  value={selectedRule.runtime?.timeoutMs == null ? "" : String(selectedRule.runtime.timeoutMs)}
                                  onChange={(event) => updateRuleRuntimeField(selectedIndex, "timeoutMs", event.target.value)}
                                  placeholder={`留空使用默认 ${effectiveBindingDefaultTimeoutMs}`}
                                  inputMode="numeric"
                                  disabled={controlsDisabled}
                                />
                              </label>
                            </div>
                            <small>推理强度通过 `model_reasoning_effort` 下发，输出详略通过 `model_verbosity` 下发。</small>
                            <div className="automation-rule-checks">
                              <label
                                className="dialog-check"
                                title="关闭后，这条规则不会在详情面板中作为可执行动作出现。"
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedRule.enabled}
                                  onChange={(event) => updateRuleField(selectedIndex, "enabled", event.target.checked)}
                                />
                                <span>启用规则</span>
                              </label>
                              <label
                                className="dialog-check"
                                title="关闭后，这台电脑上不会实际执行这条规则，即使规则本身仍然保留。"
                              >
                                <input
                                  type="checkbox"
                                  checked={binding.enabled}
                                  onChange={(event) => updateBinding(selectedRule.id, { ...binding, enabled: event.target.checked })}
                                />
                                <span>在本机启用绑定</span>
                              </label>
                              <label
                                className="dialog-check"
                                title="执行技能时，把当前详情面板对应的这条记录一起放进请求上下文。"
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedRule.payload.includeRow}
                                  onChange={(event) => updateRule(selectedIndex, {
                                    ...selectedRule,
                                    payload: {
                                      ...selectedRule.payload,
                                      includeRow: event.target.checked,
                                    },
                                  })}
                                />
                                <span>包含当前条目</span>
                              </label>
                              <label
                                className="dialog-check"
                                title="执行技能时，额外把当前条目前后的相邻记录也一起提供给技能参考。"
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedRule.payload.includeNeighbors}
                                  onChange={(event) => updateRule(selectedIndex, {
                                    ...selectedRule,
                                    payload: {
                                      ...selectedRule.payload,
                                      includeNeighbors: event.target.checked,
                                    },
                                  })}
                                />
                                <span>包含相邻条目</span>
                              </label>
                            </div>
                          </div>
                        </section>
                      );
                    })()}
                  </div>
                ) : (
                  <div className="project-source-row">
                    <strong>暂无个人自动化动作</strong>
                    <small>新增一条动作规则后，就可以为当前项目配置自己的 Codex 技能入口。</small>
                  </div>
                )}
                {error ? <div className="dialog-error">{error}</div> : null}
              </div>
            ) : (
              <p>当前没有活动项目。</p>
            )}
          </div>
          <div className="dialog-actions">
            {saveMessage ? <div className="automation-save-status" role="status">{saveMessage}</div> : null}
            <Dialog.Close className="ghost-button">关闭</Dialog.Close>
            <button
              className="primary-button"
              disabled={controlsDisabled || validationIssues.length > 0}
              onClick={() => void saveAutomationSettings()}
              title={validationIssues.length > 0 ? validationIssues.join("\n") : undefined}
              type="button"
            >
              {saving ? "正在保存..." : "保存自动化设置"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function AddProjectDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateProject: (input: { name: string; root: string }) => void;
}) {
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectRoot, setNewProjectRoot] = useState("");

  useEffect(() => {
    if (props.open) return;
    setNewProjectName("");
    setNewProjectRoot("");
  }, [props.open]);

  function createNextProject() {
    props.onCreateProject({
      name: newProjectName.trim() || "Project",
      root: newProjectRoot.trim(),
    });
  }

  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content">
          <Dialog.Title>Add Project</Dialog.Title>
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
            <Dialog.Close className="ghost-button">Close</Dialog.Close>
            <button className="primary-button" disabled={!newProjectRoot.trim()} onClick={createNextProject} type="button">Add Project</button>
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

function buildAutomationValidationIssuesByRuleId(profile: UserAutomationProfile, bindings: DeviceEntryActionBindings) {
  const issuesByRuleId: Record<string, string[]> = {};
  const seenRuleIds = new Set<string>();
  for (const [index, rule] of profile.rules.entries()) {
    const ruleIssues: string[] = [];
    const ruleId = rule.id.trim();
    if (!ruleId) {
      ruleIssues.push("Rule Id 不能为空。");
    } else {
      if (!/^[a-z0-9_-]+$/.test(ruleId)) {
        ruleIssues.push("Rule Id 只能包含小写字母、数字、`-`、`_`。");
      }
      if (seenRuleIds.has(ruleId)) {
        ruleIssues.push("Rule Id 不能重复。");
      }
      seenRuleIds.add(ruleId);
    }
    if (!rule.label.trim()) ruleIssues.push("按钮名称不能为空。");
    if (!rule.targets.length) ruleIssues.push("至少需要一个目标。");
    for (const target of rule.targets) {
      if (!target.file.trim()) ruleIssues.push("目标文件不能为空。");
      if (!target.collection.trim()) ruleIssues.push("目标集合不能为空。");
      if (target.textArtifact) {
        if (!target.textArtifact.pathTemplate.trim() || !target.textArtifact.pathTemplate.endsWith(".md") || (target.textArtifact.pathTemplate.match(/\{value\}/g) ?? []).length !== 1) ruleIssues.push("文档路径模板必须是含一个 `{value}` 的 Markdown 路径。");
        if (!target.textArtifact.sourceField.trim()) ruleIssues.push("文档条目标识字段不能为空。");
        if (!Number.isInteger(target.textArtifact.maxBytes) || target.textArtifact.maxBytes <= 0) ruleIssues.push("文档最大字节数必须为正整数。");
        if (!target.textArtifact.allowCreate && !target.textArtifact.allowUpdate) ruleIssues.push("文档至少要允许新建或更新其中一种操作。");
      }
    }
    if (rule.runtime?.reasoning != null && !["none", "low", "medium", "high", "xhigh"].includes(rule.runtime.reasoning)) {
      ruleIssues.push("规则推理强度必须为 none / low / medium / high / xhigh。");
    }
    if (rule.runtime?.verbosity != null && !["low", "medium", "high"].includes(rule.runtime.verbosity)) {
      ruleIssues.push("规则输出详略必须为 low / medium / high。");
    }
    if (rule.runtime?.timeoutMs != null && (!Number.isInteger(rule.runtime.timeoutMs) || rule.runtime.timeoutMs <= 0)) {
      ruleIssues.push("规则超时时间必须为正整数。");
    }
    const binding = bindings.bindings[rule.id];
    if (binding) {
      if (binding.provider !== "codex") ruleIssues.push("当前仅支持 codex provider。");
      if (!binding.skill.trim()) ruleIssues.push("Skill 不能为空。");
    } else {
      ruleIssues.push("缺少本机绑定。");
    }
    issuesByRuleId[rule.id] = ruleIssues;
    if (!rule.id.trim()) issuesByRuleId[`__index_${index}`] = ruleIssues;
  }
  return issuesByRuleId;
}

function validateAutomationSettings(profile: UserAutomationProfile, bindings: DeviceEntryActionBindings) {
  const issues: string[] = [];
  const seenRuleIds = new Set<string>();
  for (const [index, rule] of profile.rules.entries()) {
    const prefix = `Rule ${index + 1}`;
    const ruleId = rule.id.trim();
    if (!ruleId) {
      issues.push(`${prefix}: Rule Id 不能为空。`);
    } else {
      if (!/^[a-z0-9_-]+$/.test(ruleId)) {
        issues.push(`${prefix}: Rule Id 只能使用小写字母、数字、_ 或 -。`);
      }
      if (seenRuleIds.has(ruleId)) {
        issues.push(`${prefix}: Rule Id "${ruleId}" 重复。`);
      }
      seenRuleIds.add(ruleId);
    }
    if (!rule.label.trim()) issues.push(`${prefix}: Label 不能为空。`);
    if (!rule.icon.trim()) issues.push(`${prefix}: Icon 不能为空。`);
    if (rule.targets.length === 0) {
      issues.push(`${prefix}: 目标范围至少要有一项。`);
    } else {
      const seenTargets = new Set<string>();
      for (const target of rule.targets) {
        if (!target.file.trim()) issues.push(`${prefix}: 目标文件不能为空。`);
        if (!target.collection.trim()) issues.push(`${prefix}: 目标集合不能为空。`);
        const key = `${target.file}\u0000${target.collection}`;
        if (seenTargets.has(key)) issues.push(`${prefix}: 目标 "${target.file} / ${target.collection}" 重复。`);
        seenTargets.add(key);
        if (target.textArtifact) {
          if (!target.textArtifact.pathTemplate.trim() || !target.textArtifact.pathTemplate.endsWith(".md") || (target.textArtifact.pathTemplate.match(/\{value\}/g) ?? []).length !== 1) issues.push(`${prefix}: 文档路径模板必须是含一个 \`{value}\` 的 Markdown 路径。`);
          if (!target.textArtifact.sourceField.trim()) issues.push(`${prefix}: 文档条目标识字段不能为空。`);
          if (!Number.isInteger(target.textArtifact.maxBytes) || target.textArtifact.maxBytes <= 0) issues.push(`${prefix}: 文档最大字节数必须为正整数。`);
          if (!target.textArtifact.allowCreate && !target.textArtifact.allowUpdate) issues.push(`${prefix}: 文档至少要允许新建或更新其中一种操作。`);
        }
      }
    }
    if (rule.runtime?.reasoning != null && !["none", "low", "medium", "high", "xhigh"].includes(rule.runtime.reasoning)) {
      issues.push(`${prefix}: 规则推理强度必须为 none / low / medium / high / xhigh。`);
    }
    if (rule.runtime?.verbosity != null && !["low", "medium", "high"].includes(rule.runtime.verbosity)) {
      issues.push(`${prefix}: 规则输出详略必须为 low / medium / high。`);
    }
    if (rule.runtime?.timeoutMs != null && (!Number.isInteger(rule.runtime.timeoutMs) || rule.runtime.timeoutMs <= 0)) {
      issues.push(`${prefix}: 规则超时时间必须为正整数。`);
    }

    const binding = bindings.bindings[ruleId];
    const bindingStatus = bindings.bindingStatuses?.[ruleId];
    if (!rule.enabled) continue;
    if (!binding) {
      issues.push(`${prefix}: 当前设备缺少 binding。`);
      continue;
    }
    if (binding.provider !== "codex") issues.push(`${prefix}: Provider 目前只支持 codex。`);
    if (!binding.skill.trim()) issues.push(`${prefix}: Skill 不能为空。`);
    if (bindingStatus?.status === "invalid" && bindingStatus.message) {
      issues.push(`${prefix}: ${bindingStatus.message}`);
    }
  }
  for (const ruleId of Object.keys(bindings.bindings)) {
    if (!seenRuleIds.has(ruleId)) {
      issues.push(`Binding "${ruleId}" 没有对应的 rule。`);
    }
  }
  if (bindings.defaults.timeoutMs != null && (!Number.isInteger(bindings.defaults.timeoutMs) || bindings.defaults.timeoutMs <= 0)) {
    issues.push("本机默认超时时间必须为正整数。");
  }
  if (bindings.defaults.reasoning != null && !["none", "low", "medium", "high", "xhigh"].includes(bindings.defaults.reasoning)) {
    issues.push("本机默认推理强度必须为 none / low / medium / high / xhigh。");
  }
  if (bindings.defaults.verbosity != null && !["low", "medium", "high"].includes(bindings.defaults.verbosity)) {
    issues.push("本机默认输出详略必须为 low / medium / high。");
  }
  return issues;
}

function describeAutomationRuleStatus(rule: EntryActionRule, binding: EntryActionBinding, issueCount: number) {
  if (issueCount > 0) return `${issueCount} 个问题`;
  if (!rule.enabled) return "未启用";
  if (!binding.enabled) return "绑定关闭";
  return "正常";
}

function resolveVisibleEntryActions(input: {
  profile: UserAutomationProfile;
  bindings: DeviceEntryActionBindings;
  selectedPath: string | null;
  collectionPath: string;
}): EntryActionRule[] {
  if (!input.selectedPath) return [];
  return input.profile.rules
    .filter((rule) => rule.enabled !== false)
    .filter((rule) => rule.targets.some((target) => target.file === input.selectedPath && target.collection === input.collectionPath))
    .filter((rule) => {
      const binding = input.bindings.bindings[rule.id];
      const bindingStatus = input.bindings.bindingStatuses?.[rule.id];
      return Boolean(binding && binding.enabled !== false && binding.skill.trim() && bindingStatus?.status !== "invalid");
    })
    .map((rule) => ({
      id: rule.id,
      label: rule.label,
      icon: rule.icon,
      enabled: true,
      targets: rule.targets.map((target) => ({ ...target })),
      payload: {
        includeRow: rule.payload.includeRow,
        includeNeighbors: rule.payload.includeNeighbors,
      },
    }));
}

type AutomationTargetCatalogItem = {
  file: string;
  label: string;
  collections: string[];
};

function buildTargetFileOptions(catalog: AutomationTargetCatalogItem[], selectedFile: string) {
  const options = [...catalog];
  if (selectedFile && !options.some((item) => item.file === selectedFile)) {
    options.unshift({ file: selectedFile, label: selectedFile, collections: [] });
  }
  return options;
}

function describeTargetFileName(filePath: string) {
  return describeFileBasename(filePath);
}

function buildAutomationModelOptions(currentModel: string | null | undefined) {
  const options = [...automationModelOptions];
  const normalized = typeof currentModel === "string" ? currentModel.trim() : "";
  if (normalized && !options.some((option) => option.value === normalized)) {
    options.unshift({ value: normalized, label: normalized });
  }
  return options;
}

function buildAutomationInheritedOptionLabel(scopeLabel: string, value: string | number) {
  return `留空使用${scopeLabel}（${value}）`;
}

function matchesAutomationTargetFileQuery(option: AutomationTargetCatalogItem, query: string) {
  return matchesFileSearchQuery(option.file, query);
}

function resolveTargetCollectionOptions(
  catalogByFile: Record<string, AutomationTargetCatalogItem>,
  file: string,
  selectedCollection: string | null = null,
) {
  const collections = [...(catalogByFile[file]?.collections ?? [])];
  if (selectedCollection && !collections.includes(selectedCollection)) {
    collections.unshift(selectedCollection);
  }
  return collections;
}

function describeCollectionPath(collectionPath: string) {
  return collectionPath === "$" ? "根集合 ($)" : collectionPath;
}

function matchesAutomationTargetCollectionQuery(collectionPath: string, query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  const display = describeCollectionPath(collectionPath).toLowerCase();
  return collectionPath.toLowerCase().includes(normalized) || display.includes(normalized);
}

function describeAutomationTarget(target: EntryActionTarget, catalogByFile: Record<string, AutomationTargetCatalogItem>) {
  const fileLabel = describeTargetFileName(catalogByFile[target.file]?.label ?? target.file);
  return `${fileLabel} · ${describeCollectionPath(target.collection)}`;
}

function isAbsoluteSkillPath(value: string) {
  const skill = value.trim();
  return /^[a-zA-Z]:[\\/]/.test(skill) || skill.startsWith("\\\\") || skill.startsWith("/");
}

function resolveAutomationSkillCatalogLabel(skillCatalogMap: Map<string, AutomationSkillCatalogItem>, skill: string) {
  return skillCatalogMap.get(skill)?.label ?? skill;
}

function resolveAutomationSkillTone(kind: string) {
  if (kind === "ready") return "ready";
  if (kind === "invalid" || kind === "missing") return "invalid";
  return "muted";
}

function matchesAutomationSkillQuery(item: AutomationSkillCatalogItem, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;
  return item.id.toLowerCase().includes(normalizedQuery)
    || item.label.toLowerCase().includes(normalizedQuery)
    || describeAutomationSkillCatalogSource(item).toLowerCase().includes(normalizedQuery);
}

function describeAutomationSkillCatalogSource(item: AutomationSkillCatalogItem) {
  switch (item.source) {
    case "project-agents":
      return "项目 .agents";
    case "user-codex-home":
      return "用户 .codex";
    case "user-agents-home":
      return "用户 .agents";
    default:
      return "其它来源";
  }
}

function resolveAutomationSkillUiState(
  binding: EntryActionBinding,
  bindingStatus: DeviceEntryActionBindingStatus | undefined,
  skillCatalogMap: Map<string, AutomationSkillCatalogItem>,
) {
  const skill = binding.skill.trim();
  if (!skill) {
    return { kind: "empty", label: "未选择", detail: "请先选择 skill。" };
  }
  if (binding.enabled === false) {
    return { kind: "invalid", label: "绑定已禁用", detail: "当前本机绑定未启用。" };
  }
  if (isAbsoluteSkillPath(skill)) {
    if (bindingStatus?.status === "ready") {
      return { kind: "ready", label: "绝对路径可用", detail: "当前值走本机绝对路径。" };
    }
    if (bindingStatus?.status === "invalid") {
      return { kind: "invalid", label: "绝对路径无效", detail: bindingStatus.message ?? "当前路径不可用。" };
    }
    return { kind: "manual", label: "绝对路径", detail: "当前值未走 catalog 列表。" };
  }
  if (bindingStatus?.status === "ready") {
    return skillCatalogMap.has(skill)
      ? { kind: "ready", label: "已就绪", detail: "当前 skill 已命中列表且运行时可用。" }
      : { kind: "ready", label: "运行时可用", detail: "当前 skill 可用，但最新列表未命中。" };
  }
  if (bindingStatus?.status === "invalid") {
    return { kind: "invalid", label: "当前无效", detail: bindingStatus.message ?? "当前运行时校验失败。" };
  }
  if (bindingStatus?.status === "missing") {
    return { kind: "missing", label: "未绑定", detail: bindingStatus.message ?? "当前设备缺少绑定。" };
  }
  if (skillCatalogMap.has(skill)) {
    return { kind: "catalog", label: "已命中列表", detail: "保存时会继续做真实校验。" };
  }
  return { kind: "missing", label: "列表未命中", detail: "可刷新列表，或直接输入绝对路径。" };
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
  const rowsInCollection = getRows(model, collectionPath) as DataRecord[];
  const fields = [...new Set([...getMainColumns(model, collectionPath), ...getNestedFields(model, collectionPath), ...extraFields])];
  for (const field of fields) {
    const sample = rowsInCollection.find((row) => row[field] !== undefined && row[field] !== null)?.[field]
      ?? rowsInCollection.find((row) => row[field] !== undefined)?.[field];
    const displayType = viewConfig.fields[fieldViewConfigKey(path, collectionPath, field) ?? ""]?.type;
    if (displayType) displayTypes[field] = resolveCompatibleDisplayType(displayType, sample);
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

function sameViewFilters(previous: FilterGroup, next: FilterGroup) {
  return sameRuleNodes(previous.topLevelRules ?? [], next.topLevelRules ?? [])
    && sameGroupNode(previous.advancedRoot ?? null, next.advancedRoot ?? null);
}

function sameRuleNodes(previous: Array<{ id: string; field: string; operator: string; value?: unknown; join?: "and" | "or" }>, next: Array<{ id: string; field: string; operator: string; value?: unknown; join?: "and" | "or" }>) {
  return previous.length === next.length
    && previous.every((rule, index) => {
      const candidate = next[index];
      if (!candidate) return false;
      return rule.id === candidate.id
        && rule.field === candidate.field
        && rule.operator === candidate.operator
        && rule.join === candidate.join
        && sameUnknownValue(rule.value, candidate.value);
    });
}

function sameGroupNode(previous: FilterGroupNode | null, next: FilterGroupNode | null): boolean {
  if (previous === next) return true;
  if (!previous || !next) return false;
  const previousChildren = Array.isArray(previous.children) ? previous.children : [];
  const nextChildren = Array.isArray(next.children) ? next.children : [];
  return previous.id === next.id
    && previous.op === next.op
    && previous.join === next.join
    && previousChildren.length === nextChildren.length
    && previousChildren.every((node, index) => sameFilterNode(node, nextChildren[index] ?? null));
}

function sameFilterNode(previous: FilterNode, next: FilterNode | null): boolean {
  if (!next) return false;
  if (previous.kind !== next.kind) return false;
  if (previous.kind === "group" && next.kind === "group") return sameGroupNode(previous, next);
  if (previous.kind === "rule" && next.kind === "rule") {
    return previous.id === next.id
      && previous.field === next.field
      && previous.operator === next.operator
      && previous.join === next.join
      && sameUnknownValue(previous.value, next.value);
  }
  return false;
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
  if (displayType === "Backlink") return [];
  if (displayType === "Number") return null;
  if (displayType === "Relation") return null;
  return "";
}

function resolveDocumentCollection(model: DocumentModel, targetCollection?: string) {
  if (targetCollection && model.collections.some((collection) => collection.path === targetCollection)) return targetCollection;
  return model.collections[0]?.path ?? "$";
}

function inferViewFilterFieldType(fieldName: string, rows: DataRecord[], displayTypes: Record<string, FieldDisplayType>): FieldDisplayType {
  const sample = rows.find((row) => row[fieldName] !== undefined && row[fieldName] !== null)?.[fieldName]
    ?? rows.find((row) => row[fieldName] !== undefined)?.[fieldName];
  return resolveCompatibleDisplayType(displayTypes[fieldName], sample);
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
const detailDocumentPanelOpenStorageKey = "data-editor:detail-document-panel-open";
const detailDocumentPanelWidthStorageKey = "data-editor:detail-document-panel-width";
const minDetailPanelWidth = 320;
const maxDetailPanelWidth = 920;
const defaultDetailPanelWidth = 400;
const minDetailDocumentPanelWidth = 280;
const defaultDetailDocumentPanelWidth = 360;

function readSidebarWidth() {
  const stored = Number(localStorage.getItem(sidebarWidthStorageKey));
  return clampSidebarWidth(Number.isFinite(stored) && stored > 0 ? stored : defaultSidebarWidth);
}

function readDetailPanelWidth() {
  const stored = Number(localStorage.getItem(detailPanelWidthStorageKey));
  return clampDetailPanelWidth(Number.isFinite(stored) && stored > 0 ? stored : defaultDetailPanelWidth);
}

function readDetailDocumentPanelOpen() {
  const stored = localStorage.getItem(detailDocumentPanelOpenStorageKey);
  if (stored === "1") return true;
  if (stored === "0") return false;
  return false;
}

function readDetailDocumentPanelWidth() {
  const stored = Number(localStorage.getItem(detailDocumentPanelWidthStorageKey));
  return clampDetailDocumentPanelWidth(Number.isFinite(stored) && stored > 0 ? stored : defaultDetailDocumentPanelWidth);
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

function clampDetailDocumentPanelWidth(width: number) {
  return Math.max(minDetailDocumentPanelWidth, Math.round(width));
}

function cloneDataRoot<T>(value: T): T {
  return value == null ? value : structuredClone(value);
}

function emptyUserViewProfile(): UserViewProfile {
  return {
    sidebarWidth: null,
    detailPanelWidth: null,
    detailDocumentPanelOpen: null,
    detailDocumentPanelWidth: null,
    favoriteSharedViewIconIds: [],
    fileOrder: [],
    sidebarTree: serializeSidebarTreeState(cloneSidebarTreePreferences(), false),
    lastActiveViews: {},
    viewDrafts: {},
    viewOrderDrafts: {},
    sharedViewCollaborationMode: "team",
    viewLayouts: {},
    collections: {},
  };
}

function normalizeUserViewProfile(profile: Partial<UserViewProfile> | null | undefined): UserViewProfile {
  if (!profile || typeof profile !== "object") return emptyUserViewProfile();
  return {
    sidebarWidth: Number.isFinite(profile.sidebarWidth) ? Number(profile.sidebarWidth) : null,
    detailPanelWidth: Number.isFinite(profile.detailPanelWidth) ? Number(profile.detailPanelWidth) : null,
    detailDocumentPanelOpen: typeof profile.detailDocumentPanelOpen === "boolean" ? profile.detailDocumentPanelOpen : null,
    detailDocumentPanelWidth: Number.isFinite(profile.detailDocumentPanelWidth) ? Number(profile.detailDocumentPanelWidth) : null,
    favoriteSharedViewIconIds: Array.isArray(profile.favoriteSharedViewIconIds)
      ? profile.favoriteSharedViewIconIds.filter((value): value is SharedViewIconId => typeof value === "string")
      : [],
    fileOrder: Array.isArray(profile.fileOrder) ? [...profile.fileOrder] : [],
    sidebarTree: cloneStoredSidebarTreeState(profile.sidebarTree),
    lastActiveViews: { ...(profile.lastActiveViews ?? {}) },
    viewDrafts: { ...(profile.viewDrafts ?? {}) },
    viewOrderDrafts: { ...(profile.viewOrderDrafts ?? {}) },
    sharedViewCollaborationMode: profile.sharedViewCollaborationMode === "personal" ? "personal" : "team",
    structureDrafts: Object.fromEntries(Object.entries(profile.structureDrafts ?? {}).map(([key, draft]) => [
      key,
      {
        items: Array.isArray(draft?.items)
          ? draft.items.map((item) => item.kind === "group"
            ? {
              kind: "group",
              groupId: item.groupId,
              ...(item.name ? { name: item.name } : {}),
              ...(item.icon ? { icon: item.icon } : {}),
              viewIds: [...item.viewIds],
            }
            : { kind: "view", viewId: item.viewId })
          : [],
      },
    ])),
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
          ...(value?.overrides ? { overrides: cloneLayoutOverrides(value.overrides) } : {}),
        },
      ])),
    ])),
    collections: { ...(profile.collections ?? {}) },
  };
}

function cloneLayoutOverrides(value?: UserViewLayoutState["overrides"]) {
  if (!value) return undefined;
  const next: UserViewLayoutState["overrides"] = {};
  for (const key of ["hidden", "wrapped", "order", "detailOrder"] as const) {
    if (value[key] === true) next[key] = true;
  }
  return Object.keys(next).length ? next : undefined;
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
    || Object.values(draftState.viewOrderDrafts).some((order) => order.length > 0)
    || Object.values(draftState.structureDrafts ?? {}).some((draft) => Array.isArray(draft?.items) && draft.items.length > 0);
}

function collectDraftCollectionKeys(draftState: SharedViewDraftState) {
  return [...new Set([
    ...Object.keys(draftState.viewDrafts ?? {}),
    ...Object.keys(draftState.viewOrderDrafts ?? {}),
    ...Object.keys(draftState.structureDrafts ?? {}),
  ])];
}

function clearCollectionSharedDrafts(draftState: SharedViewDraftState, collectionKey: string): SharedViewDraftState {
  const nextLastActiveViews = { ...draftState.lastActiveViews };
  const nextViewDrafts = { ...draftState.viewDrafts };
  const nextViewOrderDrafts = { ...draftState.viewOrderDrafts };
  const nextStructureDrafts = { ...(draftState.structureDrafts ?? {}) };
  delete nextViewDrafts[collectionKey];
  delete nextViewOrderDrafts[collectionKey];
  delete nextStructureDrafts[collectionKey];
  return {
    lastActiveViews: nextLastActiveViews,
    viewDrafts: nextViewDrafts,
    viewOrderDrafts: nextViewOrderDrafts,
    structureDrafts: nextStructureDrafts,
  };
}

function resolveSharedViewCollaborationMode(profileName: string | null, profile: UserViewProfile | null) {
  if (!profileName) return "team" as const;
  return profile?.sharedViewCollaborationMode === "personal" ? "personal" : "team";
}

function emptyProjectViewConfig(): ViewConfig {
  return {
    fields: {},
    titleFields: {},
    documentFiles: {},
    documentFields: {},
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
    titleFields: { ...config.titleFields },
    documentFiles: Object.fromEntries(Object.entries(config.documentFiles ?? {}).map(([key, value]) => [key, { docRoot: value.docRoot }])),
    documentFields: Object.fromEntries(Object.entries(config.documentFields ?? {}).map(([key, value]) => [key, { enabled: value.enabled }])),
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

function buildProfileFromCurrentView(
  path: string | null,
  collectionPath: string,
  fieldConfig: FieldConfig,
  viewId: string | null,
  sidebarWidth: number,
  detailPanelWidth: number,
  detailDocumentPanelOpen: boolean,
  detailDocumentPanelWidth: number,
  fileOrder: string[],
  sidebarTree: UserViewProfile["sidebarTree"],
  appearance: UiPreferences,
): UserViewProfile {
  if (!path) {
    return {
      sidebarWidth,
      detailPanelWidth,
      detailDocumentPanelOpen,
      detailDocumentPanelWidth,
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
  const globalDetailOrder = [...fieldConfig.detailOrder];
  const activeViewLayout = {
    hidden: [...fieldConfig.hidden],
    wrapped: [...fieldConfig.wrapped],
    order: [...fieldConfig.order],
    detailOrder: viewId === "all" ? globalDetailOrder : [],
    widths: { ...fieldConfig.widths },
  };
  return {
    sidebarWidth,
    detailPanelWidth,
    detailDocumentPanelOpen,
    detailDocumentPanelWidth,
    fileOrder: [...fileOrder],
    sidebarTree: cloneStoredSidebarTreeState(sidebarTree),
    lastActiveViews: viewId ? { [collectionKey]: viewId } : {},
    viewDrafts: {},
    viewOrderDrafts: {},
    appearance: cloneUiPreferences(appearance),
    viewLayouts: viewId ? {
      [collectionKey]: {
        ...(viewId === "all" ? {} : {
          all: {
            hidden: [],
            wrapped: [],
            order: [],
            detailOrder: globalDetailOrder,
            widths: {},
          },
        }),
        [viewId]: activeViewLayout,
      },
    } : {},
    collections: viewId ? {
      [collectionKey]: {
        hidden: [...fieldConfig.hidden],
        wrapped: [...fieldConfig.wrapped],
        order: [...fieldConfig.order],
        detailOrder: globalDetailOrder,
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
    selectOptions: {} as FieldViewConfig["selectOptions"],
    multiSelectOptions: {} as FieldViewConfig["multiSelectOptions"],
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

function isFormalSkillsDocumentPath(path: string | null | undefined) {
  return String(path ?? "").replaceAll("\\", "/").toLocaleLowerCase("en-US").endsWith("data/content/skills.json");
}

function readSkillNodeContractVersion(root: unknown) {
  if (!root || typeof root !== "object" || Array.isArray(root)) return null;
  const version = (root as Record<string, unknown>).skill_node_contract_version;
  return Number.isInteger(version) ? version as number : null;
}

function readErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return null;
}
