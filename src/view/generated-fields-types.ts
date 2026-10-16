import type { DataRecord } from "../model/documentModel";
export type GeneratedFieldsResponse = { projectId: string; sourcePath: string; collectionPath: string; generation: number; documentEtag: string | null; fields: { name: string; type: "Boolean" }[]; bindings: { bindingId: string; identityField: string; fields: {name: string; type: "Boolean"}[]; state: string; reason: string | null; artifactDigest: string | null; rows: {id: string; state: string; values?: Record<string, boolean>; reason?: string}[] }[] };
export type DerivedFieldProjectionContext = { sourcePath?: string | null; collectionPath?: string; generated?: GeneratedFieldsResponse | null; dirty?: boolean; declarationPending?: boolean; row?: DataRecord };

export type GeneratedRefreshScope = { key: string; projectId: string | null; sourcePath: string | null; collectionPath: string; documentEtag: string | undefined; dirty: boolean };
