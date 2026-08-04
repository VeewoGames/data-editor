import type { ResolveNestedNodeSchemaContext, ResolveNestedNodeSchemaResult } from "./node-schema";

export type NestedSchemaCapabilityContext = ResolveNestedNodeSchemaContext & {
  dataSourceId: string;
  path: string;
};

export type NestedSchemaCapabilityResolver = {
  resolve(context: NestedSchemaCapabilityContext): ResolveNestedNodeSchemaResult;
};

export function createNestedSchemaCapabilityResolver(bindings?: Array<unknown>): NestedSchemaCapabilityResolver;
