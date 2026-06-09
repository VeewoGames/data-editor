import type { DocumentModel } from "./documentModel";
import type { PrimaryKeyImpact, PrimaryKeySyncPlan, RelationBacklink } from "./relationMaintenance";
import type { ViewConfig } from "./viewConfig";

export declare function buildMaintenanceLookupState(input: {
  selectedPath: string | null;
  collectionPath: string;
  selectedRow: Record<string, unknown> | null;
  selectedSourceRowIndex: number | null;
  selectedRowLabel: string | null;
  model: DocumentModel | null;
  rows: Record<string, unknown>[];
  savedRoot: unknown;
  viewConfig: ViewConfig;
  activeProjectId?: string | null;
  loadDocument: (path: string) => Promise<DocumentModel>;
}): Promise<{
  relationBacklinks: RelationBacklink[];
  primaryKeyImpacts: Record<string, PrimaryKeyImpact>;
  primaryKeySyncPlan: PrimaryKeySyncPlan | null;
}>;
