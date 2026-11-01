import type { DocumentModel } from "./documentModel";
import type { RelationOption } from "./relations";
import type { RelationConfig } from "./viewConfig";

export declare function buildRelationLookupState(input: {
  relations: Record<string, RelationConfig>;
  activeFilePath?: string | null | undefined;
  activeModel?: DocumentModel | null | undefined;
  sourceFilePath?: string | null | undefined;
  sourceCollectionPath?: string | null | undefined;
  loadDocument: (path: string) => Promise<DocumentModel>;
}): Promise<{
  errors: Array<{key:string;message:string}>;
  relationIndexes: Record<string, Set<string> | null>;
  relationOptions: Record<string, RelationOption[]>;
}>;
export function relationLookupScope(projectId: string | null, file: string | null, collection: string, relations: unknown): string;
export function relationLookupForScope<I,O>(scope: string, state: {scope: string | null; indexes: I; options: O}): {indexes: I; options: O};
