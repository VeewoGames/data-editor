import type { FieldDisplayType } from "../model/fieldTypes";

export type FieldMenuCapabilities = {
  canChangeType: boolean;
  allowedTypeTargets: FieldDisplayType[];
  canBeTitle: boolean;
  canBePrimaryKey: boolean;
  canConfigureRelation: boolean;
  canConfigureDocument: boolean;
};

export function computeFieldMenuCapabilities(input: {
  baseDisplayType: FieldDisplayType;
  roleKind?: "normal" | "relation" | "backlink";
  isNested?: boolean;
  isBacklink?: boolean;
  relationConfigured?: boolean;
  documentConfigured?: boolean;
  isTitle?: boolean;
  isPrimaryKey?: boolean;
}): FieldMenuCapabilities;
