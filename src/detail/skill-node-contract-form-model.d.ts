import type { ObjectNodeSchema, ResolveNestedNodeSchemaContext, ResolveNestedNodeSchemaResult } from "./node-schema";

export type ContractFormFieldState = {
  field: ObjectNodeSchema["fields"][number];
  visible: boolean;
  disabled: boolean;
  readonly: boolean;
};
export type ContractFormContext = {
  selection?: Record<string, unknown>;
  targeting?: Record<string, unknown>;
  rootValue?: { nodes?: unknown[] };
  fieldPath?: string;
};
export type ContractFormConstraintDiagnostic = { code: string; fieldPath: string };
export type ContractFormConstraintResult = {
  valid: boolean;
  diagnostics: ContractFormConstraintDiagnostic[];
  consumes: string[];
  consumerEntries: Array<{ nodePath: string; nodeType: string; consumes: string[] }>;
  affectsMode: "none" | "explicit" | "required" | "forbidden" | "inherit_selection";
  effectiveAffects: Record<string, unknown> | null;
};
export type SkillNodeContractFormModel = {
  status: string;
  canEdit: boolean;
  error: unknown;
  resolveNestedNodeSchema(context: ResolveNestedNodeSchemaContext): ResolveNestedNodeSchemaResult;
  projectFieldStates(schema: ObjectNodeSchema, value: Record<string, unknown>, context?: ContractFormContext): ContractFormFieldState[];
  canSwitchDiscriminator(schema: ObjectNodeSchema, context?: ContractFormContext): boolean;
  getDerivedRuleSummary(schema: ObjectNodeSchema, context?: ContractFormContext): Array<{ label: string; value: string }>;
  evaluateConstraints(schema: ObjectNodeSchema, value: Record<string, unknown>, context?: ContractFormContext): ContractFormConstraintResult;
};
export function createSkillNodeContractFormModel(editorState: {
  status: string;
  canEdit: boolean;
  contract: Record<string, unknown> | null;
  error: unknown;
}): SkillNodeContractFormModel;
export function evaluateNodeFieldCondition(condition: unknown, value: Record<string, unknown>): boolean;
