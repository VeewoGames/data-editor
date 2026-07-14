const REQUIRED_AFFECTS_CONSTRAINT_OPERATORS = Object.freeze([
  "affects_required_for_entity_consumer",
  "affects_forbidden_for_cells_only_consumer",
  "direction_affects_requires_area",
]);

export function assertSkillNodeContractSemantics(contract) {
  const constraints = contract?.runtime_rules?.targeting?.affects?.constraints;
  const blockingCodes = contract?.runtime_rules?.validation?.blocking_codes;
  if (!Array.isArray(constraints) || !isPlainObject(blockingCodes)) {
    throw new TypeError("Skill node contract is missing targeting affects constraints or blocking codes.");
  }

  const requiredOperators = new Set(REQUIRED_AFFECTS_CONSTRAINT_OPERATORS);
  const operatorCounts = new Map(REQUIRED_AFFECTS_CONSTRAINT_OPERATORS.map((operator) => [operator, 0]));
  for (const constraint of constraints) {
    const operator = constraint?.operator;
    if (!requiredOperators.has(operator)) {
      throw new TypeError(`Skill node contract has unsupported targeting affects constraint operator: ${String(operator)}.`);
    }
    operatorCounts.set(operator, operatorCounts.get(operator) + 1);

    const codeKey = constraint.code_key;
    const blockingCode = blockingCodes[codeKey];
    if (typeof codeKey !== "string" || typeof blockingCode !== "string" || blockingCode.length === 0) {
      throw new TypeError(`Skill node contract targeting affects constraint ${operator} references an unknown or empty blocking code: ${String(codeKey)}.`);
    }
  }

  for (const [operator, count] of operatorCounts) {
    if (count !== 1) {
      throw new TypeError(`Skill node contract targeting affects constraint ${operator} must be declared exactly once; received ${count}.`);
    }
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
