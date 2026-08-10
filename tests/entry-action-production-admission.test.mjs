import assert from "node:assert/strict";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { rowDigest } from "../src/row-digest.mjs";
import { publishExactArtifact } from "../src/entry-action-exact-artifact-store.mjs";
import { createProjectContext } from "../src/project-context.mjs";

const hash = (value) => crypto.createHash("sha256").update(value, "utf8").digest("hex");
const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` : JSON.stringify(value);
const execFileAsync = promisify(execFile);

test("HTTP exact-artifact admission creates a candidate through the sole group commit service", { timeout: 60_000 }, async (t) => {
  const project = await mkdtemp(path.join(os.tmpdir(), "data-editor-production-admission-"));
  const registryHome = await mkdtemp(path.join(os.tmpdir(), "data-editor-production-registry-"));
  t.after(() => Promise.all([rm(project, { recursive: true, force: true }), rm(registryHome, { recursive: true, force: true })]));
  await mkdir(path.join(project, "data"), { recursive: true }); await mkdir(path.join(project, "docs"));
  await mkdir(path.join(project, ".agents", "skills", "fixture-create"), { recursive: true });
  await mkdir(path.join(project, "tools"), { recursive: true });
  await mkdir(path.join(project, ".data-editor", "runtime", "entry-action-artifacts"), { recursive: true });
  await mkdir(path.join(project, ".data-editor", "local"), { recursive: true });
  await writeFile(path.join(project, "data", "items.json"), `${JSON.stringify({ items: [{ id: 1, slug: "existing", name: "Existing", dev_note: "", __entry_id: "01JEXISTING00000000000001" }] }, null, 2)}\n`);
  const textPolicy = { required: true, maxBytes: 4096, createOnly: true, allowedExtensions: [".md"], pathTemplate: "docs/{key}.md", pathKeyField: "slug", textArtifactPathField: "dev_doc", sectionOnly: { heading: "Design", level: 1, allowCreate: true, allowUpdate: false } };
  const createUnsigned = {
    candidateIdPolicy: { field: "slug", pattern: "^[a-z][a-z0-9_-]*$" }, collectionKind: "array", contractId: "fixture.create.v1",
    createAdapter: { id: "next-integer-v1", config: { field: "id", startAt: 1 } },
    humanNoteDefaults: { dev_note: "" }, humanNoteFields: ["dev_note"], requiredFields: ["slug", "name"],
    rowSchema: { type: "object", additionalProperties: false, required: ["slug", "name", "id", "dev_doc", "dev_note", "__entry_id"], properties: { slug: { type: "string" }, name: { type: "string" }, id: { type: "integer" }, dev_doc: { type: "string", pattern: "^docs/[a-z][a-z0-9_-]*\\.md$" }, dev_note: { type: "string" }, __entry_id: { type: "string" } } },
    serverDefaults: {}, serverOwnedFields: ["id", "dev_doc"], textArtifactPolicy: textPolicy, uniqueKeys: [["slug"], ["id"], ["dev_doc"]], writableFields: ["slug", "name"],
  };
  const createAuthority = { ...createUnsigned, digest: hash(canonical(createUnsigned)) };
  const contractUnsigned = { contractId: "fixture.create.v1", version: 1, predicate: { all: [] }, writableFields: [], legalTransitions: [], textArtifactPolicy: textPolicy, evidencePolicy: {}, resultPolicy: "proposal", createAuthority };
  const contract = { ...contractUnsigned, digest: hash(canonical(contractUnsigned)) };
  const missingAdapterCreateUnsigned = { ...createUnsigned, contractId: "fixture.missing-adapter.v1", createAdapter: { id: "unregistered-v1", config: {} } };
  const missingAdapterCreateAuthority = { ...missingAdapterCreateUnsigned, digest: hash(canonical(missingAdapterCreateUnsigned)) };
  const missingAdapterContractUnsigned = { ...contractUnsigned, contractId: "fixture.missing-adapter.v1", createAuthority: missingAdapterCreateAuthority };
  const missingAdapterContract = { ...missingAdapterContractUnsigned, digest: hash(canonical(missingAdapterContractUnsigned)) };
  const updateUnsigned = { contractId: "fixture.update.v1", version: 1, predicate: { all: [] }, writableFields: ["name"], legalTransitions: [], textArtifactPolicy: {}, evidencePolicy: {}, resultPolicy: "proposal", createAuthority: null };
  const updateContract = { ...updateUnsigned, digest: hash(canonical(updateUnsigned)) };
  const transactionUnsigned = { contractId: "fixture.transaction.v1", version: 1, predicate: { all: [{ field: "name", op: "eq", value: "Renamed" }] }, writableFields: [], legalTransitions: [], textArtifactPolicy: {}, evidencePolicy: {}, resultPolicy: "project-transaction", createAuthority: null, projectTransaction: { ownerId: "fixture-json-owner", capabilityId: "fixture-transaction-v1" } };
  const transactionContract = { ...transactionUnsigned, digest: hash(canonical(transactionUnsigned)) };
  await writeFile(path.join(project, ".data-editor", "entry-action-contracts.json"), `${JSON.stringify({ version: 1, contracts: [contract, missingAdapterContract, updateContract, transactionContract] }, null, 2)}\n`);
  const target = { file: "data/items.json", collection: "items" }; const payload = { includeRow: false, includeNeighbors: false }; const execution = { kind: "project-skill", resultPolicy: "proposal" };
  await writeFile(path.join(project, ".data-editor", "automation-profile.json"), `${JSON.stringify({ rules: [
    { id: "create-item", enabled: true, label: "Create item", icon: "edit", targets: [target], payload, execution, contractId: contract.contractId, createAuthority: { enabled: true, contractId: contract.contractId } },
    { id: "create-missing-adapter", enabled: true, label: "Create without adapter", icon: "edit", targets: [target], payload, execution, contractId: missingAdapterContract.contractId, createAuthority: { enabled: true, contractId: missingAdapterContract.contractId } },
    { id: "rename-item", enabled: true, label: "Rename item", icon: "edit", targets: [target], payload, execution, contractId: updateContract.contractId },
    { id: "transact-item", enabled: true, label: "Transact item", icon: "edit", targets: [target], payload, execution: { kind: "project-skill", resultPolicy: "project-transaction", ownerId: "fixture-json-owner", capabilityId: "fixture-transaction-v1" }, contractId: transactionContract.contractId },
    { id: "transact-no-write", enabled: true, label: "Transact no write", icon: "edit", targets: [target], payload, execution: { kind: "project-skill", resultPolicy: "project-transaction", ownerId: "fixture-json-owner", capabilityId: "fixture-transaction-v1" }, contractId: transactionContract.contractId },
    { id: "transact-ineligible", enabled: true, label: "Transact ineligible", icon: "edit", targets: [target], payload, execution: { kind: "project-skill", resultPolicy: "project-transaction", ownerId: "fixture-json-owner", capabilityId: "fixture-transaction-v1" }, contractId: transactionContract.contractId },
  ] }, null, 2)}\n`);
  await writeFile(path.join(project, ".data-editor", "local", "automation-bindings.json"), `${JSON.stringify({ defaults: { timeoutMs: 30_000 }, bindings: { "create-item": { provider: "codex", skill: "fixture-create" }, "transact-item": { provider: "codex", skill: "fixture-create" }, "transact-no-write": { provider: "codex", skill: "fixture-create" }, "transact-ineligible": { provider: "codex", skill: "fixture-create" } } }, null, 2)}\n`);
  await writeFile(path.join(project, ".agents", "skills", "fixture-create", "SKILL.md"), "# Fixture create\nReturn the requested fixture candidate.\n", "utf8");
  const content = "# Design\nAlpha\n";
  const manifest = { version: 1, kind: "candidate-create", candidateId: "alpha", designSubjectDigest: "d".repeat(64), row: { slug: "alpha", name: "Alpha" }, textArtifact: { afterContent: content, afterDigest: hash(content) }, summary: "Create Alpha" };
  const envelope = `${JSON.stringify({ version: 1, target: { sourcePath: "data/items.json", collectionPath: "items" }, result: manifest })}\n`;
  const projectContext = createProjectContext(project);
  const note = "Designer note, punctuation  原样。\nSecond line.";
  await publishExactArtifact({ projectContext, artifactId: "candidate-alpha", content: envelope, humanNotes: { field: "dev_note", text: note } });
  const skillContent = "# Design\nEpsilon\n";
  const skillReply = JSON.stringify({ version: 1, kind: "candidate-create", candidateId: "epsilon", designSubjectDigest: "e".repeat(64), row: { slug: "epsilon", name: "epsilon" }, textArtifact: { afterContent: skillContent, afterDigest: hash(skillContent) }, summary: "Create epsilon" });
  const transactionRow = { id: 1, slug: "existing", name: "Renamed", dev_note: "", __entry_id: "01JEXISTING00000000000001" }; const transactionDigest = rowDigest(transactionRow);
  const ineligibleTransactionRow = { ...transactionRow, name: "Blocked" }; const ineligibleTransactionDigest = rowDigest(ineligibleTransactionRow);
  const transactionReply = JSON.stringify({ kind: "project-transaction-result", ownerId: "fixture-json-owner", capabilityId: "fixture-transaction-v1", subject: { sourcePath: "data/items.json", collectionPath: "items", rowId: transactionRow.__entry_id, expectedRowDigest: transactionDigest }, payload: { changed: true }, summary: "Transaction wrote" });
  const noWriteTransactionReply = JSON.stringify({ kind: "project-transaction-result", ownerId: "fixture-json-owner", capabilityId: "fixture-transaction-v1", subject: { sourcePath: "data/items.json", collectionPath: "items", rowId: transactionRow.__entry_id, expectedRowDigest: transactionDigest }, payload: { changed: false }, summary: "Transaction checked" });
  const ineligibleTransactionReply = JSON.stringify({ kind: "project-transaction-result", ownerId: "fixture-json-owner", capabilityId: "fixture-transaction-v1", subject: { sourcePath: "data/items.json", collectionPath: "items", rowId: transactionRow.__entry_id, expectedRowDigest: ineligibleTransactionDigest }, payload: { changed: true }, summary: "Must not run" });
  await writeFile(path.join(project, ".data-editor", "project-transaction-owners.json"), JSON.stringify({ version: 1, owners: [{ ownerId: "fixture-json-owner", capabilityId: "fixture-transaction-v1", adapterId: "json-command-v1", config: { executableId: "node", allowedDirectory: "tools", entry: "tools/transaction-owner.mjs", fixedArgs: [] } }] }));
  await writeFile(path.join(project, "tools", "transaction-owner.mjs"), `import { writeFile } from "node:fs/promises"; let text=""; for await (const chunk of process.stdin) text+=chunk; const input=JSON.parse(text); if(input.payload.changed) await writeFile("transaction-write.json", JSON.stringify({runId:input.runId,fencingDigest:input.fencingDigest})); const result={version:1,runId:input.runId,ownerId:input.ownerId,capabilityId:input.capabilityId,subjectDigest:input.subjectDigest,changed:Boolean(input.payload.changed),receipt:{durable:true}}; await writeFile(input.resultPath, JSON.stringify(result), {flag:"wx"}); process.stdout.write(JSON.stringify(result));\n`);
  const recoveredRunId = "30000000-0000-4000-8000-000000000001"; const recoveredSubjectDigest = "c".repeat(64); const ownerJournalRoot = path.join(project, ".data-editor", "runtime", "project-transactions"); await mkdir(ownerJournalRoot, { recursive: true });
  await writeFile(path.join(ownerJournalRoot, `${recoveredRunId}.json`), JSON.stringify({ version: 1, state: "started", runId: recoveredRunId, actionId: "transact-item", ownerId: "fixture-json-owner", capabilityId: "fixture-transaction-v1", requestDigest: "d".repeat(64), subjectDigest: recoveredSubjectDigest, deadline: Date.now() - 1, message: "Recovered transaction" }));
  await writeFile(path.join(ownerJournalRoot, `${recoveredRunId}.result.json`), JSON.stringify({ version: 1, runId: recoveredRunId, ownerId: "fixture-json-owner", capabilityId: "fixture-transaction-v1", subjectDigest: recoveredSubjectDigest, changed: false, receipt: { durable: true, recovered: true } }));
  const lateRecoveredRunId = "30000000-0000-4000-8000-000000000002"; await writeFile(path.join(ownerJournalRoot, `${lateRecoveredRunId}.json`), JSON.stringify({ version: 1, state: "pending", runId: lateRecoveredRunId, actionId: "transact-item", ownerId: "fixture-json-owner", capabilityId: "fixture-transaction-v1", requestDigest: "e".repeat(64), subjectDigest: recoveredSubjectDigest, deadline: Date.now() - 1, message: "Late recovered transaction", recovery: { state: "termination_unconfirmed" } }));
  const fakeCodex = path.join(registryHome, "fake-codex.exe");
  const fakeSource = 'using System; using System.IO; public class FakeCodex { public static void Main(string[] args) { int i = Array.IndexOf(args, "-o"); if (i < 0 || i + 1 >= args.Length) Environment.Exit(2); string prompt = Console.In.ReadToEnd(); string key = prompt.Contains("transact-ineligible") ? "DATA_EDITOR_FAKE_TRANSACTION_INELIGIBLE_REPLY" : prompt.Contains("transact-no-write") ? "DATA_EDITOR_FAKE_TRANSACTION_NO_WRITE_REPLY" : prompt.Contains("transact-item") ? "DATA_EDITOR_FAKE_TRANSACTION_REPLY" : "DATA_EDITOR_FAKE_CODEX_REPLY"; File.WriteAllText(args[i + 1], Environment.GetEnvironmentVariable(key)); Console.WriteLine("{}"); } }';
  await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "$source=$env:DATA_EDITOR_FAKE_CODEX_SOURCE; Add-Type -TypeDefinition $source -Language CSharp -OutputAssembly $env:DATA_EDITOR_FAKE_CODEX_OUTPUT -OutputType ConsoleApplication"], { env: { ...process.env, DATA_EDITOR_FAKE_CODEX_SOURCE: fakeSource, DATA_EDITOR_FAKE_CODEX_OUTPUT: fakeCodex } });
  const port = 39000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, [path.resolve("server.mjs"), "--project", project, "--registry-home", registryHome, "--port", String(port)], { cwd: path.resolve("."), windowsHide: true, stdio: "ignore", env: { ...process.env, DATA_EDITOR_CODEX_CLI: fakeCodex, DATA_EDITOR_FAKE_CODEX_REPLY: skillReply, DATA_EDITOR_FAKE_TRANSACTION_REPLY: transactionReply, DATA_EDITOR_FAKE_TRANSACTION_NO_WRITE_REPLY: noWriteTransactionReply, DATA_EDITOR_FAKE_TRANSACTION_INELIGIBLE_REPLY: ineligibleTransactionReply } });
  t.after(async () => { if (child.exitCode === null) { child.kill(); await new Promise((resolve) => child.once("exit", resolve)); } });
  for (let attempt = 0; attempt < 80; attempt += 1) { try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch {} await new Promise((resolve) => setTimeout(resolve, 100)); }
  const projects = await (await fetch(`http://127.0.0.1:${port}/api/projects`)).json();
  const recoveredResponse = await fetch(`http://127.0.0.1:${port}/api/entry-actions/result?projectId=${encodeURIComponent(projects.activeProjectId)}&runId=${recoveredRunId}`); const recoveredTerminal = await recoveredResponse.json(); assert.equal(recoveredResponse.status, 200, JSON.stringify(recoveredTerminal)); assert.equal(recoveredTerminal.outcome, "completed_without_changes"); assert.equal(recoveredTerminal.transactionReceipt.recovered, true);
  const explicitPendingRecovery = await fetch(`http://127.0.0.1:${port}/api/entry-actions/recover-project-transactions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: projects.activeProjectId, runId: lateRecoveredRunId }) }); const explicitPending = await explicitPendingRecovery.json(); assert.equal(explicitPendingRecovery.status, 200, JSON.stringify(explicitPending)); assert.ok(explicitPending.pending.includes(lateRecoveredRunId));
  await writeFile(path.join(ownerJournalRoot, `${lateRecoveredRunId}.result.json`), JSON.stringify({ version: 1, runId: lateRecoveredRunId, ownerId: "fixture-json-owner", capabilityId: "fixture-transaction-v1", subjectDigest: recoveredSubjectDigest, changed: true, receipt: { durable: true, late: true } }));
  let lateRecoveredTerminal = null; for (let attempt = 0; attempt < 40; attempt += 1) { const response = await fetch(`http://127.0.0.1:${port}/api/entry-actions/result?projectId=${encodeURIComponent(projects.activeProjectId)}&runId=${lateRecoveredRunId}`); if (response.status === 200) { lateRecoveredTerminal = await response.json(); if (lateRecoveredTerminal.phase === "terminal") break; } await new Promise((resolve) => setTimeout(resolve, 25)); }
  assert.equal(lateRecoveredTerminal?.outcome, "completed_with_writeback", JSON.stringify(lateRecoveredTerminal)); assert.equal(lateRecoveredTerminal.transactionReceipt.late, true);
  const invalidJournalPath = path.join(ownerJournalRoot, "invalid-hot-path.json"); await writeFile(invalidJournalPath, "{"); const ordinaryRequest = await fetch(`http://127.0.0.1:${port}/api/projects`); assert.equal(ordinaryRequest.status, 200); const explicitInvalidRecovery = await fetch(`http://127.0.0.1:${port}/api/entry-actions/recover-project-transactions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: projects.activeProjectId }) }); assert.equal(explicitInvalidRecovery.status, 500); await rm(invalidJournalPath);
  const unknownProjectResponse = await fetch(`http://127.0.0.1:${port}/api/entry-actions/submit-exact-artifact`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: "unknown-project", actionId: "create-item", artifactId: "candidate-alpha", artifactDigest: hash(envelope), target: { sourcePath: "data/items.json", collectionPath: "items" } }) });
  const unknownProjectError = await unknownProjectResponse.json(); assert.equal(unknownProjectResponse.status, 404); assert.equal(unknownProjectError.code, "ENTRY_ACTION_PROJECT_UNKNOWN");
  const malformedRequest = await fetch(`http://127.0.0.1:${port}/api/entry-actions/submit-exact-artifact`, { method: "POST", headers: { "content-type": "application/json" }, body: "{" });
  const malformedRequestError = await malformedRequest.json(); assert.equal(malformedRequest.status, 400); assert.equal(malformedRequestError.code, "HTTP_REQUEST_JSON_INVALID");
  const existingRow = { id: 1, slug: "existing", name: "Existing", dev_note: "", __entry_id: "01JEXISTING00000000000001" };
  const proposalEnvelope = `${JSON.stringify({ version: 1, target: { sourcePath: "data/items.json", collectionPath: "items", rowId: existingRow.__entry_id, expectedRowDigest: rowDigest(existingRow) }, result: { kind: "entry-action-proposal", proposal: { changes: [{ field: "name", beforeExists: true, before: "Existing", afterExists: true, after: "Renamed" }], textArtifact: null, summary: "Rename existing" }, evidence: [] } })}\n`;
  await publishExactArtifact({ projectContext, artifactId: "rename-existing", content: proposalEnvelope });
  const proposalResponse = await fetch(`http://127.0.0.1:${port}/api/entry-actions/submit-exact-artifact`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: projects.activeProjectId, actionId: "rename-item", artifactId: "rename-existing", artifactDigest: hash(proposalEnvelope), target: { sourcePath: "data/items.json", collectionPath: "items" } }) });
  const proposalResult = await proposalResponse.json(); assert.equal(proposalResponse.status, 200, JSON.stringify(proposalResult)); assert.equal(proposalResult.kind, "entry-action-proposal");
  const response = await fetch(`http://127.0.0.1:${port}/api/entry-actions/submit-exact-artifact`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: projects.activeProjectId, actionId: "create-item", artifactId: "candidate-alpha", artifactDigest: hash(envelope), target: { sourcePath: "data/items.json", collectionPath: "items" } }) });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result)); assert.equal(result.kind, "candidate-create");
  const replayResponse = await fetch(`http://127.0.0.1:${port}/api/entry-actions/submit-exact-artifact`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: projects.activeProjectId, actionId: "create-item", artifactId: "candidate-alpha", artifactDigest: hash(envelope), target: { sourcePath: "data/items.json", collectionPath: "items" } }) });
  const replay = await replayResponse.json(); assert.equal(replayResponse.status, 200, JSON.stringify(replay)); assert.equal(replay.replayed, true); assert.notEqual(replay.runId, result.runId); assert.equal(replay.originalRunId, result.runId);
  const rows = JSON.parse(await readFile(path.join(project, "data", "items.json"), "utf8")).items;
  assert.equal(rows[0].name, "Renamed"); assert.equal(rows[1].slug, "alpha"); assert.equal(rows[1].id, 2); assert.equal(rows[1].dev_doc, "docs/alpha.md"); assert.match(rows[1].__entry_id, /^[0-9A-Z]{26}$/); assert.equal(rows[1].dev_note, note);
  assert.equal(await readFile(path.join(project, "docs", "alpha.md"), "utf8"), content);

  const betaContent = "# Design\nBeta\n"; const betaManifest = { ...manifest, candidateId: "beta", row: { slug: "beta", name: "Beta" }, textArtifact: { afterContent: betaContent, afterDigest: hash(betaContent) }, summary: "Create Beta" };
  const betaEnvelope = `${JSON.stringify({ version: 1, target: { sourcePath: "data/items.json", collectionPath: "items" }, result: betaManifest })}\n`;
  await publishExactArtifact({ projectContext, artifactId: "candidate-beta", content: betaEnvelope });
  const betaResponse = await fetch(`http://127.0.0.1:${port}/api/entry-actions/submit-exact-artifact`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: projects.activeProjectId, actionId: "create-item", artifactId: "candidate-beta", artifactDigest: hash(betaEnvelope), target: { sourcePath: "data/items.json", collectionPath: "items" } }) });
  assert.equal(betaResponse.status, 200, JSON.stringify(await betaResponse.json()));
  const afterBeta = JSON.parse(await readFile(path.join(project, "data", "items.json"), "utf8")).items; assert.equal(afterBeta[2].dev_note, ""); assert.equal(afterBeta[2].id, 3);

  const concurrentRequests = [];
  for (const slug of ["gamma", "delta"]) {
    const candidateContent = `# Design\n${slug}\n`; const candidateManifest = { ...manifest, candidateId: slug, row: { slug, name: slug }, textArtifact: { afterContent: candidateContent, afterDigest: hash(candidateContent) }, summary: `Create ${slug}` };
    const candidateEnvelope = `${JSON.stringify({ version: 1, target: { sourcePath: "data/items.json", collectionPath: "items" }, result: candidateManifest })}\n`;
    await publishExactArtifact({ projectContext, artifactId: `candidate-${slug}`, content: candidateEnvelope });
    concurrentRequests.push({ slug, candidateEnvelope, request: () => fetch(`http://127.0.0.1:${port}/api/entry-actions/submit-exact-artifact`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: projects.activeProjectId, actionId: "create-item", artifactId: `candidate-${slug}`, artifactDigest: hash(candidateEnvelope), target: { sourcePath: "data/items.json", collectionPath: "items" } }) }) });
  }
  const concurrentResponses = await Promise.all(concurrentRequests.map((item) => item.request()));
  for (let index = 0; index < concurrentResponses.length; index += 1) {
    if (concurrentResponses[index].status === 200) continue;
    const busy = await concurrentResponses[index].json(); assert.equal(concurrentResponses[index].status, 409); assert.ok(["ENTRY_ACTION_ADMISSION_BUSY", "ENTRY_ACTION_FENCING_ALLOCATOR_BUSY"].includes(busy.code), JSON.stringify(busy));
    const retry = await concurrentRequests[index].request(); const retried = await retry.json(); assert.equal(retry.status, 200, JSON.stringify(retried));
  }
  const afterConcurrent = JSON.parse(await readFile(path.join(project, "data", "items.json"), "utf8")).items;
  const concurrentIds = afterConcurrent.filter((row) => ["gamma", "delta"].includes(row.slug)).map((row) => row.id).sort((a, b) => a - b);
  assert.deepEqual(concurrentIds, [4, 5]); assert.equal(new Set(afterConcurrent.map((row) => row.id)).size, afterConcurrent.length);

  const projectSkillResponse = await fetch(`http://127.0.0.1:${port}/api/entry-actions/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: projects.activeProjectId, actionId: "create-item", sourcePath: "data/items.json", collectionPath: "items" }) });
  const projectSkillStarted = await projectSkillResponse.json(); assert.equal(projectSkillResponse.status, 200, JSON.stringify(projectSkillStarted)); assert.equal(projectSkillStarted.resultPolicy, "proposal");
  let projectSkillTerminal = null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const current = await fetch(`http://127.0.0.1:${port}/api/entry-actions/result?projectId=${encodeURIComponent(projects.activeProjectId)}&runId=${encodeURIComponent(projectSkillStarted.runId)}`);
    projectSkillTerminal = await current.json();
    if (projectSkillTerminal.phase === "terminal") break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(projectSkillTerminal?.outcome, "completed_with_writeback", JSON.stringify(projectSkillTerminal));
  const afterProjectSkill = JSON.parse(await readFile(path.join(project, "data", "items.json"), "utf8")).items;
  assert.equal(afterProjectSkill.find((row) => row.slug === "epsilon")?.id, 6);
  assert.equal(new Set(afterProjectSkill.map((row) => row.id)).size, afterProjectSkill.length);

  const publishedContent = "# Design\nZeta\n"; const publishedManifest = { ...manifest, candidateId: "zeta", row: { slug: "zeta", name: "Zeta" }, textArtifact: { afterContent: publishedContent, afterDigest: hash(publishedContent) }, summary: "Create Zeta" };
  const publishedEnvelope = `${JSON.stringify({ version: 1, target: { sourcePath: "data/items.json", collectionPath: "items" }, result: publishedManifest })}\n`;
  const publicationBody = { projectId: projects.activeProjectId, artifactId: "candidate-zeta", content: publishedEnvelope, humanNotes: { field: "dev_note", text: "published note" } };
  const publication = await fetch(`http://127.0.0.1:${port}/api/entry-actions/publish-exact-artifact`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(publicationBody) });
  const publicationResult = await publication.json(); assert.equal(publication.status, 200, JSON.stringify(publicationResult)); assert.equal(publicationResult.artifactDigest, hash(publishedEnvelope)); assert.equal(publicationResult.receiptVersion, 1);
  const publicationReplay = await fetch(`http://127.0.0.1:${port}/api/entry-actions/publish-exact-artifact`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(publicationBody) }); assert.equal(publicationReplay.status, 200, JSON.stringify(await publicationReplay.json()));
  const publicationForgery = await fetch(`http://127.0.0.1:${port}/api/entry-actions/publish-exact-artifact`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...publicationBody, content: `${publishedEnvelope} ` }) }); const publicationForgeryError = await publicationForgery.json(); assert.equal(publicationForgery.status, 409); assert.equal(publicationForgeryError.code, "EXACT_ARTIFACT_IDEMPOTENCY_CONFLICT");
  const zetaSubmit = await fetch(`http://127.0.0.1:${port}/api/entry-actions/submit-exact-artifact`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: projects.activeProjectId, actionId: "create-item", artifactId: "candidate-zeta", artifactDigest: hash(publishedEnvelope), target: { sourcePath: "data/items.json", collectionPath: "items" } }) }); const zetaResult = await zetaSubmit.json(); assert.equal(zetaSubmit.status, 200, JSON.stringify(zetaResult));
  const zetaRow = JSON.parse(await readFile(path.join(project, "data", "items.json"), "utf8")).items.find((row) => row.slug === "zeta"); assert.equal(zetaRow.id, 7); assert.equal(zetaRow.dev_note, "published note");

  const halfContent = "# Design\nEta\n"; const halfManifest = { ...manifest, candidateId: "eta", row: { slug: "eta", name: "Eta" }, textArtifact: { afterContent: halfContent, afterDigest: hash(halfContent) }, summary: "Create Eta" }; const halfEnvelope = `${JSON.stringify({ version: 1, target: { sourcePath: "data/items.json", collectionPath: "items" }, result: halfManifest })}\n`;
  await writeFile(path.join(project, ".data-editor", "runtime", "entry-action-artifacts", "candidate-eta.json"), halfEnvelope, "utf8");
  const halfPublication = await fetch(`http://127.0.0.1:${port}/api/entry-actions/publish-exact-artifact`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: projects.activeProjectId, artifactId: "candidate-eta", content: halfEnvelope, humanNotes: null }) }); assert.equal(halfPublication.status, 200, JSON.stringify(await halfPublication.json()));
  assert.equal(JSON.parse(await readFile(path.join(project, "data", "items.json"), "utf8")).items.some((row) => row.slug === "eta"), false);

  const cliContent = "# Design\nTheta\n"; const cliManifest = { ...manifest, candidateId: "theta", row: { slug: "theta", name: "Theta" }, textArtifact: { afterContent: cliContent, afterDigest: hash(cliContent) }, summary: "Create Theta" }; const cliEnvelope = `${JSON.stringify({ version: 1, target: { sourcePath: "data/items.json", collectionPath: "items" }, result: cliManifest })}\n`;
  const cliContentPath = path.join(registryHome, "theta-envelope.json"); const cliNotesPath = path.join(registryHome, "theta-notes.json"); await writeFile(cliContentPath, cliEnvelope); await writeFile(cliNotesPath, JSON.stringify({ field: "dev_note", text: "cli note" }));
  const beforeCliPublication = await readFile(path.join(project, "data", "items.json"), "utf8");
  const cliPublication = await execFileAsync(process.execPath, [path.resolve("scripts/publish-entry-action-exact-artifact.mjs"), "--url", `http://127.0.0.1:${port}`, "--project-id", projects.activeProjectId, "--artifact-id", "candidate-theta", "--content-file", cliContentPath, "--human-notes-file", cliNotesPath]); const cliPublished = JSON.parse(cliPublication.stdout); assert.equal(cliPublished.artifactDigest, hash(cliEnvelope)); assert.equal(await readFile(path.join(project, "data", "items.json"), "utf8"), beforeCliPublication);
  const thetaSubmit = await fetch(`http://127.0.0.1:${port}/api/entry-actions/submit-exact-artifact`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: projects.activeProjectId, actionId: "create-item", artifactId: "candidate-theta", artifactDigest: hash(cliEnvelope), target: { sourcePath: "data/items.json", collectionPath: "items" } }) }); const thetaResult = await thetaSubmit.json(); assert.equal(thetaSubmit.status, 200, JSON.stringify(thetaResult));
  const thetaRow = JSON.parse(await readFile(path.join(project, "data", "items.json"), "utf8")).items.find((row) => row.slug === "theta"); assert.equal(thetaRow.id, 8); assert.equal(thetaRow.dev_note, "cli note");

  const beforeTransaction = await readFile(path.join(project, "data", "items.json"), "utf8");
  const transactionResponse = await fetch(`http://127.0.0.1:${port}/api/entry-actions/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: projects.activeProjectId, actionId: "transact-item", sourcePath: "data/items.json", collectionPath: "items", rowId: transactionRow.__entry_id, expectedRowDigest: transactionDigest }) });
  const transactionStarted = await transactionResponse.json(); assert.equal(transactionResponse.status, 200, JSON.stringify(transactionStarted)); assert.equal(transactionStarted.resultPolicy, "project-transaction");
  let transactionTerminal = null;
  for (let attempt = 0; attempt < 100; attempt += 1) { const current = await fetch(`http://127.0.0.1:${port}/api/entry-actions/result?projectId=${encodeURIComponent(projects.activeProjectId)}&runId=${encodeURIComponent(transactionStarted.runId)}`); transactionTerminal = await current.json(); if (transactionTerminal.phase === "terminal") break; await new Promise((resolve) => setTimeout(resolve, 100)); }
  assert.equal(transactionTerminal?.outcome, "completed_with_writeback", JSON.stringify(transactionTerminal)); assert.equal(transactionTerminal.runId, transactionStarted.runId); assert.equal(await readFile(path.join(project, "data", "items.json"), "utf8"), beforeTransaction);
  const ownerWrite = await readFile(path.join(project, "transaction-write.json"), "utf8"); assert.equal(JSON.parse(ownerWrite).runId, transactionStarted.runId);
  const noWriteResponse = await fetch(`http://127.0.0.1:${port}/api/entry-actions/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: projects.activeProjectId, actionId: "transact-no-write", sourcePath: "data/items.json", collectionPath: "items", rowId: transactionRow.__entry_id, expectedRowDigest: transactionDigest }) });
  const noWriteStarted = await noWriteResponse.json(); assert.equal(noWriteResponse.status, 200, JSON.stringify(noWriteStarted)); let noWriteTerminal = null;
  for (let attempt = 0; attempt < 100; attempt += 1) { const current = await fetch(`http://127.0.0.1:${port}/api/entry-actions/result?projectId=${encodeURIComponent(projects.activeProjectId)}&runId=${encodeURIComponent(noWriteStarted.runId)}`); noWriteTerminal = await current.json(); if (noWriteTerminal.phase === "terminal") break; await new Promise((resolve) => setTimeout(resolve, 100)); }
  assert.equal(noWriteTerminal?.outcome, "completed_without_changes", JSON.stringify(noWriteTerminal)); assert.equal(await readFile(path.join(project, "transaction-write.json"), "utf8"), ownerWrite);
  const blockedRoot = JSON.parse(beforeTransaction); blockedRoot.items[0].name = "Blocked"; await writeFile(path.join(project, "data", "items.json"), `${JSON.stringify(blockedRoot, null, 2)}\n`);
  const ineligibleResponse = await fetch(`http://127.0.0.1:${port}/api/entry-actions/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: projects.activeProjectId, actionId: "transact-ineligible", sourcePath: "data/items.json", collectionPath: "items", rowId: transactionRow.__entry_id, expectedRowDigest: ineligibleTransactionDigest }) });
  const ineligibleStarted = await ineligibleResponse.json(); assert.equal(ineligibleResponse.status, 200, JSON.stringify(ineligibleStarted)); let ineligibleTerminal = null;
  for (let attempt = 0; attempt < 100; attempt += 1) { const current = await fetch(`http://127.0.0.1:${port}/api/entry-actions/result?projectId=${encodeURIComponent(projects.activeProjectId)}&runId=${encodeURIComponent(ineligibleStarted.runId)}`); ineligibleTerminal = await current.json(); if (ineligibleTerminal.phase === "terminal") break; await new Promise((resolve) => setTimeout(resolve, 100)); }
  assert.equal(ineligibleTerminal?.outcome, "failed", JSON.stringify(ineligibleTerminal)); assert.equal(await readFile(path.join(project, "transaction-write.json"), "utf8"), ownerWrite);

  const missingContent = "# Design\nMissing adapter\n"; const missingManifest = { ...manifest, candidateId: "missing", row: { slug: "missing", name: "Missing" }, textArtifact: { afterContent: missingContent, afterDigest: hash(missingContent) }, summary: "Missing adapter" };
  const missingEnvelope = `${JSON.stringify({ version: 1, target: { sourcePath: "data/items.json", collectionPath: "items" }, result: missingManifest })}\n`;
  await publishExactArtifact({ projectContext, artifactId: "candidate-missing", content: missingEnvelope });
  const missingResponse = await fetch(`http://127.0.0.1:${port}/api/entry-actions/submit-exact-artifact`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: projects.activeProjectId, actionId: "create-missing-adapter", artifactId: "candidate-missing", artifactDigest: hash(missingEnvelope), target: { sourcePath: "data/items.json", collectionPath: "items" } }) });
  const missingError = await missingResponse.json(); assert.equal(missingResponse.status, 500); assert.equal(missingError.code, "CANDIDATE_CREATE_SERVER_ALLOCATION_UNAVAILABLE");

  const forgedEnvelope = `${JSON.stringify({ version: 1, target: { sourcePath: "data/items.json", collectionPath: "items" }, result: { ...betaManifest, candidateId: "forged", row: { slug: "forged", name: "Forged" }, humanNotes: { field: "dev_note", text: "model-forged" } } })}\n`;
  await publishExactArtifact({ projectContext, artifactId: "candidate-forged", content: forgedEnvelope });
  const forgedResponse = await fetch(`http://127.0.0.1:${port}/api/entry-actions/submit-exact-artifact`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: projects.activeProjectId, actionId: "create-item", artifactId: "candidate-forged", artifactDigest: hash(forgedEnvelope), target: { sourcePath: "data/items.json", collectionPath: "items" } }) });
  const forgedError = await forgedResponse.json(); assert.equal(forgedResponse.status, 400); assert.equal(forgedError.code, "EXACT_ARTIFACT_CONTENT_INVALID");

  await publishExactArtifact({ projectContext, artifactId: "candidate-schema-invalid", content: `${JSON.stringify({ version: 1, target: { sourcePath: "data/items.json", collectionPath: "items" }, result: { ...betaManifest, candidateId: "schema-invalid", row: { slug: "schema-invalid" } } })}\n` });
  const schemaInvalidContent = await readFile(path.join(project, ".data-editor", "runtime", "entry-action-artifacts", "candidate-schema-invalid.json"), "utf8");
  const schemaInvalidResponse = await fetch(`http://127.0.0.1:${port}/api/entry-actions/submit-exact-artifact`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: projects.activeProjectId, actionId: "create-item", artifactId: "candidate-schema-invalid", artifactDigest: hash(schemaInvalidContent), target: { sourcePath: "data/items.json", collectionPath: "items" } }) });
  const schemaInvalidError = await schemaInvalidResponse.json(); assert.equal(schemaInvalidResponse.status, 400); assert.equal(schemaInvalidError.code, "CANDIDATE_CREATE_REQUIRED_FIELD_MISSING");

  const badNoteEnvelope = `${JSON.stringify({ version: 1, target: { sourcePath: "data/items.json", collectionPath: "items" }, result: { ...betaManifest, candidateId: "badnote", row: { slug: "badnote", name: "Bad note" } } })}\n`;
  await publishExactArtifact({ projectContext, artifactId: "candidate-badnote", content: badNoteEnvelope, humanNotes: { field: "dev_note", text: "bound" } });
  const notePath = path.join(project, ".data-editor", "runtime", "entry-action-artifacts", "candidate-badnote.receipt.json"); const badMetadata = JSON.parse(await readFile(notePath, "utf8")); badMetadata.humanNotes.textDigest = "0".repeat(64); await writeFile(notePath, `${JSON.stringify(badMetadata, null, 2)}\n`);
  const badNoteResponse = await fetch(`http://127.0.0.1:${port}/api/entry-actions/submit-exact-artifact`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: projects.activeProjectId, actionId: "create-item", artifactId: "candidate-badnote", artifactDigest: hash(badNoteEnvelope), target: { sourcePath: "data/items.json", collectionPath: "items" } }) });
  const badNoteError = await badNoteResponse.json(); assert.equal(badNoteResponse.status, 409); assert.equal(badNoteError.code, "EXACT_ARTIFACT_RECEIPT_INVALID");
  const artifactRoot = path.join(project, ".data-editor", "runtime", "entry-action-artifacts");
  await writeFile(path.join(artifactRoot, "candidate-orphan.json"), betaEnvelope, "utf8");
  const orphanResponse = await fetch(`http://127.0.0.1:${port}/api/entry-actions/submit-exact-artifact`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: projects.activeProjectId, actionId: "create-item", artifactId: "candidate-orphan", artifactDigest: hash(betaEnvelope), target: { sourcePath: "data/items.json", collectionPath: "items" } }) });
  const orphanError = await orphanResponse.json(); assert.equal(orphanResponse.status, 409); assert.equal(orphanError.code, "EXACT_ARTIFACT_RECEIPT_INVALID");
  await rm(path.join(artifactRoot, "candidate-alpha.receipt.json"));
  const deletedReceiptResponse = await fetch(`http://127.0.0.1:${port}/api/entry-actions/submit-exact-artifact`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: projects.activeProjectId, actionId: "create-item", artifactId: "candidate-alpha", artifactDigest: hash(envelope), target: { sourcePath: "data/items.json", collectionPath: "items" } }) });
  const deletedReceiptError = await deletedReceiptResponse.json(); assert.equal(deletedReceiptResponse.status, 409); assert.equal(deletedReceiptError.code, "EXACT_ARTIFACT_RECEIPT_INVALID");
  await fetch(`http://127.0.0.1:${port}/api/shutdown`, { method: "POST" });
});
