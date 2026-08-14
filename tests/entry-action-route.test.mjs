import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createEntryActionRunRoute } from "../src/entry-action-route.mjs";
import { createPendingEntryActionStore } from "../src/pending-entry-action.mjs";

test("entry-action route starts only for the active project and exposes the handoff", async () => {
  const completion = Promise.resolve();
  let observed = null;
  const route = createEntryActionRunRoute({
    loadRegistry: async () => ({
      activeProjectId: "project-a",
      projects: [{ id: "project-a", name: "A", root: path.resolve("fixture-a"), adapter: "generic" }],
    }),
    toolRoot: path.resolve("."),
    jobSupervisor: {},
    documentCommitCoordinator: {},
    resolveExecution: async () => ({ kind: "proposal" }),
    startEntryAction: async (input) => {
      assert.equal(input.project.id, "project-a");
      assert.equal(input.request.actionId, "fixture-action");
      return { runId: "00000000-0000-4000-8000-000000000001", completion };
    },
    onCompletion(started) {
      observed = started;
    },
  });

  const response = await route.run({ projectId: "project-a", actionId: "fixture-action" });
  assert.equal(response.status, "started");
  assert.equal(response.runId, "00000000-0000-4000-8000-000000000001");
  assert.match(response.handoffPath, /00000000-0000-4000-8000-000000000001\.json$/);
  assert.equal(observed.completion, completion);
});

test("entry-action route rejects a non-active project before orchestration", async () => {
  let started = false;
  const route = createEntryActionRunRoute({
    loadRegistry: async () => ({
      activeProjectId: "project-a",
      projects: [{ id: "project-a", root: path.resolve("fixture-a") }, { id: "project-b", root: path.resolve("fixture-b") }],
    }),
    startEntryAction: async () => {
      started = true;
    },
    resolveExecution: async () => ({ kind: "proposal" }),
  });

  await assert.rejects(
    () => route.run({ projectId: "project-b", actionId: "fixture-action" }),
    { code: "ENTRY_ACTION_PROJECT_NOT_ACTIVE", status: 409 },
  );
  assert.equal(started, false);
});

test("identity promotion returns a durable-only pending token and starts only after acknowledgement", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "data-editor-pending-action-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "data"));
  await writeFile(path.join(root, "data", "items.json"), "{\"items\":[]}");
  let starts = 0;
  let capabilityReads = 0;
  const route = createEntryActionRunRoute({
    loadRegistry: async () => ({ activeProjectId: "project-a", projects: [{ id: "project-a", root, dataSources: [{ id: "data", kind: "relative", path: "data" }] }] }),
    toolRoot: path.resolve("."), jobSupervisor: {}, documentCommitCoordinator: {},
    resolveExecution: async () => ({ kind: "proposal" }),
    resolveCapabilityState: async () => ({
      status: "active",
      generation: 4,
      // Durable identity promotion can change the manifest digest itself.
      manifestDigest: ++capabilityReads === 1 ? "before-promotion" : "after-promotion",
    }),
    preflightEntryAction: async () => {},
    promoteIdentity: async () => ({ receipt: { durableId: "DURABLE-1", canonicalRowDigest: "digest", documentEtag: "\"etag\"" }, identityCreated: false, root: { items: [{ __entry_id: "DURABLE-1" }] }, format: "json", documentEtag: "\"etag\"" }),
    startEntryAction: async ({ request }) => { starts += 1; assert.equal(request.rowId, "DURABLE-1"); assert.equal(request.sourceRowIndex, null); return { runId: "00000000-0000-4000-8000-000000000002", completion: Promise.resolve() }; },
  });
  const pending = await route.run({ projectId: "project-a", actionId: "fixture-action", sourcePath: "data/items.json", collectionPath: "items", sourceRowIndex: 0, expectedRowDigest: "digest", idempotencyKey: "promotion_123" });
  assert.equal(pending.status, "promotion_pending");
  assert.equal(pending.identityCreated, false);
  assert.equal(starts, 0);
  const started = await route.ackStart({ projectId: "project-a", pendingActionToken: pending.pendingActionToken });
  assert.equal(started.runId, "00000000-0000-4000-8000-000000000002");
  assert.equal(starts, 1);
  assert.equal(capabilityReads, 3);
  const replay = await route.ackStart({ projectId: "project-a", pendingActionToken: pending.pendingActionToken });
  assert.equal(replay.replayed, true);
  assert.equal(starts, 1);
});

test("a new promotion cancels an expired pending lease for the same source", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "data-editor-expired-pending-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "data"));
  await writeFile(path.join(root, "data", "items.json"), "{\"items\":[]}");
  const project = { id: "project-a", root, dataSources: [{ id: "data", kind: "relative", path: "data" }] };
  const route = createEntryActionRunRoute({
    loadRegistry: async () => ({ activeProjectId: project.id, projects: [project] }),
    toolRoot: path.resolve("."), jobSupervisor: {}, documentCommitCoordinator: {},
    resolveExecution: async () => ({ kind: "proposal" }),
    resolveCapabilityState: async () => ({ status: "active", generation: 4, manifestDigest: "manifest" }),
    preflightEntryAction: async () => {},
    promoteIdentity: async () => ({ receipt: { durableId: "DURABLE-1", canonicalRowDigest: "digest", documentEtag: "\"etag\"" }, root: {}, format: "json", documentEtag: "\"etag\"" }),
  });
  const request = { projectId: project.id, actionId: "fixture-action", sourcePath: "data/items.json", collectionPath: "items", sourceRowIndex: 0, expectedRowDigest: "digest", idempotencyKey: "promotion_123" };
  const first = await route.run(request);
  const store = createPendingEntryActionStore({ projectContext: { projectRoot: root, runtimeDir: ".data-editor/runtime" } });
  const stale = await store.read(first.pendingActionToken);
  await store.write({ ...stale, expiresAt: "2000-01-01T00:00:00.000Z" });
  const second = await route.run({ ...request, idempotencyKey: "promotion_456" });
  assert.notEqual(second.pendingActionToken, first.pendingActionToken);
  assert.equal((await store.read(first.pendingActionToken)).state, "expired");
});

test("project-skill routes before identity promotion and returns result-only", async () => {
  let promoted = false;
  let started = false;
  const route = createEntryActionRunRoute({
    loadRegistry: async () => ({ activeProjectId: "project-a", projects: [{ id: "project-a", root: path.resolve("fixture-a") }] }),
    resolveExecution: async () => ({ kind: "project-skill", resultPolicy: "result-only" }),
    promoteIdentity: async () => { promoted = true; },
    startProjectSkill: async () => { started = true; return { runId: "00000000-0000-4000-8000-000000000003", completion: Promise.resolve() }; },
  });
  const result = await route.run({ projectId: "project-a", actionId: "fixture-action" });
  assert.equal(result.resultOnly, true);
  assert.equal(started, true);
  assert.equal(promoted, false);
});

test("project-skill proposal receives the server admission dispatcher", async () => {
  let admitted = false;
  const coordinator = {};
  const route = createEntryActionRunRoute({
    loadRegistry: async () => ({ activeProjectId: "project-a", projects: [{ id: "project-a", root: path.resolve("fixture-a") }] }),
    documentCommitCoordinator: coordinator,
    resolveExecution: async () => ({ kind: "project-skill", resultPolicy: "proposal" }),
    submitProjectSkillResult: async (input) => { admitted = true; assert.equal(input.documentCommitCoordinator, coordinator); return { runId: "fresh" }; },
    startProjectSkill: async ({ dependencies }) => {
      assert.equal(typeof dependencies.submitProposalResult, "function");
      await dependencies.submitProposalResult({ result: { kind: "entry-action-proposal" } });
      return { runId: "00000000-0000-4000-8000-000000000004", completion: Promise.resolve() };
    },
  });
  await route.run({ projectId: "project-a", actionId: "fixture-action" });
  assert.equal(admitted, true);
});

test("project-skill receives the configured generic artifact publication endpoint", async () => {
  const route = createEntryActionRunRoute({
    loadRegistry: async () => ({ activeProjectId: "project-a", projects: [{ id: "project-a", root: path.resolve("fixture-a") }] }),
    resolveExecution: async () => ({ kind: "project-skill", resultPolicy: "result-only" }),
    projectSkillArtifactPublicationUrl: "http://127.0.0.1:8787/api/entry-actions/publish-exact-artifact",
    startProjectSkill: async ({ dependencies }) => {
      assert.equal(dependencies.projectSkillArtifactPublicationUrl, "http://127.0.0.1:8787/api/entry-actions/publish-exact-artifact");
      return { runId: "00000000-0000-4000-8000-000000000005", completion: Promise.resolve() };
    },
  });
  await route.run({ projectId: "project-a", actionId: "fixture-action" });
});
