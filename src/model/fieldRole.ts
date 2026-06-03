import type { BacklinkConfig, RelationConfig, ViewConfig } from "./viewConfig";

export type ResolvedFieldRole =
  | { kind: "normal" }
  | { kind: "primaryKey"; primaryKey: string }
  | { kind: "relation"; relationKey: string; config: RelationConfig }
  | { kind: "backlink"; backlinkKey: string; config: BacklinkConfig };

export {
  buildBacklinkFieldName,
  syncBacklinksWithRelations,
  deriveBacklinkConfigs,
  getPrimaryKeyField,
  resolveFieldRole,
} from "./field-role.mjs";
