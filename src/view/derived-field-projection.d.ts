import type { DataRecord } from "../model/documentModel";
import type { ViewEngineRow } from "./contracts";
import type { FieldDisplayType } from "../model/fieldTypes";

export type DerivedFieldProjectionContext = { sourcePath?: string | null; collectionPath?: string };
export const derivedFieldNames: readonly string[];
export const derivedFieldTypes: Readonly<Record<string, FieldDisplayType>>;
export function shouldProjectSkillTargetingFields(sourcePath?: string | null, collectionPath?: string): boolean;
export function isDerivedField(fieldName: string): boolean;
export function discoverProjectedFields(fields: string[], context?: DerivedFieldProjectionContext): string[];
export function projectDerivedFields(row: DataRecord, context?: DerivedFieldProjectionContext): DataRecord;
export function projectViewEngineRows(rows: ViewEngineRow[], context?: DerivedFieldProjectionContext): ViewEngineRow[];
