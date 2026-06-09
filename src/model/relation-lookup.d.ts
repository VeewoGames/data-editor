import type { DocumentModel } from "./documentModel";
import type { RelationOption } from "./relations";
import type { RelationConfig } from "./viewConfig";

export declare function buildRelationLookupState(input: {
  relations: Record<string, RelationConfig>;
  activeFilePath?: string | null | undefined;
  activeModel?: DocumentModel | null | undefined;
  loadDocument: (path: string) => Promise<DocumentModel>;
}): Promise<{
  relationIndexes: Record<string, Set<string> | null>;
  relationOptions: Record<string, RelationOption[]>;
}>;
