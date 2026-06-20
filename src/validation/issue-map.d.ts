import type { ViewConfig } from "../api/client";
import type { DataRecord } from "../model/documentModel";
import type { FieldDisplayType } from "../model/fieldTypes";
import type { ValidationIssue } from "../model/validation";
import type { CollectionStore } from "../model/document-store";
import type { RelationConfig } from "../model/viewConfig";

export interface ValidationFieldConfig {
  displayTypes: Record<string, FieldDisplayType>;
  isCompatible: (displayType: FieldDisplayType, value: unknown) => boolean;
}

export interface ValidationRuleConfig {
  primaryKeys: ViewConfig["primaryKeys"];
  relations: Record<string, RelationConfig>;
}

export interface ValidationSnapshot {
  byRowId: Record<string, Record<string, ValidationIssue | null>>;
  byRowIndex: Record<string, Record<string, ValidationIssue | null>>;
  collectionIssues: Record<string, ValidationIssue | null>;
}

export interface ValidationRowFieldInvalidation {
  type: "row-field";
  rowId: string | null;
  rowIndex: number | null;
  fieldName: string;
}

export interface ValidationFieldInvalidation {
  type: "field";
  fieldName: string;
}

export declare function buildValidationIssueMap(input: {
  rows: DataRecord[];
  collectionStore: CollectionStore | null;
  fieldConfig: ValidationFieldConfig;
  relationIndexes: Record<string, Set<string> | null>;
  validationConfig: ValidationRuleConfig;
  sourcePath: string;
  collectionPath: string;
}): Record<string, ValidationIssue | null>;

export declare function buildValidationSnapshot(input: {
  rows: DataRecord[];
  collectionStore: CollectionStore | null;
  fieldConfig: ValidationFieldConfig;
  relationIndexes: Record<string, Set<string> | null>;
  validationConfig: ValidationRuleConfig;
  sourcePath: string;
  collectionPath: string;
}): ValidationSnapshot;

export declare function applyValidationIssueOverrides(
  snapshot: ValidationSnapshot,
  overrides: Record<string, ValidationIssue | null>,
): ValidationSnapshot;

export declare function patchValidationSnapshotForRowField(input: {
  previousSnapshot: ValidationSnapshot;
  invalidation: ValidationRowFieldInvalidation;
  rows: DataRecord[];
  collectionStore: CollectionStore | null;
  fieldConfig: ValidationFieldConfig;
  relationIndexes: Record<string, Set<string> | null>;
  validationConfig: ValidationRuleConfig;
  sourcePath: string;
  collectionPath: string;
}): ValidationSnapshot | null;

export declare function patchValidationSnapshotForField(input: {
  previousSnapshot: ValidationSnapshot;
  invalidation: ValidationFieldInvalidation;
  rows: DataRecord[];
  collectionStore: CollectionStore | null;
  fieldConfig: ValidationFieldConfig;
  relationIndexes: Record<string, Set<string> | null>;
  validationConfig: ValidationRuleConfig;
  sourcePath: string;
  collectionPath: string;
}): ValidationSnapshot | null;

export declare function buildIssueKey(
  collectionStore: CollectionStore | null,
  rowIndex: number,
  fieldName: string,
): string;
