import type { DataRecord } from "../model/documentModel";
import type { TableRowView } from "../model/document-store";

export type VisibleTableRenderRow = DataRecord & {
  __rowIndex: number;
  __rowId: string;
};

export function buildVisibleTableRenderContract(input: {
  rowViews: TableRowView[];
  windowStart: number;
  previousContract?: {
    rows: VisibleTableRenderRow[];
  } | null;
}): {
  rows: VisibleTableRenderRow[];
  rowIds: string[];
  windowStart: number;
  rowCount: number;
};
