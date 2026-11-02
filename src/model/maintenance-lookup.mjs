import { buildDocumentModel, getRows } from "../document-model.mjs";
import { listDocumentFieldsForCollection } from "./document-config.mjs";
import { getPrimaryKeyField } from "./field-role.mjs";
import { analyzePrimaryKeyChange, buildPrimaryKeySyncPlan, collectRelationBacklinks, parseRelationKey } from "./relation-maintenance.mjs";

/**
 * @param {{
 *   selectedPath: string | null;
 *   collectionPath: string;
 *   selectedRow: Record<string, unknown> | null;
 *   selectedSourceRowIndex: number | null;
 *   selectedRowLabel: string | null;
 *   model: import("./documentModel").DocumentModel | null;
 *   rows: Record<string, unknown>[];
 *   savedRoot: unknown;
 *   viewConfig: import("./viewConfig").ViewConfig;
 *   activeProjectId?: string | null;
 *   loadDocument: (path: string) => Promise<import("./documentModel").DocumentModel>;
 * }} input
 * @returns {Promise<{
 *   relationBacklinks: import("./relationMaintenance").RelationBacklink[];
 *   primaryKeyImpacts: Record<string, import("./relationMaintenance").PrimaryKeyImpact>;
 *   primaryKeySyncPlan: import("./relationMaintenance").PrimaryKeySyncPlan | null;
 * }>}
 */
export function buildMaintenanceLookupState(input){return buildMaintenanceLookupStateImpl(input,null);}
export function buildMaintenanceWithConfirmedRow(input,resolveSavedRow){return buildMaintenanceLookupStateImpl(input,resolveSavedRow);}
export function buildMaintenanceForConfirmedSave(input,resolveSavedRow){return buildMaintenanceLookupStateImpl(input,resolveSavedRow,true);}
async function buildMaintenanceLookupStateImpl({
  selectedPath,
  collectionPath,
  selectedRow,
  selectedSourceRowIndex,
  selectedRowLabel,
  model,
  rows,
  savedRoot,
  viewConfig,
  loadDocument,
},resolveSavedRow,saveOnly=false) {
  if (!selectedPath || !selectedRow) {
    return emptyMaintenanceState();
  }
  const primaryKeyField = getPrimaryKeyField(viewConfig, selectedPath, collectionPath);
  if (!primaryKeyField) {
    return emptyMaintenanceState();
  }
  // Unknown pairing blocks only operations which actually depend on an old key.
  if(resolveSavedRow&&(selectedRow[primaryKeyField]==null||String(selectedRow[primaryKeyField]).trim()===''))return emptyMaintenanceState();
  if(resolveSavedRow&&!Object.values(viewConfig.relations).some(relation=>relation.targetFile===selectedPath&&relation.targetCollection===collectionPath&&relation.targetKey===primaryKeyField)&&!listDocumentFieldsForCollection(viewConfig,selectedPath,collectionPath).some(({fieldPath})=>fieldPath.length===1&&fieldPath[0]!==primaryKeyField))return emptyMaintenanceState();
  const savedDocumentModel = !resolveSavedRow&&savedRoot != null && model ? buildDocumentModel(savedRoot, model.format, selectedPath) : null;
  const savedRows = savedDocumentModel ? getRows(savedDocumentModel, collectionPath) : [];
  const savedRow = resolveSavedRow?resolveSavedRow(primaryKeyField):(selectedSourceRowIndex == null ? null : savedRows[selectedSourceRowIndex] ?? null);
  const previousPrimaryKeyValue = savedRow?.[primaryKeyField];
  const currentPrimaryKeyValue = selectedRow[primaryKeyField];
  const primitive=value=>value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value);
  if(saveOnly&&resolveSavedRow&&(savedRow===null||primitive(previousPrimaryKeyValue)&&primitive(currentPrimaryKeyValue)&&Object.is(previousPrimaryKeyValue,currentPrimaryKeyValue)))return emptyMaintenanceState();
  const normalizedPreviousPrimaryKeyValue = previousPrimaryKeyValue == null ? "" : String(previousPrimaryKeyValue).trim();
  const normalizedCurrentPrimaryKeyValue = currentPrimaryKeyValue == null ? "" : String(currentPrimaryKeyValue).trim();
  if (
    (!normalizedPreviousPrimaryKeyValue && !normalizedCurrentPrimaryKeyValue)
    || !normalizedCurrentPrimaryKeyValue
  ) {
    return emptyMaintenanceState();
  }
  const activeRelations = Object.fromEntries(Object.entries(viewConfig.relations).filter(([, relationConfig]) => (
    relationConfig.targetFile === selectedPath
    && relationConfig.targetCollection === collectionPath
    && relationConfig.targetKey === primaryKeyField
  )));
  const activeDocumentFields = listDocumentFieldsForCollection(viewConfig, selectedPath, collectionPath)
    .filter(({ fieldPath }) => fieldPath.length === 1 && fieldPath[0] !== primaryKeyField);
  const activeRelationKeys = Object.keys(activeRelations);
  if (!activeRelationKeys.length && !activeDocumentFields.length) {
    return emptyMaintenanceState();
  }
  const sourceFiles = [...new Set(activeRelationKeys.map((key) => parseRelationKey(key)?.sourceFile).filter(Boolean))];
  const documentsByPath = {};
  for (const path of sourceFiles) {
    try {
      documentsByPath[path] = path === selectedPath && model ? model : await loadDocument(path);
    } catch {
      // Missing source files are surfaced by buildPrimaryKeySyncPlan blocking issues.
    }
  }
  const relationBacklinks = collectRelationBacklinks({
    targetFile: selectedPath,
    targetCollection: collectionPath,
    targetKey: primaryKeyField,
    targetId: previousPrimaryKeyValue ?? currentPrimaryKeyValue,
    relations: activeRelations,
    documentsByPath,
  });
  const primaryKeyImpacts = {
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
  const primaryKeySyncPlan = buildPrimaryKeySyncPlan({
    targetFile: selectedPath,
    targetCollection: collectionPath,
    targetKey: primaryKeyField,
    targetRowLabel: selectedRowLabel ?? `${collectionPath}:${String(previousPrimaryKeyValue ?? currentPrimaryKeyValue ?? "")}`,
    targetRowIndex: selectedSourceRowIndex,
    oldValue: previousPrimaryKeyValue,
    newValue: currentPrimaryKeyValue,
    relations: activeRelations,
    documentsByPath,
    targetRows: rows,
  });
  const documentRewrites = collectDocumentFieldRewrites({
    selectedPath,
    collectionPath,
    selectedRow,
    selectedSourceRowIndex,
    selectedRowLabel,
    activeDocumentFields,
    oldValue: previousPrimaryKeyValue,
    newValue: currentPrimaryKeyValue,
  });
  if (documentRewrites.length) {
    primaryKeyImpacts[primaryKeyField] = {
      ...primaryKeyImpacts[primaryKeyField],
      affectedCount: primaryKeyImpacts[primaryKeyField].affectedCount + documentRewrites.length,
    };
    primaryKeySyncPlan.rewrites.push(...documentRewrites);
    primaryKeySyncPlan.matchedBacklinks.push(...documentRewrites);
    if (!primaryKeySyncPlan.sourceFiles.includes(selectedPath)) {
      primaryKeySyncPlan.sourceFiles = [...primaryKeySyncPlan.sourceFiles, selectedPath].sort();
    }
  }
  return {
    relationBacklinks,
    primaryKeyImpacts,
    primaryKeySyncPlan,
  };
}

function collectDocumentFieldRewrites({
  selectedPath,
  collectionPath,
  selectedSourceRowIndex,
  selectedRowLabel,
  activeDocumentFields,
  oldValue,
  newValue,
}) {
  const normalizedOldValue = oldValue == null ? "" : String(oldValue);
  const normalizedNewValue = newValue == null ? "" : String(newValue);
  if (!normalizedOldValue || normalizedOldValue === normalizedNewValue) return [];
  return activeDocumentFields
    .filter(({ fieldPath }) => fieldPath.length === 1)
    .map(({ fieldPath }) => ({
      relationKey: `document:${selectedPath}:${collectionPath}:${fieldPath.join(".")}`,
      sourceFile: selectedPath,
      sourceCollection: collectionPath,
      fieldPath,
      rowIndex: selectedSourceRowIndex ?? -1,
      rowId: undefined,
      rowLabel: selectedRowLabel ? String(selectedRowLabel) : `${collectionPath}:${normalizedOldValue}`,
      oldValue: normalizedOldValue,
      newValue: normalizedNewValue,
    }))
    .filter(({ rowIndex }) => rowIndex >= 0);
}

function emptyMaintenanceState() {
  return {
    relationBacklinks: [],
    primaryKeyImpacts: {},
    primaryKeySyncPlan: null,
  };
}
