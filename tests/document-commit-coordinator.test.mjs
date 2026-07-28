import assert from "node:assert/strict";
import test from "node:test";
import { createDocumentCommitCoordinator } from "../src/document-commit-coordinator.mjs";

test("same canonical document commits are serialized and the lane is released", async () => {
  const coordinator = createDocumentCommitCoordinator({ identify: async (_context, sourcePath) => ({ canonicalFileKey: sourcePath === "alias" ? "same" : sourcePath }) });
  const calls = [];
  let releaseFirst;
  const first = coordinator.withCommit({ projectContext: {}, sourcePath: "same" }, async () => { calls.push("first:start"); await new Promise((resolve) => { releaseFirst = resolve; }); calls.push("first:end"); });
  const second = coordinator.withCommit({ projectContext: {}, sourcePath: "alias" }, async () => { calls.push("second"); });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(calls, ["first:start"]);
  assert.equal(coordinator.activeCount, 1);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(calls, ["first:start", "first:end", "second"]);
  assert.equal(coordinator.activeCount, 0);
});

test("different documents proceed independently and a failure does not poison its lane", async () => {
  const coordinator = createDocumentCommitCoordinator({ identify: async (_context, sourcePath) => ({ canonicalFileKey: sourcePath }) });
  await assert.rejects(() => coordinator.withCommit({ projectContext: {}, sourcePath: "a" }, async () => { throw new Error("expected"); }), /expected/);
  await coordinator.withCommit({ projectContext: {}, sourcePath: "a" }, async () => {});
  await Promise.all([coordinator.withCommit({ projectContext: {}, sourcePath: "a" }, async () => {}), coordinator.withCommit({ projectContext: {}, sourcePath: "b" }, async () => {})]);
  assert.equal(coordinator.activeCount, 0);
});
