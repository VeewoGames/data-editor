import { buildDocumentModel } from "./document-model.mjs";
import { resolveEntryActionRow } from "./entry-actions.mjs";
import { ruleAuthorityDigest } from "./automation-profile.mjs";
import { loadEntryActionContracts, resolveEntryActionContract, assertEntryActionPredicate, assertEntryActionChanges } from "./entry-action-contracts.mjs";
import { executeProjectCommand } from "./project-command-runner.mjs";
import { assertProjectCommandDependencies, commandDigest, commandError } from "./project-command-snapshot.mjs";

// Trusted project code, not a filesystem sandbox. The server owns this input;
// generator evidence and validator-produced replacement patches are never used.
export async function validateProjectCommandResult({ context, action, baseline, runId, mode, changes, proposal = null, afterRoot }) {
  if (!action.execution?.proposalValidator) return;
  if (action.execution.kind !== "project-command" || !baseline || !baseline.sourcePath.endsWith(".json") || proposal?.textArtifact) throw commandError("PROJECT_COMMAND_VALIDATOR_ROUTE_UNSUPPORTED");
  await assertProjectCommandDependencies(context, baseline);
  const request = baseline.requestContext;
  if (!request || request.version !== 1 || request.runId !== runId || request.actionId !== action.id || request.sourcePath !== baseline.sourcePath
    || !Array.isArray(request.locales) || request.locales.some(locale => typeof locale !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(locale))
    || commandDigest(JSON.stringify(request)) !== baseline.requestContextDigest
    || (proposal && ["runId", "actionId", "sourcePath", "collectionPath", "rowId"].some(key => proposal[key] !== request[key]))) throw commandError("PROJECT_COMMAND_REQUEST_CONTEXT_INVALID");
  const model = buildDocumentModel(JSON.parse(baseline.documentText), "json", request.sourcePath);
  const beforeRow = resolveEntryActionRow(model, request.collectionPath, null, request.rowId).row;
  const contract = resolveEntryActionContract(await loadEntryActionContracts(context), action.contractId);
  if (contract.resultPolicy !== "proposal") throw commandError("PROJECT_COMMAND_VALIDATOR_ROUTE_UNSUPPORTED");
  assertEntryActionPredicate(contract.predicate, beforeRow);
  assertEntryActionChanges(contract, changes, beforeRow);
  let afterRow = structuredClone(beforeRow);
  const fields = new Set();
  for (const change of changes) {
    if (!change || typeof change.field !== "string" || ["__proto__", "constructor", "prototype"].includes(change.field) || fields.has(change.field)
      || !Object.hasOwn(beforeRow, change.field) || change.beforeExists !== true || change.afterExists !== true
      || commandDigest(JSON.stringify(beforeRow[change.field])) !== commandDigest(JSON.stringify(change.before))) throw commandError("PROJECT_COMMAND_VALIDATOR_DIFF_INVALID");
    fields.add(change.field);
    afterRow[change.field] = structuredClone(change.after);
  }
  if (afterRoot !== undefined) {
    const preparedRow = resolveEntryActionRow(buildDocumentModel(afterRoot, "json", request.sourcePath), request.collectionPath, null, request.rowId).row;
    if (JSON.stringify(preparedRow) !== JSON.stringify(afterRow)) throw commandError("PROJECT_COMMAND_VALIDATOR_AFTER_MISMATCH");
    afterRow = preparedRow;
  }
  const input = { version: 1, kind: "project-command-validation", mode, request: structuredClone(request), action: { id: action.id, contractId: action.contractId, contractDigest: contract.digest, ruleDigest: ruleAuthorityDigest(action) }, beforeRow, afterRow,
    changes: structuredClone(changes), snapshot: { baseDocumentEtag: baseline.baseDocumentEtag, requestContextDigest: baseline.requestContextDigest, readDependencies: baseline.files.map(({ path, digest }) => ({ path, digest })) } };
  const inputDigest = commandDigest(JSON.stringify(input)), changesDigest = commandDigest(JSON.stringify(input.changes));
  const result = await executeProjectCommand(context, action.execution.proposalValidator.command, { ...input, inputDigest, changesDigest });
  await assertProjectCommandDependencies(context, baseline);
  if (!result || Object.keys(result).sort().join(",") !== "changesDigest,diagnostics,inputDigest,kind,status,version" || result.version !== 1 || result.kind !== "project-command-validation-result"
    || !["pass", "reject"].includes(result.status) || !Array.isArray(result.diagnostics) || result.diagnostics.some(item => typeof item !== "string")
    || result.inputDigest !== inputDigest || result.changesDigest !== changesDigest) throw commandError("PROJECT_COMMAND_VALIDATOR_RESULT_INVALID");
  if (result.status !== "pass") throw commandError("PROJECT_COMMAND_VALIDATOR_REJECTED", result.diagnostics.join("\n") || "Project validator rejected this result.");
}
