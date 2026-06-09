import type { BacklinkGridColumn } from "../model/backlinkGrid";
import type { DataRecord } from "../model/documentModel";
import type { FieldDisplayType } from "../model/fieldTypes";
import type { RelationOption } from "../model/relations";
import type { MultiSelectOptionView, RelationConfig } from "../model/viewConfig";

type OptionConfig = {
  options: MultiSelectOptionView[];
  optionMap: Record<string, MultiSelectOptionView>;
};

export type TableColumnModel = {
  fieldName: string;
  displayType: FieldDisplayType;
  roleKind: "normal" | "relation" | "backlink";
  allowTypeChange: boolean;
  relationConfigured: boolean;
  relationConfig: RelationConfig | null;
  relationOptions: RelationOption[];
  wrapped: boolean;
  width: number;
  isNested: boolean;
  isTitle: boolean;
  isBacklink: boolean;
  multiSelectConfig?: OptionConfig;
  selectConfig?: OptionConfig;
  backlinkColumn?: BacklinkGridColumn;
};

export function buildTableColumnModels(input: {
  visibleFields: string[];
  rows: DataRecord[];
  nestedFieldSet: Set<string>;
  displayTypes: Record<string, FieldDisplayType>;
  wrappedFields: Set<string>;
  detectedTitleField: string | null;
  backlinkColumns: BacklinkGridColumn[];
  relationOptionsByField: Record<string, RelationOption[]>;
  relationConfigByField: Record<string, RelationConfig | null>;
  fieldOptions: Record<string, OptionConfig>;
  selectOptions: Record<string, OptionConfig>;
  getColumnWidth: (fieldName: string) => number;
}): TableColumnModel[];

export function getColumnModelDisplayType(fieldName: string, columnModels: TableColumnModel[]): FieldDisplayType | null;
