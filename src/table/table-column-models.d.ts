import type { BacklinkGridColumn } from "../model/backlinkGrid";
import type { DataRecord } from "../model/documentModel";
import type { FieldDisplayType } from "../model/fieldTypes";
import type { RelationOption } from "../model/relations";
import type { MultiSelectOptionView, RelationConfig } from "../model/viewConfig";
import type { FieldMenuCapabilities } from "./field-capabilities";

type OptionConfig = {
  options: MultiSelectOptionView[];
  optionMap: Record<string, MultiSelectOptionView>;
};

export type TableColumnModel = {
  fieldName: string;
  baseDisplayType: FieldDisplayType;
  effectiveDisplayType: FieldDisplayType;
  roleKind: "normal" | "relation" | "backlink";
  capabilities: FieldMenuCapabilities;
  allowTypeChange: boolean;
  relationConfigured: boolean;
  documentConfigured: boolean;
  relationConfig: RelationConfig | null;
  relationOptions: RelationOption[];
  wrapped: boolean;
  width: number;
  isNested: boolean;
  isTitle: boolean;
  isPrimaryKey: boolean;
  isBacklink: boolean;
  multiSelectConfig?: OptionConfig;
  selectConfig?: OptionConfig;
  documentLabels?: Record<string, string>;
  backlinkColumn?: BacklinkGridColumn;
};

export function buildTableColumnModels(input: {
  visibleFields: string[];
  rows: DataRecord[];
  nestedFieldSet: Set<string>;
  displayTypes: Record<string, FieldDisplayType>;
  wrappedFields: Set<string>;
  detectedTitleField: string | null;
  primaryKeyField?: string | null;
  backlinkColumns: BacklinkGridColumn[];
  relationOptionsByField: Record<string, RelationOption[]>;
  relationConfigByField: Record<string, RelationConfig | null>;
  fieldOptions: Record<string, OptionConfig>;
  selectOptions: Record<string, OptionConfig>;
  documentLabelsByField?: Record<string, Record<string, string>>;
  documentConfiguredFields?: Set<string>;
  getColumnWidth: (fieldName: string) => number;
  previousByField?: Record<string, TableColumnModel>;
}): TableColumnModel[];

export function getColumnModelDisplayType(fieldName: string, columnModels: TableColumnModel[]): FieldDisplayType | null;
