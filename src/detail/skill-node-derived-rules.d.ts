export type ChargeDerivedSummaryRow = { label: string; value: string };
export type SkillNodeDerivedRuleIssue = {
  code: "SKILL_NODE_CHARGE_DERIVED_FIELD_CONFLICT";
  skillId: string;
  fieldPath: string;
  message: string;
};

export function resolveChargeDerivedState(contract: Record<string, unknown>, skill: Record<string, unknown>): null | {
  chargeNode: { node: Record<string, unknown>; path: string };
  rule: Record<string, unknown>;
  targetingEntry: { node: Record<string, unknown>; path: string } | null;
  targeting: Record<string, unknown> | null;
  selection: Record<string, unknown> | null;
};
export function buildChargeDerivedSummary(contract: Record<string, unknown>, skill: Record<string, unknown>): ChargeDerivedSummaryRow[];
export function validateSkillNodeDerivedRuleConflicts(contract: Record<string, unknown>, documentRoot: unknown): {
  ok: boolean;
  issues: SkillNodeDerivedRuleIssue[];
};
