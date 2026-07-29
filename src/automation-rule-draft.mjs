export function remapAutomationRuleBindingKey(bindings, previousId, nextId) {
  if (previousId === nextId) return bindings;

  const nextBindings = { ...bindings.bindings };
  const binding = nextBindings[previousId];
  delete nextBindings[previousId];
  if (binding) nextBindings[nextId] = binding;

  const currentStatuses = bindings.bindingStatuses;
  if (!currentStatuses) return { ...bindings, bindings: nextBindings };

  const nextStatuses = { ...currentStatuses };
  const status = nextStatuses[previousId];
  delete nextStatuses[previousId];
  if (status) nextStatuses[nextId] = status;
  return { ...bindings, bindings: nextBindings, bindingStatuses: nextStatuses };
}

export function removeAutomationRuleBinding(bindings, ruleId) {
  const nextBindings = { ...bindings.bindings };
  delete nextBindings[ruleId];

  const currentStatuses = bindings.bindingStatuses;
  if (!currentStatuses) return { ...bindings, bindings: nextBindings };

  const nextStatuses = { ...currentStatuses };
  delete nextStatuses[ruleId];
  return { ...bindings, bindings: nextBindings, bindingStatuses: nextStatuses };
}

export function pruneOrphanAutomationRuleBindings(bindings, ruleIds) {
  const allowedRuleIds = new Set(ruleIds);
  const nextBindings = Object.fromEntries(
    Object.entries(bindings.bindings).filter(([ruleId]) => allowedRuleIds.has(ruleId)),
  );

  const currentStatuses = bindings.bindingStatuses;
  if (!currentStatuses) return { ...bindings, bindings: nextBindings };

  const nextStatuses = Object.fromEntries(
    Object.entries(currentStatuses).filter(([ruleId]) => allowedRuleIds.has(ruleId)),
  );
  return { ...bindings, bindings: nextBindings, bindingStatuses: nextStatuses };
}
