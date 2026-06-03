import test from "node:test";
import assert from "node:assert/strict";
import { parseCsv, serializeCsv } from "../src/csv-codec.mjs";
import { parseJson, serializeJson } from "../src/json-codec.mjs";

test("csv parser handles quoted commas and escaped quotes", () => {
  const rows = parseCsv('id,name,note\n1,"A, B","quote ""ok"""');
  assert.deepEqual(rows, [{ id: "1", name: "A, B", note: 'quote "ok"' }]);
});

test("csv serializer quotes unsafe fields", () => {
  const text = serializeCsv([{ id: "1", note: "A, B" }]);
  assert.equal(text, 'id,note\n1,"A, B"\n');
});

test("json parser preserves root array", () => {
  const doc = parseJson('[{"id":1}]');
  assert.equal(doc.rootKind, "array");
  assert.deepEqual(doc.data, [{ id: 1 }]);
});

test("json parser preserves root object", () => {
  const doc = parseJson('{"skills":[{"id":1}],"meta":{"version":1}}');
  assert.equal(doc.rootKind, "object");
  assert.equal(doc.data.meta.version, 1);
});

test("json serializer returns formatted json", () => {
  const text = serializeJson({ skills: [{ id: 1 }] });
  assert.match(text, /"skills"/);
  assert.ok(text.endsWith("\n"));
});
