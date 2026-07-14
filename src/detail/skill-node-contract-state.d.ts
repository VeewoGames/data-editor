export type SkillNodeContractEditorState = {
  status: "loading" | "ready" | "error" | "version_mismatch";
  canEdit: boolean;
  contract: ({ contract_version: number } & Record<string, unknown>) | null;
  version: number | null;
  etag: string | null;
  error: unknown;
};

export function createSkillNodeContractEditorState(input: {
  status: SkillNodeContractEditorState["status"];
  contract?: ({ contract_version: number } & Record<string, unknown>) | null;
  version?: number | null;
  etag?: string | null;
  error?: unknown;
}): SkillNodeContractEditorState;

export function validateSkillNodeContractSaveToken(input: {
  token: { version: number; etag: string } | null | undefined;
  documentRoot: unknown;
  expectedVersion: number;
  expectedEtag: string;
}): { ok: true } | { ok: false; code: string; message: string };
