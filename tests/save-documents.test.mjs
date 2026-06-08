import assert from "node:assert/strict";
import test from "node:test";
import { saveDocumentsWith } from "../src/api/save-documents.mjs";

test("saveDocumentsWith saves all documents in order", async () => {
  const calls = [];
  const result = await saveDocumentsWith([
    { path: "data/a.json", root: { a: 1 } },
    { path: "data/b.json", root: { b: 2 } },
  ], async (path, root) => {
    calls.push({ path, root });
    return { ok: true };
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.savedPaths, ["data/a.json", "data/b.json"]);
  assert.equal(result.failedPath, null);
  assert.equal(result.errorMessage, null);
  assert.deepEqual(calls.map((item) => item.path), ["data/a.json", "data/b.json"]);
});

test("saveDocumentsWith stops on first failure and returns partial success", async () => {
  const calls = [];
  const result = await saveDocumentsWith([
    { path: "data/a.json", root: { a: 1 } },
    { path: "data/b.json", root: { b: 2 } },
    { path: "data/c.json", root: { c: 3 } },
  ], async (path) => {
    calls.push(path);
    if (path === "data/b.json") throw new Error("disk full");
    return { ok: true };
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.savedPaths, ["data/a.json"]);
  assert.equal(result.failedPath, "data/b.json");
  assert.equal(result.errorMessage, "disk full");
  assert.deepEqual(calls, ["data/a.json", "data/b.json"]);
});
