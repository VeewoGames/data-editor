import type { DocumentModel } from "./documentModel";
import type { BacklinkGridColumn } from "./backlinkGrid";
import type { RelationBacklink } from "./relationMaintenance";
import type { ViewConfig } from "./viewConfig";

export declare function buildBacklinkLookupState(input: {
  targetFile: string;
  targetCollection: string;
  rows: Record<string, unknown>[];
  viewConfig: ViewConfig;
  activeModel: DocumentModel;
  loadDocument: (path: string) => Promise<DocumentModel>;
}): Promise<{
  backlinkColumns: BacklinkGridColumn[];
  backlinkValuesByRowId: Record<string, Record<string, RelationBacklink[]>>;
}>;
