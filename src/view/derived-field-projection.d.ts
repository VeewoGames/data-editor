import type { DataRecord } from "../model/documentModel";
import type { ViewEngineRow } from "./contracts";
import type { DerivedFieldProjectionContext } from "./generated-fields-types";
export type { GeneratedFieldsResponse, DerivedFieldProjectionContext } from "./generated-fields-types";
export function generatedFieldState(row: unknown, fieldName: string): {ready: boolean; reason: string} | null;
export function copyGeneratedMetadata<T>(source: unknown, target: T): T;
export function isDerivedField(fieldName?: string, context?: DerivedFieldProjectionContext): boolean;
export function discoverProjectedFields(fields: string[], context?: DerivedFieldProjectionContext): string[];
export function projectDerivedFields(row: DataRecord, context?: DerivedFieldProjectionContext): DataRecord;
export function projectViewEngineRows(rows: ViewEngineRow[], context?: DerivedFieldProjectionContext): ViewEngineRow[];

export function projectPendingGeneratedComparisons(rows: ViewEngineRow[], filters: unknown): ViewEngineRow[];
