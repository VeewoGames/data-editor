import type { FieldDisplayType } from "../model/fieldTypes";

export type NodePathSegment = string | number;

export type NodeFieldOption = {
  value: string | number;
  label: string;
};

export type NodeFieldCondition = {
  fieldName: string;
  operator: "equals" | "not_equals" | "in" | "not_in" | "truthy" | "falsy";
  value?: unknown;
  values?: unknown[];
} | {
  operator: "all" | "any" | "none";
  conditions: NodeFieldCondition[];
};

export type NodeArrayItemSchema = {
  valueType: "string" | "number" | "boolean" | "object" | "array";
  numericType?: "int" | "float";
  min?: number;
  max?: number;
  options?: NodeFieldOption[];
  fields?: NodeFieldSchema[];
  items?: NodeArrayItemSchema;
  schemaRef?: "skill-node";
};

export type NodeSchemaConstraint = {
  code: string;
  kind: "required" | "forbidden" | "compare" | "custom";
  fieldNames: string[];
  when?: NodeFieldCondition | NodeFieldCondition[];
  operator?: string;
  value?: unknown;
  message?: string;
  sourceVariant?: string;
};

export type NodeSchemaPresentation = {
  sections?: Array<{ id: string; title: string; fieldNames: string[] }>;
  advancedFields?: string[];
  summaryFields?: string[];
  titleField?: string;
};

export type NodeFieldSchema = {
  fieldName: string;
  valueType?: "int" | "float" | "string" | "bool" | "array" | "dict";
  min?: number;
  max?: number;
  displayType?: FieldDisplayType;
  required?: boolean;
  readonly?: boolean;
  nullable?: boolean;
  defaultValue?: unknown;
  omitWhenDefault?: boolean;
  multiline?: boolean;
  placeholder?: string;
  options?: NodeFieldOption[];
  nestedNodeKind?: "object" | "array";
  nestedSchema?: ObjectNodeSchema | DiscriminatedObjectNodeSchema;
  arrayItem?: NodeArrayItemSchema;
  visibleWhen?: NodeFieldCondition | NodeFieldCondition[];
  disabledWhen?: NodeFieldCondition | NodeFieldCondition[];
};

export type ObjectNodeSchema = {
  nodeKind: "object";
  title: string;
  fields: NodeFieldSchema[];
  defaultValue: Record<string, unknown>;
  allowUnknownFields?: boolean;
  presentation?: NodeSchemaPresentation | null;
  constraints?: NodeSchemaConstraint[];
  omitDefaults?: boolean;
};

export type DiscriminatedObjectNodeSchema = {
  discriminatorField: string;
  variants: Record<string, ObjectNodeSchema>;
  defaultVariant?: string | null;
};

export type ResolveNestedNodeSchemaContext = {
  sourcePath?: string | null;
  collectionPath?: string;
  rootField: string;
  nestedPath: NodePathSegment[];
  value: unknown;
  contextValue?: unknown;
};

export type ResolveNestedNodeSchemaResult =
  | {
      kind: "supported";
      schema: ObjectNodeSchema;
      lookupKey: string;
      discriminatorField?: string;
      discriminatorOptions?: string[];
      currentDiscriminator?: string | null;
      defaultDiscriminator?: string | null;
      canSwitchDiscriminator?: boolean;
      variantDefaults?: Record<string, Record<string, unknown>>;
    }
  | {
      kind: "unsupported";
      lookupKey: string;
      reason: string;
    };
