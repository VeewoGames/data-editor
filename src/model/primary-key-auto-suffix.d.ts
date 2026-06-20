import type { DataRecord } from "./documentModel";

export declare function resolveAutoSuffixedPrimaryKeyValue(input: {
  rows: DataRecord[];
  fieldName: string;
  value: unknown;
  excludeRowIndex?: number | null;
}): {
  value: unknown;
  adjusted: boolean;
};
