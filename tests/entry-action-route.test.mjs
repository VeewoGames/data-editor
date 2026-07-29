import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
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

  const response = await route({ projectId: "project-a", actionId: "fixture-action" });
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
    () => route({ projectId: "project-b", actionId: "fixture-action" }),
    { code: "ENTRY_ACTION_PROJECT_NOT_ACTIVE", status: 409 },
  );
  assert.equal(started, false);
});
