import assert from "node:assert/strict";
import test from "node:test";
import { createCandidateCreateAdmission } from "../src/entry-action-create-admission.mjs";

test("project-skill and exact-artifact composition share the registry allocator", async () => {
  const allocateServerFields = async () => ({ id: 1 });
  const observed = [];
  const submit = createCandidateCreateAdmission({
    adapterRegistry: { allocateServerFields },
    submit: async (input) => { observed.push(input); return input.request.entry; },
  });
  assert.equal(await submit({ request: { entry: "project-skill" } }), "project-skill");
  assert.equal(await submit({ request: { entry: "exact-artifact" }, dependencies: { runId: "run" } }), "exact-artifact");
  assert.equal(observed[0].dependencies.allocateServerFields, allocateServerFields);
  assert.equal(observed[1].dependencies.allocateServerFields, allocateServerFields);
  assert.equal(observed[1].dependencies.runId, "run");
});
