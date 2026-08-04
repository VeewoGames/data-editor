import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createEntryActionRunRoute } from "../src/entry-action-route.mjs";

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
  const route = createEntryActionRunRoute({
    loadRegistry: async () => ({ activeProjectId: "project-a", projects: [{ id: "project-a", root, dataSources: [{ id: "data", kind: "relative", path: "data" }] }] }),
    toolRoot: path.resolve("."), jobSupervisor: {}, documentCommitCoordinator: {},
    resolveCapabilityState: async () => ({ status: "active", generation: 4, manifestDigest: "manifest" }),
    preflightEntryAction: async () => {},
    promoteIdentity: async () => ({ receipt: { durableId: "DURABLE-1", canonicalRowDigest: "digest", documentEtag: "\"etag\"" }, root: { items: [{ __entry_id: "DURABLE-1" }] }, format: "json", documentEtag: "\"etag\"" }),
    startEntryAction: async ({ request }) => { starts += 1; assert.equal(request.rowId, "DURABLE-1"); assert.equal(request.sourceRowIndex, null); return { runId: "00000000-0000-4000-8000-000000000002", completion: Promise.resolve() }; },
  });
  const pending = await route.run({ projectId: "project-a", actionId: "fixture-action", sourcePath: "data/items.json", collectionPath: "items", sourceRowIndex: 0, expectedRowDigest: "digest", idempotencyKey: "promotion_123" });
  assert.equal(pending.status, "promotion_pending");
  assert.equal(starts, 0);
  const started = await route.ackStart({ projectId: "project-a", pendingActionToken: pending.pendingActionToken });
  assert.equal(started.runId, "00000000-0000-4000-8000-000000000002");
  assert.equal(starts, 1);
  const replay = await route.ackStart({ projectId: "project-a", pendingActionToken: pending.pendingActionToken });
  assert.equal(replay.replayed, true);
  assert.equal(starts, 1);
});
