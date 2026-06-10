import assert from "node:assert/strict";
import test from "node:test";
import {
  buildColumnPreviewOffsetMap,
  buildColumnPreviewOrderState,
  buildPreviewOrderFromTarget,
  projectHeaderFieldsByPreviewOrder,
} from "../src/table/column-dnd.mjs";

test("buildColumnPreviewOffsetMap projects preview positions into horizontal offsets", () => {
  const widths = { id: 120, status: 180, title: 240, tags: 160 };
  const getWidth = (fieldName) => widths[fieldName] ?? 180;
  const baseOrder = ["id", "status", "title", "tags"];
  const previewOrder = buildPreviewOrderFromTarget(baseOrder, "title", "id", "before");

  assert.deepEqual(previewOrder, ["title", "id", "status", "tags"]);
  assert.deepEqual(buildColumnPreviewOffsetMap(baseOrder, previewOrder, getWidth), {
    id: 240,
    status: 240,
    title: -300,
    tags: 0,
  });
});

test("buildColumnPreviewOrderState keeps base and preview orders separate", () => {
  const state = buildColumnPreviewOrderState(["id", "status"], ["status", "id"]);
  assert.deepEqual(state.baseOrder, ["id", "status"]);
  assert.deepEqual(state.previewOrder, ["status", "id"]);
});

test("projectHeaderFieldsByPreviewOrder falls back to base order when preview order is empty", () => {
  assert.deepEqual(
    projectHeaderFieldsByPreviewOrder(["id", "status", "title"], []),
    ["id", "status", "title"],
  );
});

test("projectHeaderFieldsByPreviewOrder appends base-only fields in original order", () => {
  assert.deepEqual(
    projectHeaderFieldsByPreviewOrder(["id", "status", "title"], ["title", "id"]),
    ["title", "id", "status"],
  );
});
