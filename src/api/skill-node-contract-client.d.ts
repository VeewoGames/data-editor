export type SkillNodeContract = {
  contract_version: number;
  runtime_rules: Record<string, unknown>;
  nodes: Record<string, unknown>;
  labels: Record<string, unknown>;
  help: Record<string, unknown>;
  ui_presentation: Record<string, unknown>;
};

export type LoadedSkillNodeContract = {
  projectId: string;
  contract: SkillNodeContract;
  version: number;
  etag: string;
  fromCache: boolean;
};

export class SkillNodeContractClientError extends Error {
  code: string;
  status: number | null;
  details: unknown;
}

export function createSkillNodeContractClient(options?: {
  fetchImpl?: typeof fetch;
}): {
  load(projectId: string): Promise<LoadedSkillNodeContract>;
  clear(projectId?: string | null): void;
};
