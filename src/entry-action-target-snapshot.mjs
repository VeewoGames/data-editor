import { getRows } from "./document-model.mjs";
import { readPersistentEntryId } from "./model/persistent-entry-id.mjs";
import { readRowId } from "./model/row-id.mjs";

/** Resolve the clicked entry from the live model after drafts and saves finish. */
export function resolveEntryActionTargetSnapshot(model, collectionPath, rowId) {
  if (!model || !rowId) throw new Error("自动化目标条目已不可用，请重新打开条目后再执行。");
  const rows = getRows(model, collectionPath);
  const matches = rows.flatMap((row, sourceRowIndex) => {
    const sourceRow = model.rootCollectionKind === "record-map" && collectionPath === "$"
      ? model.root[row[model.rootKeyField]] : row;
    return (readPersistentEntryId(sourceRow) ?? readRowId(sourceRow)) === rowId
      ? [{ row, sourceRowIndex }] : [];
  });
  if (matches.length !== 1) throw new Error("自动化目标条目已变化或无法唯一定位，请重新打开条目后再执行。");
  return { row: structuredClone(matches[0].row), sourceRowIndex: matches[0].sourceRowIndex };
}
