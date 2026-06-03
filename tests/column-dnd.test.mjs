import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPreviewOrderFromSlots,
  buildPreviewOrderFromTarget,
  resolveDropTarget,
  shouldStartColumnDrag,
} from "../src/table/column-dnd.mjs";

test("should start drag only after threshold is exceeded", () => {
  assert.equal(shouldStartColumnDrag(4, 0), false);
  assert.equal(shouldStartColumnDrag(5, 0), true);
  assert.equal(shouldStartColumnDrag(0, 5), true);
});

test("resolves before and after targets from slot geometry", () => {
  const slots = [
    { fieldName: "first", index: 0, left: 0, right: 100, center: 50 },
    { fieldName: "second", index: 1, left: 100, right: 200, center: 150 },
    { fieldName: "third", index: 2, left: 200, right: 300, center: 250 },
  ];

  assert.deepEqual(resolveDropTarget(slots, 25), { targetField: "first", placement: "before" });
  assert.deepEqual(resolveDropTarget(slots, 175), { targetField: "third", placement: "before" });
  assert.deepEqual(resolveDropTarget(slots, 325), { targetField: "third", placement: "after" });
});

test("builds preview order from a drop target", () => {
  const order = ["first", "second", "third", "fourth"];
  assert.deepEqual(buildPreviewOrderFromTarget(order, "second", "fourth", "before"), ["first", "third", "second", "fourth"]);
  assert.deepEqual(buildPreviewOrderFromTarget(order, "second", "first", "after"), ["first", "second", "third", "fourth"]);
});

test("builds preview order from slot geometry", () => {
  const slots = [
    { fieldName: "first", index: 0, left: 0, right: 100, center: 50 },
    { fieldName: "third", index: 2, left: 200, right: 300, center: 250 },
    { fieldName: "fourth", index: 3, left: 300, right: 400, center: 350 },
  ];

  assert.deepEqual(
    buildPreviewOrderFromSlots(["first", "second", "third", "fourth"], "second", slots, 220),
    ["first", "second", "third", "fourth"],
  );
  assert.deepEqual(
    buildPreviewOrderFromSlots(["first", "second", "third", "fourth"], "second", slots, 40),
    ["second", "first", "third", "fourth"],
  );
});
