export function resolveRowHeight(rowId: string, measuredHeights: Record<string, number>, estimatedHeight: number): number;
export function mergeMeasuredRowHeights(
  previous: Record<string, number>,
  nextMeasurements: Record<string, number>,
): Record<string, number>;
