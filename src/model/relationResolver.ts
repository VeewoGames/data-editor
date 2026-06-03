import type { RelationConfig } from "./viewConfig";
import type { RelationOption } from "./relations";

export type ResolvedRelationField =
  | { kind: "none" }
  | { kind: "incompatible"; relationKey: string; expectedMode: "single" | "multi" }
  | {
      kind: "configured";
      relationKey: string;
      config: RelationConfig;
      options: RelationOption[];
      missingValues: string[];
    };

export { isRelationValueCompatible, resolveRelationField } from "./relation-resolver.mjs";
