import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createDocumentCommitCoordinator } from "../src/document-commit-coordinator.mjs";
import { startProposalOnlyEntryAction } from "../src/entry-action-service.mjs";
import {
  entryActionHandoffPath,
  readEntryActionResult,
} from "../src/entry-actions.mjs";
import { createProjectContext } from "../src/project-context.mjs";
import { rowDigest } from "../src/row-digest.mjs";

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
  assert.deepEqual(await readEntryActionResult(context, started.runId), {
    version: 2,
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
      execution: { kind: "project-skill" },
    }],
  }, null, 2)}\n`);
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
