export interface RowHeightIndex {
 rowIds: string[];
 prefix(end: number): number;
 indexAt(offset: number): number;
 position(id: string): number | undefined;
 height(index: number): number;
 update(rowId: string, height: number): boolean;
 takeVisitCount(): number;
}
export function createRowHeightIndex(rowIds: string[], getRowHeight: (rowId: string, index: number) => number): RowHeightIndex;
export function buildVariableRowWindow(input: { index: RowHeightIndex; viewportHeight: number; scrollTop: number; overscan: number }): {windowStart: number; windowEnd: number; topSpacerHeight: number; bottomSpacerHeight: number; totalHeight: number};
export function captureRowAnchor(index: RowHeightIndex, scrollTop: number): {rowId: string; position: number; offset: number} | null;
export function restoreRowAnchor(previous: RowHeightIndex, next: RowHeightIndex, anchor: ReturnType<typeof captureRowAnchor>): number;
