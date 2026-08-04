export {
  type DiscriminatedObjectNodeSchema,
  type NodeFieldOption,
  type NodeFieldSchema,
  type NodePathSegment,
  type ObjectNodeSchema,
  type ResolveNestedNodeSchemaContext,
  type ResolveNestedNodeSchemaResult,
} from "./node-schema";

export function matchesContractSkillSource(context: Pick<import("./node-schema").ResolveNestedNodeSchemaContext, "collectionPath" | "rootField">): boolean;

export type SkillNodeContractRegistryAdapter = {
  contractVersion: number;
  deriveNodeConsumes(nodes: unknown[], targeting?: Record<string, unknown> | null): {
    consumes: string[];
    entries: Array<{ nodePath: string; nodeType: string; consumes: string[] }>;
  };
  resolveNestedNodeSchema(context: import("./node-schema").ResolveNestedNodeSchemaContext): import("./node-schema").ResolveNestedNodeSchemaResult;
};

export function createSkillNodeContractRegistryAdapter(contract: {
  contract_version: number;
  runtime_rules: Record<string, any>;
  nodes: Record<string, any>;
  labels: Record<string, any>;
  help: Record<string, any>;
  ui_presentation: Record<string, any>;
}): SkillNodeContractRegistryAdapter;

