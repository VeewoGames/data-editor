const REQUIRED = ["version", "runId", "actionId", "sourcePath", "canonicalFileKey", "collectionPath", "rowId", "baseDocumentEtag", "automationProfileEtag", "authorityDigest", "fencingToken", "change", "summary"];
const CHANGE = ["field", "beforeExists", "before", "afterExists", "after"];
const KEY = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateEntryActionProposal(value) {
  exact(value, REQUIRED, "proposal");
  for (const field of ["runId", "actionId", "sourcePath", "collectionPath", "rowId", "baseDocumentEtag", "automationProfileEtag", "authorityDigest", "summary"]) required(value[field], field);
  if (value.version !== 1 || !UUID.test(value.runId) || !KEY.test(value.canonicalFileKey) || !KEY.test(value.authorityDigest) || !Number.isSafeInteger(value.fencingToken) || value.fencingToken < 1) invalid("proposal identity is invalid");
  exact(value.change, CHANGE, "proposal change");
  required(value.change.field, "change.field");
  if (typeof value.change.beforeExists !== "boolean" || typeof value.change.afterExists !== "boolean") invalid("proposal change existence flags are invalid");
  if (!value.change.beforeExists && value.change.before !== null) invalid("missing before value must be null");
  if (!value.change.beforeExists) invalid("proposal may not add a field");
  if (!value.change.afterExists && value.change.after !== null) invalid("missing after value must be null");
  if (!value.change.afterExists) invalid("proposal may not remove a field");
  return structuredClone(value);
}
function exact(value, fields, label) { if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== fields.length || fields.some((field) => !Object.hasOwn(value, field))) invalid(`${label} schema is invalid`); }
function required(value, label) { if (typeof value !== "string" || !value.trim()) invalid(`${label} is required`); }
function invalid(message) { throw Object.assign(new Error(message), { code: "ENTRY_ACTION_PROPOSAL_INVALID" }); }
