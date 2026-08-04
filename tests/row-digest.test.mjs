import assert from "node:assert/strict";
import test from "node:test";
import { rowDigest } from "../src/row-digest.mjs";

test("row digest is key-order stable and changes with target content", () => {
  assert.equal(rowDigest({ id: "a", value: 1 }), rowDigest({ value: 1, id: "a" }));
  assert.notEqual(rowDigest({ id: "a", value: 1 }), rowDigest({ id: "a", value: 2 }));
});
