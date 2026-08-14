import assert from "node:assert/strict";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createDocumentCommitCoordinator } from "../src/document-commit-coordinator.mjs";
import { bindProposalToHandoff, startProposalOnlyEntryAction, submitFreshEntryActionProposal } from "../src/entry-action-service.mjs";
import {
  entryActionHandoffPath,
  readEntryActionResult,
} from "../src/entry-actions.mjs";
import { createProjectContext } from "../src/project-context.mjs";
import { rowDigest } from "../src/row-digest.mjs";

test("service recalculates the model-supplied Markdown digest from its content", () => {
  const handoff = {
    runId: "10000000-0000-4000-8000-000000000001",
    action: { id: "fixture-rename" },
    entry: { sourcePath: "data/items.json", canonicalFileKey: "a".repeat(64), collectionPath: "items", rowId: "entry" },
    proposalContract: { version: 3, baseDocumentEtag: "\"etag\"", ruleDigest: "b".repeat(64), fencingToken: 1 },
  };
  const proposal = bindProposalToHandoff({
    textArtifact: { afterContent: "# Skill\n", afterDigest: "0".repeat(64) },
    evidence: [],
  }, handoff);
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
