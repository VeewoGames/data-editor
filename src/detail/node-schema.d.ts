import type { FieldDisplayType } from "../model/fieldTypes";

export type NodePathSegment = string | number;

export type NodeFieldOption = {
  value: string | number;
  label: string;
};

export type NodeFieldSchema = {
  fieldName: string;
  displayType?: FieldDisplayType;
  required?: boolean;
  nullable?: boolean;
  defaultValue?: unknown;
  multiline?: boolean;
  placeholder?: string;
  options?: NodeFieldOption[];
  nestedNodeKind?: "object" | "array";
};

export type ObjectNodeSchema = {
  nodeKind: "object";
  title: string;
  fields: NodeFieldSchema[];
  defaultValue: Record<string, unknown>;
  allowUnknownFields?: boolean;
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
