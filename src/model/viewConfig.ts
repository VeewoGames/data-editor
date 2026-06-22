export type MultiSelectOptionColor =
  | "default"
  | "gray"
  | "brown"
  | "orange"
  | "yellow"
  | "green"
  | "blue"
  | "teal"
  | "cyan"
  | "lime"
  | "indigo"
  | "rose"
  | "amber"
  | "purple"
  | "pink"
  | "red"
  | "mid_gray"
  | "mid_brown"
  | "mid_orange"
  | "mid_yellow"
  | "mid_green"
  | "mid_blue"
  | "mid_teal"
  | "mid_cyan"
  | "mid_lime"
  | "mid_indigo"
  | "mid_purple"
  | "mid_pink"
  | "mid_red"
  | "mid_rose"
  | "mid_amber"
  | "dark_gray"
  | "dark_brown"
  | "dark_orange"
  | "dark_yellow"
  | "dark_green"
  | "dark_blue"
  | "dark_teal"
  | "dark_cyan"
  | "dark_lime"
  | "dark_indigo"
  | "dark_purple"
  | "dark_pink"
  | "dark_red"
  | "dark_rose"
  | "dark_amber";

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

export type RealFieldType = "Text" | "Select" | "Document";
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

export type DocumentFileConfig = {
  docRoot: string;
};

export type DocumentFieldConfig = {
  enabled: true;
};

export type ViewConfig = {
  fields: Record<string, FieldViewConfig>;
  titleFields: Record<string, string>;
  documentFiles: Record<string, DocumentFileConfig>;
  documentFields: Record<string, DocumentFieldConfig>;
  primaryKeys: Record<string, string>;
  backlinks: Record<string, BacklinkConfig>;
  relations: Record<string, RelationConfig>;
  relationsVersion: number;
};
