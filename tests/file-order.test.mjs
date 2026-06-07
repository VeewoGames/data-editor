import test from "node:test";
import assert from "node:assert/strict";
import { moveFileToIndex, normalizeFileOrder, resolvePreferredFilePath } from "../src/file-order.mjs";

const files = [
  { path: "data/a.json" },
  { path: "data/b.json" },
  { path: "data/c.json" },
];

test("normalizeFileOrder keeps valid unique saved paths then appends remaining files", () => {
  assert.deepEqual(normalizeFileOrder(files, [
    "data/c.json",
    "data/missing.json",
    "data/c.json",
    "data/a.json",
  ]), ["data/c.json", "data/a.json", "data/b.json"]);
});

test("normalizeFileOrder returns file order when saved order is empty", () => {
  assert.deepEqual(normalizeFileOrder(files, []), ["data/a.json", "data/b.json", "data/c.json"]);
});

test("moveFileToIndex moves a path to the requested index", () => {
  assert.deepEqual(moveFileToIndex(["data/a.json", "data/b.json", "data/c.json"], "data/c.json", 0), [
    "data/c.json",
    "data/a.json",
    "data/b.json",
  ]);
});

test("moveFileToIndex clamps target index after removing the source path", () => {
  assert.deepEqual(moveFileToIndex(["data/a.json", "data/b.json", "data/c.json"], "data/a.json", 99), [
    "data/b.json",
    "data/c.json",
    "data/a.json",
  ]);
});

test("moveFileToIndex ignores unknown source paths", () => {
  assert.deepEqual(moveFileToIndex(["data/a.json", "data/b.json"], "data/missing.json", 0), [
    "data/a.json",
    "data/b.json",
  ]);
});

test("resolvePreferredFilePath keeps a valid preferred path", () => {
  assert.equal(resolvePreferredFilePath(files, ["data/c.json"], "data/b.json"), "data/b.json");
});

test("resolvePreferredFilePath falls back to the first valid ordered path when preferred path is stale", () => {
  assert.equal(resolvePreferredFilePath(files, ["data/c.json", "data/a.json"], "data/missing.json"), "data/c.json");
});

test("resolvePreferredFilePath returns null when there are no files", () => {
  assert.equal(resolvePreferredFilePath([], ["data/a.json"], "data/missing.json"), null);
});
