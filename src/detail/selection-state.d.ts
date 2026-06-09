import type { CollectionStore, TableRowView } from "../model/document-store";

export type DetailRowTarget = {
  sourceRowIndex: number;
  rowId: string | null;
};

export type DetailSelectionState = {
  visibleRowViews: TableRowView[];
  selectedRowView: TableRowView | null;
  selectedRow: Record<string, unknown> | null;
  resolvedRowId: string | null;
  resolvedSourceRowIndex: number | null;
  selectedVisibleRowPosition: number | null;
  previousRowTarget: DetailRowTarget | null;
  nextRowTarget: DetailRowTarget | null;
};

export function buildVisibleRowViews(collectionStore: CollectionStore | null, visibleRowIds: string[], previousVisibleRowViews?: TableRowView[] | null): TableRowView[];
export function buildDetailSelectionState(input: {
  collectionStore: CollectionStore | null;
  visibleRowIds: string[];
  selectedRowId: string | null;
  selectedRowIndex: number | null;
  previousVisibleRowViews?: TableRowView[] | null;
}): DetailSelectionState;
export function resolveDetailSelectionSync(input: {
  collectionStore: CollectionStore | null;
  selectedRowId: string | null;
  selectedRowIndex: number | null;
}): { nextRowId: string | null; nextRowIndex: number | null } | null;
