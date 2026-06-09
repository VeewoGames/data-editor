import type { DocumentModel } from "./documentModel";
import type { RelationConfig } from "./viewConfig";
import {
  analyzePrimaryKeyChange as analyzePrimaryKeyChangeCore,
  buildPrimaryKeySyncPlan as buildPrimaryKeySyncPlanCore,
  collectRelationBacklinks as collectRelationBacklinksCore,
  findTargetRecord as findTargetRecordCore,
  parseRelationKey as parseRelationKeyCore,
} from "./relation-maintenance.mjs";

export type ParsedRelationKey = {
  sourceFile: string;
  sourceCollection: string;
  fieldPath: string[];
};

export type RelationBacklink = {
  relationKey: string;
  sourceFile: string;
  sourceCollection: string;
  fieldPath: string[];
  rowIndex: number;
  rowId?: string | null;
  title: string;
};

export type PrimaryKeyImpact = {
  targetFile: string;
  targetCollection: string;
  targetKey: string;
  oldValue: string;
  newValue: string;
  affectedCount: number;
  backlinks: RelationBacklink[];
};

export type RelationRewriteItem = {
  relationKey: string;
  sourceFile: string;
  sourceCollection: string;
  fieldPath: string[];
  rowIndex: number;
  rowId?: string | null;
  rowLabel: string;
  oldValue: string;
  newValue: string;
};

export type SkippedRelationRewriteItem = RelationRewriteItem & {
  reason: "unsupported-multi" | "unsupported-nested-path";
};

export type PrimaryKeySyncPlan = {
  targetFile: string;
  targetCollection: string;
  targetKey: string;
  targetRowLabel: string;
  oldValue: string;
  newValue: string;
  sourceFiles: string[];
  matchedBacklinks: RelationRewriteItem[];
  rewrites: RelationRewriteItem[];
  skipped: SkippedRelationRewriteItem[];
  blockingIssues: string[];
  warnings: string[];
};

export const parseRelationKey = parseRelationKeyCore as (relationKey: string) => ParsedRelationKey | null;
export const findTargetRecord = findTargetRecordCore as (
  rows: Record<string, unknown>[],
  targetKey: string,
  targetId: string | number,
) => { rowIndex: number; rowId?: string | null; row: Record<string, unknown> } | null;
export const collectRelationBacklinks = collectRelationBacklinksCore as (input: {
  targetFile: string;
  targetCollection: string;
  targetKey: string;
  targetId: string | number;
  relations: Record<string, RelationConfig>;
  documentsByPath: Record<string, DocumentModel>;
}) => RelationBacklink[];
export const analyzePrimaryKeyChange = analyzePrimaryKeyChangeCore as (input: {
  targetFile: string;
  targetCollection: string;
  targetKey: string;
  oldValue: unknown;
  newValue: unknown;
  relations: Record<string, RelationConfig>;
  documentsByPath: Record<string, DocumentModel>;
}) => PrimaryKeyImpact;
export const buildPrimaryKeySyncPlan = buildPrimaryKeySyncPlanCore as (input: {
  targetFile: string;
  targetCollection: string;
  targetKey: string;
  targetRowLabel?: string;
  targetRowIndex?: number | null;
  oldValue: unknown;
  newValue: unknown;
  relations: Record<string, RelationConfig>;
  documentsByPath: Record<string, DocumentModel>;
  targetRows?: Record<string, unknown>[];
}) => PrimaryKeySyncPlan;
