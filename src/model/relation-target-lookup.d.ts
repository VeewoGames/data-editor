import type { DocumentModel } from "./documentModel";
import type { RelationConfig } from "./viewConfig";

export type RelationTargetSelection = {
  targetFile: string;
  targetCollection: string;
  rowIndex: number;
  rowId: string | null;
};

export function resolveRelationTargetSelection(input: {
  relationConfig: RelationConfig;
  targetValue: string | number;
  activeFilePath: string | null;
  activeModel: DocumentModel | null;
  loadDocument: (path: string) => Promise<DocumentModel>;
}): Promise<RelationTargetSelection | null>;
