import { buildDocumentStore } from "./document-store.mjs";
import { buildBacklinkGrid, getBacklinkColumnsForView } from "./backlink-grid.mjs";

/**
 * @param {{
 *   targetFile: string;
 *   targetCollection: string;
 *   rows: Record<string, unknown>[];
 *   viewConfig: import("./viewConfig").ViewConfig;
 *   activeModel: import("./documentModel").DocumentModel;
 *   loadDocument: (path: string) => Promise<import("./documentModel").DocumentModel>;
 * }} input
 * @returns {Promise<{
 *   errors: Array<{key:string;message:string}>;
 *   backlinkColumns: import("./backlinkGrid").BacklinkGridColumn[];
 *   backlinkValuesByRowId: Record<string, Record<string, import("./relationMaintenance").RelationBacklink[]>>;
 * }>}
 */
export async function buildBacklinkLookupState({
  targetFile,
  targetCollection,
  rows,
  viewConfig,
  activeModel,
  loadDocument,
}) {
  const errors=[];
  const backlinkColumns = getBacklinkColumnsForView({
    targetFile,
    targetCollection,
    viewConfig,
  });
  if (!backlinkColumns.length) {
    return {
      errors,
      backlinkColumns: [],
      backlinkValuesByRowId: {},
    };
  }
  const sourceFiles = [...new Set(backlinkColumns.map((column) => column.sourceRelation.split(":")[0]).filter(Boolean))];
  const documentsByPath = {};
  for (const path of sourceFiles) {
    try {
      documentsByPath[path] = path === targetFile ? activeModel : await loadDocument(path);
    } catch (error) {
      errors.push({key:path,message:error.message});
      // Keep the declaration, with an explicit unavailable state at the caller.
    }
  }
  const grid = buildBacklinkGrid({
    targetFile,
    targetCollection,
    rows,
    viewConfig,
    documentsByPath,
  });
  const collectionStore = buildDocumentStore({
    documentId: targetFile,
    model: activeModel,
  }).collections.get(targetCollection) ?? null;
  return {
    errors,
    backlinkColumns: grid.columns,
    backlinkValuesByRowId: remapBacklinkValuesByRowId(grid.valuesByRowIndex, collectionStore),
  };
}

function remapBacklinkValuesByRowId(valuesByRowIndex, collectionStore) {
  if (!collectionStore) return {};
  const result = {};
  for (const [rowIndexKey, fieldMap] of Object.entries(valuesByRowIndex ?? {})) {
    const rowId = collectionStore.rowViews[Number(rowIndexKey)]?.rowId;
    if (!rowId) continue;
    result[rowId] = fieldMap;
  }
  return result;
}
