import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createProjectTransactionRegistry } from "../src/entry-action-project-transaction.mjs";
import { createProjectTransactionOwnerResolver, recoverProjectTransactionOwnerResults } from "../src/entry-action-project-owner-adapters.mjs";

test("json-command owner is explicitly registered, journaled, replayable and path confined", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "project-owner-adapter-")); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, ".data-editor")); await mkdir(path.join(root, "tools"));
  const script = `import { writeFile } from "node:fs/promises";\nlet input=""; for await (const chunk of process.stdin) input+=chunk; const value=JSON.parse(input); if(value.payload.delay) await new Promise(r=>setTimeout(r,value.payload.delay)); if(value.payload.changed) await writeFile("owner-write.json", JSON.stringify({runId:value.runId,fencingDigest:value.fencingDigest})); const result={version:1,runId:value.runId,ownerId:value.ownerId,capabilityId:value.capabilityId,subjectDigest:value.subjectDigest,changed:Boolean(value.payload.changed),receipt:{durable:true}}; await writeFile(value.resultPath, JSON.stringify(result), {flag:"wx"}); process.stdout.write(JSON.stringify(result));\n`;
  await writeFile(path.join(root, "tools", "owner.mjs"), script); await writeFile(path.join(root, "outside.mjs"), script);
  const config = { version: 1, owners: [{ ownerId: "fixture-json-owner", capabilityId: "fixture-capability", adapterId: "json-command-v1", config: { executableId: "node", allowedDirectory: "tools", entry: "tools/owner.mjs", fixedArgs: [] } }] };
  await writeFile(path.join(root, ".data-editor", "project-transaction-owners.json"), JSON.stringify(config));
  const resolver = createProjectTransactionOwnerResolver();
  const registry = createProjectTransactionRegistry({ resolveOwner: (ownerId, input) => resolver.resolve(ownerId, input), timeoutMs: 2_000 });
  const base = { version: 1, runId: "10000000-0000-4000-8000-000000000001", projectId: "fixture", projectRoot: root, actionId: "transact", ownerId: "fixture-json-owner", capabilityId: "fixture-capability", subject: { rowId: "row-1" }, subjectDigest: "a".repeat(64), payload: { changed: true } };
  const written = await registry.invoke(base.ownerId, base); assert.equal(written.changed, true); assert.equal(JSON.parse(await readFile(path.join(root, "owner-write.json"), "utf8")).runId, base.runId);
  const replay = await registry.invoke(base.ownerId, base); assert.deepEqual(replay, written);
  const noWrite = await registry.invoke(base.ownerId, { ...base, runId: "10000000-0000-4000-8000-000000000002", payload: { changed: false } }); assert.equal(noWrite.changed, false);
  await writeFile(path.join(root, ".data-editor", "project-transaction-owners.json"), JSON.stringify({ ...config, owners: [{ ...config.owners[0], config: { ...config.owners[0].config, entry: "outside.mjs" } }] }));
  await assert.rejects(() => registry.invoke(base.ownerId, { ...base, runId: "10000000-0000-4000-8000-000000000003" }), { code: "PROJECT_TRANSACTION_OWNER_ENTRY_FORBIDDEN" });
});

test("json-command timeout waits for confirmed process exit and records a terminal failure", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "project-owner-timeout-")); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, ".data-editor")); await mkdir(path.join(root, "tools"));
  await writeFile(path.join(root, "tools", "owner.mjs"), `let input=""; for await (const chunk of process.stdin) input+=chunk; await new Promise(r=>setTimeout(r,500)); process.stdout.write(input);\n`);
  await writeFile(path.join(root, ".data-editor", "project-transaction-owners.json"), JSON.stringify({ version: 1, owners: [{ ownerId: "slow-owner", capabilityId: "slow-capability", adapterId: "json-command-v1", config: { executableId: "node", allowedDirectory: "tools", entry: "tools/owner.mjs", fixedArgs: [] } }] }));
  const resolver = createProjectTransactionOwnerResolver(); const registry = createProjectTransactionRegistry({ resolveOwner: (ownerId, input) => resolver.resolve(ownerId, input), timeoutMs: 30, abortAckTimeoutMs: 1_000 });
  const input = { version: 1, runId: "20000000-0000-4000-8000-000000000001", projectId: "fixture", projectRoot: root, actionId: "transact", ownerId: "slow-owner", capabilityId: "slow-capability", subject: { rowId: "row-1" }, subjectDigest: "b".repeat(64), payload: {} };
  await assert.rejects(() => registry.invoke(input.ownerId, input), { code: "PROJECT_TRANSACTION_TIMEOUT" });
  await assert.rejects(() => registry.invoke(input.ownerId, input), { code: "PROJECT_TRANSACTION_ABORT_ACKNOWLEDGED" });
  assert.deepEqual(await recoverProjectTransactionOwnerResults({ projectContext: { projectRoot: root }, publish: async () => {} }), { recovered: [], pending: [] });
});

test("production supervisor failures stay pending until terminate confirms the whole job", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "project-owner-supervisor-")); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, ".data-editor")); await mkdir(path.join(root, "tools")); await writeFile(path.join(root, "tools", "owner.mjs"), "");
  await writeFile(path.join(root, ".data-editor", "project-transaction-owners.json"), JSON.stringify({ version: 1, owners: [{ ownerId: "supervised-owner", capabilityId: "supervised-capability", adapterId: "json-command-v1", config: { executableId: "node", allowedDirectory: "tools", entry: "tools/owner.mjs", fixedArgs: [] } }] }));
  const base = { version: 1, projectId: "fixture", projectRoot: root, actionId: "transact", ownerId: "supervised-owner", capabilityId: "supervised-capability", subject: { rowId: "row-1" }, subjectDigest: "e".repeat(64), payload: {} };
  let terminateCalls = 0;
  const failedTerminationSupervisor = { start: async () => ({ completion: new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error("ownership lost"), { code: "ENTRY_ACTION_PROCESS_OWNERSHIP_UNAVAILABLE" })), 15)), terminate: async () => { terminateCalls += 1; throw Object.assign(new Error("terminate command failed"), { code: "ENTRY_ACTION_PROCESS_OWNERSHIP_UNAVAILABLE" }); } }) };
  const failedResolver = createProjectTransactionOwnerResolver({ jobSupervisor: failedTerminationSupervisor }); const failedRegistry = createProjectTransactionRegistry({ resolveOwner: (ownerId, input) => failedResolver.resolve(ownerId, input), timeoutMs: 5, abortAckTimeoutMs: 50 });
  const failed = await failedRegistry.invoke(base.ownerId, { ...base, runId: "40000000-0000-4000-8000-000000000001" }); assert.equal(failed.pending, true); assert.equal(failed.receipt.state, "termination_unconfirmed"); assert.equal(terminateCalls, 1);

  let unresolvedTerminateCalls = 0;
  const unconfirmedSupervisor = { start: async () => ({ completion: new Promise((_, reject) => setTimeout(() => reject(new Error("completion lost")), 15)), terminate: async () => { unresolvedTerminateCalls += 1; return new Promise(() => {}); } }) };
  const unconfirmedResolver = createProjectTransactionOwnerResolver({ jobSupervisor: unconfirmedSupervisor }); const unconfirmedRegistry = createProjectTransactionRegistry({ resolveOwner: (ownerId, input) => unconfirmedResolver.resolve(ownerId, input), timeoutMs: 5, abortAckTimeoutMs: 20 });
  const lateRunId = "40000000-0000-4000-8000-000000000002"; const unconfirmed = await unconfirmedRegistry.invoke(base.ownerId, { ...base, runId: lateRunId }); assert.equal(unconfirmed.pending, true); assert.equal(unconfirmed.receipt.state, "abort_unacknowledged"); assert.equal(unresolvedTerminateCalls, 1);
  const lateResult = { version: 1, runId: lateRunId, ownerId: base.ownerId, capabilityId: base.capabilityId, subjectDigest: base.subjectDigest, changed: true, receipt: { durable: true, late: true } }; await writeFile(path.join(root, ".data-editor", "runtime", "project-transactions", `${lateRunId}.result.json`), JSON.stringify(lateResult), { flag: "wx" });
  let latePublished; const lateRecovery = await recoverProjectTransactionOwnerResults({ projectContext: { projectRoot: root }, publish: async (value) => { if (value.runId === lateRunId) latePublished = value; } }); assert.deepEqual(lateRecovery.recovered, [lateRunId]); assert.equal(latePublished.changed, true); assert.equal(latePublished.receipt.late, true);

  let confirmedTerminateCalls = 0;
  const confirmedSupervisor = { start: async () => ({ completion: new Promise((_, reject) => setTimeout(() => reject(new Error("completion raced")), 15)), terminate: async () => { confirmedTerminateCalls += 1; await new Promise((resolve) => setTimeout(resolve, 5)); return { exitCode: 1, timedOut: true }; } }) };
  const confirmedResolver = createProjectTransactionOwnerResolver({ jobSupervisor: confirmedSupervisor }); const confirmedRegistry = createProjectTransactionRegistry({ resolveOwner: (ownerId, input) => confirmedResolver.resolve(ownerId, input), timeoutMs: 5, abortAckTimeoutMs: 50 });
  await assert.rejects(() => confirmedRegistry.invoke(base.ownerId, { ...base, runId: "40000000-0000-4000-8000-000000000003" }), { code: "PROJECT_TRANSACTION_TIMEOUT" }); assert.equal(confirmedTerminateCalls, 1);
});
