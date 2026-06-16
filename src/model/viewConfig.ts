export type MultiSelectOptionColor =
  | "default"
  | "gray"
  | "brown"
  | "orange"
  | "yellow"
  | "green"
  | "blue"
  | "purple"
  | "pink"
  | "red";

export type MultiSelectOptionView = {
  value: string;
  label: string;
  color: MultiSelectOptionColor | null;
};

export type SingleSelectOptionView = {
  value: string;
  label: string;
  color: MultiSelectOptionColor | null;
};

export type RealFieldType = "Text" | "Select";
export type RelationMode = "single" | "multi";
export type BacklinkDisplayMode = "list";

export type FieldViewConfig = {
  type?: RealFieldType;
  selectOptions: Record<string, { label: string; color: MultiSelectOptionColor | null }>;
  multiSelectOptions: Record<string, { label: string; color: MultiSelectOptionColor | null }>;
};

export type RelationConfig = {
  targetFile: string;
  targetCollection: string;
  targetKey: string;
  mode: RelationMode;
  titleFields: string[];
  allowMissing: boolean;
};

export type BacklinkConfig = {
  sourceRelation: string;
  displayMode: BacklinkDisplayMode;
};

export type ViewConfig = {
  fields: Record<string, FieldViewConfig>;
  titleFields: Record<string, string>;
  primaryKeys: Record<string, string>;
  backlinks: Record<string, BacklinkConfig>;
  relations: Record<string, RelationConfig>;
  relationsVersion: number;
};
