export type RelationPathInput = {
  sourceFile: string;
  sourceCollection: string;
  fieldPath: Array<string | number>;
};

export { buildRelationKey, matchRelationKey, normalizeFieldPath } from "./relation-path.mjs";
