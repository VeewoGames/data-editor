import assert from "node:assert/strict";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile, readdir } from "node:fs/promises";
import { createDocumentCommitCoordinator } from "../src/document-commit-coordinator.mjs";
import { bindProposalToHandoff, startProposalOnlyEntryAction, submitFreshEntryActionProposal, recoverProposalOnlyEntryActionGroup } from "../src/entry-action-service.mjs";
import {
  entryActionHandoffPath,
  findLatestEntryActionRun,
  writeEntryActionHandoff,
  publishEntryActionResultIdempotently,
  entryActionResultPath,
  entryActionProposalPath,
  readEntryActionResult,
  readEntryActionStarted,
  writeEntryActionStarted,
} from "../src/entry-actions.mjs";
import { createProjectContext } from "../src/project-context.mjs";
import { rowDigest } from "../src/row-digest.mjs";

test("service recalculates the model-supplied Markdown digest from its content", () => {
  const handoff = {
    runId: "10000000-0000-4000-8000-000000000001",
    action: { id: "fixture-rename" },
    entry: { sourcePath: "data/items.json", canonicalFileKey: "a".repeat(64), collectionPath: "items", rowId: "entry" },
    proposalContract: { version: 3, baseDocumentEtag: "\"etag\"", ruleDigest: "b".repeat(64), fencingToken: 1, textArtifact: { id: "skill-doc", path: "docs/skill.md", beforeExists: true, beforeDigest: "c".repeat(64) } },
  };
  const proposal = bindProposalToHandoff({
    textArtifact: { afterContent: "# Skill\n", afterDigest: "0".repeat(64) },
    evidence: [],
  }, handoff);
  assert.deepEqual(proposal.textArtifact, { id: "skill-doc", path: "docs/skill.md", beforeExists: true, beforeDigest: "c".repeat(64), afterContent: "# Skill\n", afterDigest: proposal.textArtifact.afterDigest });
  assert.equal(proposal.textArtifact.afterDigest, "74daeff849609b74a42500aff45eb6229a086907ab1b2badae4c29ed4fc10e3c");
});

test("proposal-only service commits an authorized row patch and publishes terminal state", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "data-editor-entry-action-service-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const context = createProjectContext({ projectRoot: root, projectId: "fixture-project" });
  await writeFixture(context);

  const jobSupervisor = {
    async start(spec) {
      const handoff = JSON.parse(await readFile(entryActionHandoffPath(context, spec.id), "utf8"));
      const args = parseArgs(spec.args.slice(1));
      const proposal = {
        version: 3,
        runId: spec.id,
        actionId: handoff.action.id,
        sourcePath: handoff.entry.sourcePath,
        canonicalFileKey: handoff.entry.canonicalFileKey,
        collectionPath: handoff.entry.collectionPath,
        // The model may mistype an immutable identity copied from the prompt.
        // The service must bind the proposal back to the server-created handoff.
        rowId: `${handoff.entry.rowId.slice(0, -1)}X`,
        baseDocumentEtag: handoff.proposalContract.baseDocumentEtag,
        ruleDigest: handoff.proposalContract.ruleDigest,
        fencingToken: handoff.proposalContract.fencingToken,
        changes: [{
          field: "name",
          beforeExists: true,
          before: "Old",
          afterExists: true,
          after: "New",
        }],
        textArtifact: null,
        summary: "Renamed fixture row.",
        evidence: [{ kind: "test-evidence", ref: "run/fixture", digest: "d".repeat(64) }],
      };
      await writeFile(args.reply, `${JSON.stringify(proposal)}\n`, "utf8");
      await writeFile(args.events, "", "utf8");
      await writeFile(args.diagnostics, "", "utf8");
      return {
        id: spec.id,
        jobInstanceId: spec.jobInstanceId,
        helper: { pid: 1001, creationFileTime: "1" },
        child: { pid: 1002, creationFileTime: "2" },
        completion: Promise.resolve({ exitCode: 0, timedOut: false }),
        terminate: async () => {},
      };
    },
  };

  const started = await startProposalOnlyEntryAction({
    projectContext: context,
    project: { id: "fixture-project", name: "Fixture" },
    request: {
      actionId: "fixture-rename",
      sourcePath: "data/items.json",
      collectionPath: "items",
      rowId: "01JTESTENTRY00000000000001",
      sourceRowIndex: 0,
      expectedRowDigest: fixtureRowDigest(),
    },
    toolRoot: path.resolve("."),
    jobSupervisor,
    documentCommitCoordinator: createDocumentCommitCoordinator(),
    dependencies: {
      resolveCodexBindingStatus: async () => ({
        status: "ready",
        codexCliPath: path.join(root, "codex.exe"),
        skillPath: path.join(root, "fixture-skill", "SKILL.md"),
      }),
    },
  });

  await started.completion;
  const document = JSON.parse(await readFile(path.join(root, "data", "items.json"), "utf8"));
  assert.equal(document.items[0].name, "New");
  assert.equal(document.items[0].__entry_id, "01JTESTENTRY00000000000001");
  const persistedProposal = JSON.parse(await readFile(path.join(root, ".data-editor", "runtime", "entry-actions", `${started.runId}.proposal.json`), "utf8"));
  assert.equal(persistedProposal.rowId, "01JTESTENTRY00000000000001");
  assert.deepEqual(persistedProposal.evidence, [{ kind: "test-evidence", ref: "run/fixture", digest: "d".repeat(64) }]);
  assert.deepEqual(await readEntryActionResult(context, started.runId), {
    version: 3,
    runId: started.runId,
    actionId: "fixture-rename",
    phase: "terminal",
    outcome: "completed_with_writeback",
    message: "Renamed fixture row.",
  });
});

test("proposal-only service publishes timed_out without changing the source document", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "data-editor-entry-action-timeout-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const context = createProjectContext({ projectRoot: root, projectId: "fixture-project" });
  await writeFixture(context);
  const sourcePath = path.join(root, "data", "items.json");
  const before = await readFile(sourcePath, "utf8");
  const jobSupervisor = {
    async start(spec) {
      const args = parseArgs(spec.args.slice(1));
      await writeFile(args.events, "{\"type\":\"turn.started\"}\n", "utf8");
      await writeFile(args.diagnostics, "fixture timeout\n", "utf8");
      return {
        id: spec.id,
        jobInstanceId: spec.jobInstanceId,
        helper: { pid: 1001, creationFileTime: "1" },
        child: { pid: 1002, creationFileTime: "2" },
        completion: Promise.resolve({ exitCode: 1, timedOut: true }),
        terminate: async () => {},
      };
    },
  };

  const started = await startProposalOnlyEntryAction({
    projectContext: context,
    project: { id: "fixture-project", name: "Fixture" },
    request: {
      actionId: "fixture-rename",
      sourcePath: "data/items.json",
      collectionPath: "items",
      rowId: "01JTESTENTRY00000000000001",
      sourceRowIndex: 0,
      expectedRowDigest: fixtureRowDigest(),
    },
    toolRoot: path.resolve("."),
    jobSupervisor,
    documentCommitCoordinator: createDocumentCommitCoordinator(),
    dependencies: {
      resolveCodexBindingStatus: async () => ({
        status: "ready",
        codexCliPath: path.join(root, "codex.exe"),
        skillPath: path.join(root, "fixture-skill", "SKILL.md"),
      }),
    },
  });

  await started.completion;
  assert.equal(await readFile(sourcePath, "utf8"), before);
  assert.equal((await readEntryActionResult(context, started.runId)).outcome, "timed_out");
  assert.equal(
    await readFile(path.join(root, ".data-editor", "runtime", "entry-actions", `${started.runId}.diagnostics.json`), "utf8"),
    "fixture timeout\n",
  );
});

test("fresh existing-row proposal commits its row and authorized text artifact as one group", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "data-editor-entry-action-group-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const context = createProjectContext({ projectRoot: root, projectId: "fixture-project" });
  const fixture = await writeTextArtifactFixture(context);
  const result = await submitFreshEntryActionProposal({
    projectContext: context,
    project: { id: "fixture-project", name: "Fixture" },
    request: fixture.request,
    result: fixture.result,
  });
  assert.equal(result.outcome, "completed_with_writeback");
  assert.equal(JSON.parse(await readFile(fixture.sourcePath, "utf8")).items[0].name, "New");
  assert.equal(await readFile(fixture.artifactPath, "utf8"), "# New design\n");
});

test("project-skill proposal commits into its accepted run without resetting duration", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "data-editor-entry-action-same-run-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const context = createProjectContext({ projectRoot: root, projectId: "fixture-project" });
  const fixture = await writeTextArtifactFixture(context);
  const runId = "10000000-0000-4000-8000-000000000077";
  const acceptedAt = "2026-08-26T04:00:00.000Z";
  await writeEntryActionStarted(context, runId, {
    version: 3,
    runId,
    actionId: "fixture-rename",
    phase: "proposal_ready",
    outcome: null,
    startedAt: acceptedAt,
    phaseStartedAt: acceptedAt,
    phaseHistory: [{ phase: "queued", startedAt: acceptedAt }, { phase: "proposal_ready", startedAt: acceptedAt }],
  });

  const result = await submitFreshEntryActionProposal({
    projectContext: context,
    project: { id: "fixture-project", name: "Fixture" },
    request: fixture.request,
    result: fixture.result,
    dependencies: { runId },
  });

  assert.equal(result.runId, runId);
  assert.equal(JSON.parse(await readFile(fixture.sourcePath, "utf8")).items[0].name, "New");
  assert.equal((await readEntryActionResult(context, runId)).outcome, "completed_with_writeback");
  const activeState = await readEntryActionStarted(context, runId);
  assert.equal(JSON.parse(await readFile(entryActionHandoffPath(context, runId), "utf8")).createdAt, acceptedAt);
  assert.equal(activeState.startedAt, acceptedAt);
  assert.equal(activeState.phase, "committing");
});

test("fresh existing-row group detects an externally changed artifact without overwriting either target", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "data-editor-entry-action-group-conflict-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const context = createProjectContext({ projectRoot: root, projectId: "fixture-project" });
  const fixture = await writeTextArtifactFixture(context);
  const external = "# External edit\n";
  const coordinator = {
    async withIdentities(identities, operation) {
      await writeFile(fixture.artifactPath, external, "utf8");
      return operation(identities);
    },
  };
  await assert.rejects(() => submitFreshEntryActionProposal({
    projectContext: context,
    project: { id: "fixture-project", name: "Fixture" },
    request: fixture.request,
    result: fixture.result,
    documentCommitCoordinator: coordinator,
  }), { code: "ENTRY_ACTION_GROUP_CONFLICTED" });
  assert.equal(JSON.parse(await readFile(fixture.sourcePath, "utf8")).items[0].name, "Old");
  assert.equal(await readFile(fixture.artifactPath, "utf8"), external);
});

test("fresh proposal admission publishes a terminal failure when required evidence is invalid", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "data-editor-entry-action-admission-failure-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const context = createProjectContext({ projectRoot: root, projectId: "fixture-project" });
  const fixture = await writeTextArtifactFixture(context);
  const runId = "10000000-0000-4000-8000-000000000099";

  await assert.rejects(() => submitFreshEntryActionProposal({
    projectContext: context,
    project: { id: "fixture-project", name: "Fixture" },
    request: fixture.request,
    result: {
      proposal: { ...fixture.result.proposal, textArtifact: null },
      evidence: [],
    },
    dependencies: { runId },
  }), /text artifact is required/i);

  const terminal = await readEntryActionResult(context, runId);
  assert.equal(terminal.phase, "terminal");
  assert.equal(terminal.outcome, "failed");
  assert.match(terminal.message, /text artifact is required/i);
});

async function writeFixture(context) {
  await mkdir(path.join(context.projectRoot, "data"), { recursive: true });
  await mkdir(path.dirname(context.automationProfilePath), { recursive: true });
  await mkdir(path.dirname(context.localAutomationBindingsPath), { recursive: true });
  await writeFile(path.join(context.projectRoot, "data", "items.json"), `${JSON.stringify({
    items: [{ __entry_id: "01JTESTENTRY00000000000001", name: "Old" }],
  }, null, 2)}\n`);
  await writeFile(context.automationProfilePath, `${JSON.stringify({
    rules: [{
      id: "fixture-rename",
      enabled: true,
      label: "Fixture rename",
      icon: "edit",
      targets: [{ file: "data/items.json", collection: "items" }],
      payload: { includeRow: true, includeNeighbors: false },
      execution: { kind: "proposal", resultPolicy: "proposal" },
      contractId: "fixture.rename.v1",
    }],
  }, null, 2)}\n`);
  const contract = fixtureContract();
  await writeFile(path.join(context.projectRoot, ".data-editor", "entry-action-contracts.json"), `${JSON.stringify({ version: 1, contracts: [contract] }, null, 2)}\n`);
  await writeFile(context.localAutomationBindingsPath, `${JSON.stringify({
    defaults: { model: "fixture-model", reasoning: "low", verbosity: "low", timeoutMs: 5_000 },
    bindings: { "fixture-rename": { provider: "codex", skill: "fixture-skill", enabled: true } },
  }, null, 2)}\n`);
  await writeFile(context.entryActionPolicyPath, `${JSON.stringify({
    version: 4,
    targets: [{
      actionId: "fixture-rename",
      file: "data/items.json",
      collection: "items",
    }],
    textArtifacts: [],
  }, null, 2)}\n`);
  await mkdir(path.join(context.projectRoot, "fixture-skill"), { recursive: true });
  await writeFile(path.join(context.projectRoot, "fixture-skill", "SKILL.md"), "# Fixture\n");
}

async function writeTextArtifactFixture(context) {
  const sourcePath = path.join(context.projectRoot, "data", "items.json");
  const artifactPath = path.join(context.projectRoot, "docs", "alpha.md");
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await mkdir(path.dirname(context.automationProfilePath), { recursive: true });
  const row = { __entry_id: "01JTESTENTRY00000000000001", slug: "alpha", name: "Old" };
  await writeFile(sourcePath, `${JSON.stringify({ items: [row] }, null, 2)}\n`);
  const beforeArtifact = "# Old design\n";
  await writeFile(artifactPath, beforeArtifact);
  await writeFile(context.automationProfilePath, `${JSON.stringify({ rules: [{
    id: "fixture-rename", enabled: true, label: "Fixture rename", icon: "edit",
    targets: [{ file: "data/items.json", collection: "items", textArtifact: {} }],
    payload: { includeRow: true, includeNeighbors: false }, execution: { kind: "proposal", resultPolicy: "proposal" }, contractId: "fixture.rename.v1",
  }] }, null, 2)}\n`);
  const unsigned = { contractId: "fixture.rename.v1", version: 1, predicate: { all: [] }, writableFields: ["name"], legalTransitions: [], textArtifactPolicy: { required: true, maxBytes: 4096, createOnly: false, allowedExtensions: [".md"] }, evidencePolicy: { required: true, minItems: 1, maxItems: 1, allowedKinds: ["test-evidence"] }, resultPolicy: "proposal", createAuthority: null };
  const contract = { ...unsigned, digest: crypto.createHash("sha256").update(canonical(unsigned), "utf8").digest("hex") };
  await writeFile(path.join(context.projectRoot, ".data-editor", "entry-action-contracts.json"), `${JSON.stringify({ version: 1, contracts: [contract] }, null, 2)}\n`);
  await writeFile(path.join(context.projectRoot, context.sharedViewConfigPath), `${JSON.stringify({ primaryKeys: { "data/items.json:items": "slug" }, documentFiles: { "data/items.json": { docRoot: "docs" } } }, null, 2)}\n`);
  return {
    sourcePath,
    artifactPath,
    request: { actionId: "fixture-rename", sourcePath: "data/items.json", collectionPath: "items", rowId: row.__entry_id, expectedRowDigest: rowDigest(row) },
    result: { proposal: { changes: [{ field: "name", beforeExists: true, before: "Old", afterExists: true, after: "New" }], textArtifact: { id: "fixture-artifact", path: "docs/alpha.md", beforeExists: true, beforeDigest: crypto.createHash("sha256").update(beforeArtifact, "utf8").digest("hex"), afterContent: "# New design\n", afterDigest: "0".repeat(64) }, summary: "Update row and design document." }, evidence: [] },
  };
}

function fixtureContract() {
  const value = { contractId: "fixture.rename.v1", version: 1, predicate: { all: [] }, writableFields: ["name"], legalTransitions: [], textArtifactPolicy: {}, evidencePolicy: { required: true, minItems: 1, maxItems: 1, allowedKinds: ["test-evidence"] }, resultPolicy: "proposal", createAuthority: null };
  return { ...value, digest: crypto.createHash("sha256").update(canonical(value), "utf8").digest("hex") };
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    result[String(argv[index]).replace(/^--/, "")] = argv[index + 1];
  }
  return result;
}

function fixtureRowDigest() {
  return rowDigest({ __entry_id: "01JTESTENTRY00000000000001", name: "Old" });
}


for (const sameRun of [false, true]) {
  test(`fresh blocked proposal preserves status through ${sameRun ? "same" : "new"} run and service recovery publication`, async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "proposal-status-recovery-")); t.after(() => rm(root, { recursive: true, force: true }));
    const context = createProjectContext({ projectRoot: root, projectId: "fixture-project" }); const fixture = await writeTextArtifactFixture(context);
    const runId = "10000000-0000-4000-8000-000000000088";
    if (sameRun) await writeEntryActionStarted(context, runId, { runId, actionId: fixture.request.actionId, phase: "proposal_ready", outcome: null, startedAt: "2026-10-14T00:00:00Z" });
    const admitted = await submitFreshEntryActionProposal({ projectContext: context, project: { id: "fixture-project" }, request: fixture.request, result: { ...fixture.result, resultStatus: "blocked" }, dependencies: sameRun ? { runId } : {} });
    assert.equal(admitted.resultStatus, "blocked"); assert.equal((await readEntryActionResult(context, admitted.runId)).resultStatus, "blocked");
    const persisted = JSON.parse(await readFile(entryActionProposalPath(context, admitted.runId), "utf8")); assert.equal(persisted.resultStatus, "blocked");
    const groupDirectory = path.join(root, context.runtimeDir, "entry-action-group-journal");
    const groupFile = path.join(groupDirectory, (await readdir(groupDirectory))[0]); const group = JSON.parse(await readFile(groupFile, "utf8"));
    assert.equal(group.resultStatus, "blocked"); assert.equal(group.source.childEntry.resultStatus, "blocked");
    // Isolated crash image: source/artifact committed, result publication absent.
    group.stage = "verified"; await writeFile(groupFile, JSON.stringify(group)); await rm(entryActionResultPath(context, admitted.runId));
    await recoverProposalOnlyEntryActionGroup({ projectContext: context, runId: admitted.runId, recoveryLease: group.ownership });
    assert.equal((await readEntryActionResult(context, admitted.runId)).resultStatus, "blocked");
    assert.equal((await readEntryActionResult(context, admitted.runId)).outcome, "completed_with_writeback");
    assert.equal(JSON.parse(await readFile(fixture.sourcePath, "utf8")).items[0].name, "New");
  });
}

test("fresh write admission rejects failed/no_changes/unknown status with zero write", async (t) => {
  for (const resultStatus of ["failed", "no_changes", "invented"]) {
    const root = await mkdtemp(path.join(os.tmpdir(), "proposal-status-reject-")); t.after(() => rm(root, { recursive: true, force: true }));
    const context = createProjectContext({ projectRoot: root, projectId: "fixture-project" }); const fixture = await writeTextArtifactFixture(context);
    const before = await readFile(fixture.sourcePath, "utf8"), artifactBefore = await readFile(fixture.artifactPath, "utf8");
    await assert.rejects(submitFreshEntryActionProposal({ projectContext: context, project: { id: "fixture-project" }, request: fixture.request, result: { ...fixture.result, proposal: { ...fixture.result.proposal, resultStatus } } }), { code: "ENTRY_ACTION_PROPOSAL_INVALID" });
    assert.equal(await readFile(fixture.sourcePath, "utf8"), before); assert.equal(await readFile(fixture.artifactPath, "utf8"), artifactBefore);
  }
});


test("same-run fresh blocked write remains newer than a prior failed run and preserves accepted provenance", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "latest-blocked-admission-")); t.after(() => rm(root, { recursive: true, force: true }));
  const context = createProjectContext({ projectRoot: root, projectId: "fixture-project" }); const fixture = await writeTextArtifactFixture(context);
  const failedId = "10000000-0000-4000-8000-000000000071", runId = "10000000-0000-4000-8000-000000000078";
  const action = { id: fixture.request.actionId, label: "Design", binding: { skill: "fixture" } };
  const entry = { sourcePath: fixture.request.sourcePath, collectionPath: fixture.request.collectionPath, rowId: fixture.request.rowId, row: { name: "Old" } };
  await writeEntryActionHandoff(context, failedId, { version: 1, runId: failedId, createdAt: "2026-10-14T02:45:44.586Z", action, entry });
  await publishEntryActionResultIdempotently(context, failedId, { runId: failedId, actionId: action.id, phase: "terminal", outcome: "failed", message: "ENOENT" });
  const acceptedAt = "2026-10-14T02:46:00.000Z";
  const skillArtifact = { logicalName: "fixture", sha256: "a".repeat(64) }, project = { id: "fixture-project", name: "Fixture", root };
  await writeEntryActionHandoff(context, runId, { version: 1, runId, createdAt: acceptedAt, action, entry, project, skillArtifact, proposalContract: { baseDocumentEtag: "stale" }, authority: { ruleDigest: "stale" } });
  await writeEntryActionStarted(context, runId, { runId, actionId: action.id, phase: "proposal_ready", outcome: null, startedAt: acceptedAt, phaseHistory: [{ phase: "queued", startedAt: acceptedAt }] });
  await submitFreshEntryActionProposal({ projectContext: context, project, request: fixture.request, result: { ...fixture.result, resultStatus: "blocked" }, dependencies: { runId } });
  const latest = await findLatestEntryActionRun(context, fixture.request);
  assert.equal(latest.runId, runId); assert.equal(latest.outcome, "completed_with_writeback"); assert.equal(latest.resultStatus, "blocked"); assert.equal(latest.createdAt, acceptedAt);
  const handoff = JSON.parse(await readFile(entryActionHandoffPath(context, runId), "utf8"));
  assert.equal(handoff.version, 1); assert.equal(handoff.createdAt, acceptedAt); assert.deepEqual(handoff.skillArtifact, skillArtifact); assert.deepEqual(handoff.project, project);
  assert.equal(handoff.action.label, "Design"); assert.notEqual(handoff.authority.ruleDigest, "stale"); assert.notEqual(handoff.proposalContract.baseDocumentEtag, "stale");
  assert.equal((await readEntryActionStarted(context, runId)).startedAt, acceptedAt);
});

test("fresh new-run handoff and lifecycle share one nonempty accepted clock", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "new-fresh-clock-")); t.after(() => rm(root, { recursive: true, force: true }));
  const context = createProjectContext({ projectRoot: root, projectId: "fixture-project" }); const fixture = await writeTextArtifactFixture(context);
  const admitted = await submitFreshEntryActionProposal({ projectContext: context, project: { id: "fixture-project" }, request: fixture.request, result: fixture.result });
  const handoff = JSON.parse(await readFile(entryActionHandoffPath(context, admitted.runId), "utf8"));
  assert.ok(handoff.createdAt); assert.equal(handoff.createdAt, (await readEntryActionStarted(context, admitted.runId)).startedAt);
  assert.equal((await findLatestEntryActionRun(context, fixture.request)).runId, admitted.runId);
});


for (const mismatch of ["runId", "actionId"]) {
  test(`fresh same-run admission rejects mismatched accepted ${mismatch} before lease or writes`, async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "accepted-state-mismatch-")); t.after(() => rm(root, { recursive: true, force: true }));
    const context = createProjectContext({ projectRoot: root, projectId: "fixture-project" }); const fixture = await writeTextArtifactFixture(context);
    const runId = "10000000-0000-4000-8000-000000000088", createdAt = "2026-10-14T02:46:00.000Z";
    const handoff = { runId, createdAt, action: { id: fixture.request.actionId }, entry: { sourcePath: fixture.request.sourcePath, collectionPath: fixture.request.collectionPath, rowId: fixture.request.rowId } };
    await writeEntryActionHandoff(context, runId, handoff);
    await writeEntryActionStarted(context, runId, { runId, actionId: fixture.request.actionId, [mismatch]: mismatch === "runId" ? "10000000-0000-4000-8000-000000000099" : "another-action", phase: "proposal_ready", outcome: null, startedAt: createdAt });
    const sourceBefore = await readFile(fixture.sourcePath), artifactBefore = await readFile(fixture.artifactPath), handoffBefore = await readFile(entryActionHandoffPath(context, runId));
    const stateBefore = await readEntryActionStarted(context, runId);
    await assert.rejects(submitFreshEntryActionProposal({ projectContext: context, project: { id: "fixture-project" }, request: fixture.request, result: { ...fixture.result, resultStatus: "blocked" }, dependencies: { runId, createFencingAllocator: () => assert.fail("identity mismatch must precede lease allocation") } }), { code: "ENTRY_ACTION_STARTED_IDENTITY_INVALID" });
    assert.deepEqual(await readFile(fixture.sourcePath), sourceBefore); assert.deepEqual(await readFile(fixture.artifactPath), artifactBefore);
    assert.deepEqual(await readFile(entryActionHandoffPath(context, runId)), handoffBefore); assert.deepEqual(await readEntryActionStarted(context, runId), stateBefore);
    await assert.rejects(readFile(entryActionResultPath(context, runId)), { code: "ENOENT" });
  });
}
