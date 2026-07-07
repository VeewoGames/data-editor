export type EntryActionFeedbackSelection = {
  sourcePath: string | null;
  collectionPath: string;
  rowId: string | null;
  sourceRowIndex: number | null;
};

export function shouldPreserveEntryActionFeedback(
  current: EntryActionFeedbackSelection,
  next: EntryActionFeedbackSelection,
): boolean {
  if (!current.sourcePath || !next.sourcePath) return false;
  if (current.sourcePath !== next.sourcePath) return false;
  if (current.collectionPath !== next.collectionPath) return false;

  if (current.rowId && next.rowId) {
    return current.rowId === next.rowId;
  }

  return current.sourceRowIndex != null
    && next.sourceRowIndex != null
    && current.sourceRowIndex === next.sourceRowIndex;
}
