export type BacklinkGridColumn = {
  backlinkKey: string;
  fieldName: string;
  sourceRelation: string;
  targetKey: string;
  status: "active" | "missing-source";
  message?: string;
};

export type BacklinkGridItem = {
  relationKey: string;
  sourceFile: string;
  sourceCollection: string;
  fieldPath: string[];
  rowIndex: number;
  title: string;
  value: string;
};

export {
  buildBacklinkGrid,
  getBacklinkColumnsForView,
} from "./backlink-grid.mjs";
