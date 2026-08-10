import crypto from "node:crypto";
import path from "node:path";
import { loadAutomationProfile } from "./automation-profile.mjs";
import { assertEntryActionPredicate, loadEntryActionContracts, resolveEntryActionContract } from "./entry-action-contracts.mjs";
import { findAutomationEntryAction, validateEntryActionTarget } from "./entry-actions.mjs";
import { readTextFile } from "./file-service.mjs";
import { buildDocumentModel, getRows } from "./document-model.mjs";
import { buildDocumentStore, getSourceLocatorByRowId } from "./model/document-store.mjs";
import { rowDigest } from "./row-digest.mjs";

export function createProjectTransactionRegistry({ owners = defaultOwners(), resolveOwner = null, timeoutMs = 30_000, abortAckTimeoutMs = 1_000 } = {}) {
  if (!(owners instanceof Map) || (resolveOwner !== null && typeof resolveOwner !== "function") || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || !Number.isSafeInteger(abortAckTimeoutMs) || abortAckTimeoutMs < 1) fail("PROJECT_TRANSACTION_REGISTRY_INVALID");
  const registered = new Map(owners);
  return Object.freeze({
    async invoke(ownerId, input) {
      const owner = registered.get(ownerId) ?? await resolveOwner?.(ownerId, input);
      if (typeof owner !== "function") fail("PROJECT_TRANSACTION_OWNER_UNAVAILABLE");
      const controller = new AbortController();
      const deadline = Date.now() + timeoutMs;
      const operation = observeOwner(owner, structuredClone(input), { signal: controller.signal, deadline });
      if (await waitForObserved(operation, timeoutMs)) return unwrapOwner(operation);
      controller.abort(transactionError("PROJECT_TRANSACTION_TIMEOUT"));
      if (await waitForObserved(operation, abortAckTimeoutMs)) {
        if (operation.status === "rejected" && operation.error?.code === "PROJECT_TRANSACTION_ABORT_ACKNOWLEDGED") fail("PROJECT_TRANSACTION_TIMEOUT");
        return unwrapOwner(operation);
      }
      return Object.freeze({ pending: true, deadline, receipt: { version: 1, ownerId, state: "abort_unacknowledged" } });
    },
  });
}

export function createProjectTransactionDispatcher({ registry }) {
  if (typeof registry?.invoke !== "function") throw new TypeError("Project transaction registry is required.");
  return async ({ projectContext, project, request, runId, result }) => {
    const value = validateProjectTransactionResult(result);
    const [profile, contracts, documentText] = await Promise.all([
      loadAutomationProfile(projectContext), loadEntryActionContracts(projectContext), readTextFile(projectContext, request.sourcePath),
    ]);
    const currentAction = findAutomationEntryAction(profile, request.actionId);
    validateEntryActionTarget(currentAction, request.sourcePath, request.collectionPath);
    const contract = resolveEntryActionContract(contracts, currentAction.contractId);
    const declared = contract.projectTransaction;
    if (currentAction.execution.resultPolicy !== "project-transaction" || !declared
      || currentAction.execution.ownerId !== declared.ownerId || currentAction.execution.capabilityId !== declared.capabilityId
      || value.ownerId !== declared.ownerId || value.capabilityId !== declared.capabilityId) fail("PROJECT_TRANSACTION_AUTHORITY_STALE");
    const format = path.extname(request.sourcePath).toLowerCase() === ".csv" ? "csv" : "json";
    if (format !== "json") fail("PROJECT_TRANSACTION_SUBJECT_INVALID");
    const model = buildDocumentModel(JSON.parse(documentText), format, request.sourcePath);
    const store = buildDocumentStore({ documentId: request.sourcePath, model });
    const locator = getSourceLocatorByRowId(store, request.collectionPath, request.rowId);
    const row = getRows(model, request.collectionPath)[locator.sourceIndex];
    const digest = rowDigest(row);
    const expectedSubject = { sourcePath: request.sourcePath, collectionPath: request.collectionPath, rowId: request.rowId, expectedRowDigest: request.expectedRowDigest };
    if (!request.rowId || request.expectedRowDigest !== digest || stable(value.subject) !== stable(expectedSubject)) fail("PROJECT_TRANSACTION_SUBJECT_STALE");
    assertEntryActionPredicate(contract.predicate, row);
    const transaction = await registry.invoke(declared.ownerId, {
      version: 1, runId, projectId: project.id, projectRoot: projectContext.projectRoot, actionId: currentAction.id, ownerId: declared.ownerId, capabilityId: declared.capabilityId,
      subject: expectedSubject, subjectDigest: digestText(stable(expectedSubject)), payload: value.payload, message: value.summary,
    });
    if (transaction.pending === true) return { kind: "project-transaction", runId, pending: true, receipt: transaction.receipt, message: "Project transaction owner has not acknowledged termination." };
    return { kind: "project-transaction", runId, changed: transaction.changed, receipt: transaction.receipt, message: value.summary };
  };
}

export function validateProjectTransactionResult(value) {
  exact(value, ["capabilityId", "kind", "ownerId", "payload", "subject", "summary"]);
  if (value.kind !== "project-transaction-result" || !id(value.ownerId) || !id(value.capabilityId) || !plain(value.payload) || typeof value.summary !== "string" || !value.summary.trim()) fail("PROJECT_TRANSACTION_RESULT_INVALID");
  exact(value.subject, ["collectionPath", "expectedRowDigest", "rowId", "sourcePath"]);
  if ([value.subject.sourcePath, value.subject.collectionPath, value.subject.rowId, value.subject.expectedRowDigest].some((item) => typeof item !== "string" || !item)) fail("PROJECT_TRANSACTION_RESULT_INVALID");
  return structuredClone(value);
}

function defaultOwners() { return new Map([["receipt-only-v1", async (input) => ({ changed: false, receipt: { version: 1, diagnosticOnly: true, ownerId: input.ownerId, capabilityId: input.capabilityId, subjectDigest: input.subjectDigest } })]]); }
function observeOwner(owner, input, control) {
  const observed = { status: "pending", value: null, error: null, listeners: new Set() };
  Promise.resolve().then(() => owner(input, control)).then(
    (value) => settleObserved(observed, "fulfilled", value, null),
    (error) => settleObserved(observed, "rejected", null, error),
  );
  return observed;
}
function settleObserved(observed, status, value, error) { observed.status = status; observed.value = value; observed.error = error; for (const listener of observed.listeners) listener(); observed.listeners.clear(); }
function waitForObserved(observed, timeoutMs) {
  if (observed.status !== "pending") return Promise.resolve(true);
  return new Promise((resolve) => {
    let timer;
    const finish = (settled) => { if (timer) clearTimeout(timer); observed.listeners.delete(onSettled); resolve(settled); };
    const onSettled = () => finish(true);
    observed.listeners.add(onSettled);
    timer = setTimeout(() => finish(observed.status !== "pending"), timeoutMs);
    timer.unref?.();
  });
}
function unwrapOwner(observed) {
  if (observed.status === "rejected") throw observed.error;
  const result = observed.value;
  if (plain(result) && result.pending === true && plain(result.receipt)) return structuredClone(result);
  if (!plain(result) || typeof result.changed !== "boolean" || !plain(result.receipt)) fail("PROJECT_TRANSACTION_RESULT_INVALID");
  return structuredClone(result);
}
function exact(value, fields) { if (!plain(value) || Object.keys(value).sort().join(",") !== [...fields].sort().join(",")) fail("PROJECT_TRANSACTION_RESULT_INVALID"); }
function plain(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function id(value) { return typeof value === "string" && /^[A-Za-z0-9._-]+$/.test(value); }
function stable(value) { if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`; if (plain(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`; return JSON.stringify(value); }
function digestText(value) { return crypto.createHash("sha256").update(value, "utf8").digest("hex"); }
function transactionError(code) { return Object.assign(new Error(code), { code }); }
function fail(code) { throw transactionError(code); }
