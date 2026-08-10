import assert from "node:assert/strict";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createProjectContext } from "../src/project-context.mjs";
import { rowDigest } from "../src/row-digest.mjs";
import { createProjectTransactionDispatcher, createProjectTransactionRegistry } from "../src/entry-action-project-transaction.mjs";

const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` : JSON.stringify(value);
const hash = (value) => crypto.createHash("sha256").update(value, "utf8").digest("hex");

test("project transaction refreshes authority and subject before invoking its registered owner", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "project-transaction-")); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, ".data-editor")); await mkdir(path.join(root, "data"));
  const row = { slug: "alpha", state: "eligible", __entry_id: "01JEXISTING00000000000001" }; const digest = rowDigest(row);
  await writeFile(path.join(root, "data", "items.json"), `${JSON.stringify({ items: [row] }, null, 2)}\n`);
  const execution = { kind: "project-skill", resultPolicy: "project-transaction", ownerId: "fixture-owner", capabilityId: "fixture-capability" };
  await writeFile(path.join(root, ".data-editor", "automation-profile.json"), JSON.stringify({ rules: [{ id: "transact", label: "Transact", icon: "edit", targets: [{ file: "data/items.json", collection: "items" }], payload: { includeRow: true, includeNeighbors: false }, execution, contractId: "fixture.transaction.v1" }] }));
  const unsigned = { contractId: "fixture.transaction.v1", version: 1, predicate: { all: [{ field: "state", op: "eq", value: "eligible" }] }, writableFields: [], legalTransitions: [], textArtifactPolicy: {}, evidencePolicy: {}, resultPolicy: "project-transaction", createAuthority: null, projectTransaction: { ownerId: "fixture-owner", capabilityId: "fixture-capability" } };
  const contract = { ...unsigned, digest: hash(canonical(unsigned)) }; await writeFile(path.join(root, ".data-editor", "entry-action-contracts.json"), JSON.stringify({ version: 1, contracts: [contract] }));
  let observed;
  const registry = createProjectTransactionRegistry({ owners: new Map([["fixture-owner", async (input) => { observed = input; return { changed: true, receipt: { durable: true } }; }]]) });
  const dispatch = createProjectTransactionDispatcher({ registry });
  const request = { actionId: "transact", sourcePath: "data/items.json", collectionPath: "items", rowId: row.__entry_id, expectedRowDigest: digest };
  const result = await dispatch({ projectContext: createProjectContext(root), project: { id: "fixture" }, request, action: { id: "transact" }, runId: "10000000-0000-4000-8000-000000000001", result: { kind: "project-transaction-result", ownerId: "fixture-owner", capabilityId: "fixture-capability", subject: { sourcePath: request.sourcePath, collectionPath: request.collectionPath, rowId: request.rowId, expectedRowDigest: digest }, payload: { verdict: "pass" }, summary: "Applied" } });
  assert.equal(result.changed, true); assert.equal(result.runId, "10000000-0000-4000-8000-000000000001"); assert.equal(observed.subject.expectedRowDigest, digest);
  await assert.rejects(() => dispatch({ projectContext: createProjectContext(root), project: { id: "fixture" }, request: { ...request, expectedRowDigest: "stale" }, action: { id: "transact" }, runId: "10000000-0000-4000-8000-000000000002", result: { kind: "project-transaction-result", ownerId: "fixture-owner", capabilityId: "fixture-capability", subject: { sourcePath: request.sourcePath, collectionPath: request.collectionPath, rowId: request.rowId, expectedRowDigest: "stale" }, payload: {}, summary: "No" } }), { code: "PROJECT_TRANSACTION_SUBJECT_STALE" });
  const ineligible = { ...row, state: "blocked" }; const ineligibleDigest = rowDigest(ineligible); observed = null;
  await writeFile(path.join(root, "data", "items.json"), `${JSON.stringify({ items: [ineligible] }, null, 2)}\n`);
  const ineligibleRequest = { ...request, expectedRowDigest: ineligibleDigest };
  await assert.rejects(() => dispatch({ projectContext: createProjectContext(root), project: { id: "fixture" }, request: ineligibleRequest, runId: "10000000-0000-4000-8000-000000000003", result: { kind: "project-transaction-result", ownerId: "fixture-owner", capabilityId: "fixture-capability", subject: { sourcePath: request.sourcePath, collectionPath: request.collectionPath, rowId: request.rowId, expectedRowDigest: ineligibleDigest }, payload: {}, summary: "No" } }), { code: "ENTRY_ACTION_PREDICATE_FAILED" });
  assert.equal(observed, null);
});

test("project transaction deadline requires abort acknowledgement before publishing timeout", async () => {
  let wroteAfterPending = false;
  const registry = createProjectTransactionRegistry({ owners: new Map([
    ["ack-abort", async (_input, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { code: "PROJECT_TRANSACTION_ABORT_ACKNOWLEDGED" })), { once: true }))],
    ["ignore-abort", async () => { await new Promise((resolve) => setTimeout(resolve, 50)); wroteAfterPending = true; return { changed: true, receipt: { durable: true } }; }],
    ["settle-after-deadline", async () => { await new Promise((resolve) => setTimeout(resolve, 30)); return { changed: true, receipt: { durable: true } }; }],
  ]), timeoutMs: 10, abortAckTimeoutMs: 10 });
  await assert.rejects(() => registry.invoke("ack-abort", {}), { code: "PROJECT_TRANSACTION_TIMEOUT" });
  const pending = await registry.invoke("ignore-abort", {}); assert.equal(pending.pending, true); assert.equal(wroteAfterPending, false);
  await new Promise((resolve) => setTimeout(resolve, 45)); assert.equal(wroteAfterPending, true);
  const settledRegistry = createProjectTransactionRegistry({ owners: new Map([["settle-after-deadline", async () => { await new Promise((resolve) => setTimeout(resolve, 30)); return { changed: true, receipt: { durable: true } }; }]]), timeoutMs: 10, abortAckTimeoutMs: 50 });
  const settled = await settledRegistry.invoke("settle-after-deadline", {}); assert.equal(settled.changed, true);
  await assert.rejects(() => registry.invoke("missing", {}), { code: "PROJECT_TRANSACTION_OWNER_UNAVAILABLE" });
});
