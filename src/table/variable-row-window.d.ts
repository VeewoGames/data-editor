export function buildVariableRowWindow(input: {
  rowIds: string[];
  viewportHeight: number;
  scrollTop: number;
  overscan: number;
  getRowHeight: (rowId: string, index: number) => number;
}): {
  windowStart: number;
  windowEnd: number;
  topSpacerHeight: number;
  bottomSpacerHeight: number;
  totalHeight: number;
};
