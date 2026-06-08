import test from "node:test";
import assert from "node:assert/strict";
import {
  ONE_DIMENSIONAL_DRAG_THRESHOLD,
  ONE_DIMENSIONAL_BACKWARD_TRIGGER_RATIO,
  ONE_DIMENSIONAL_FORWARD_TRIGGER_RATIO,
  arrayMove,
  createOneDimensionalDragSession,
  createVerticalProjection,
  mergeProjectedSubsetOrder,
  projectVerticalDrag,
  shouldStartOneDimensionalDrag,
} from "../src/drag/one-dimensional-dnd.mjs";
import { projectSidebarFileOrder } from "../src/drag/sidebar-file-dnd.mjs";
import { reorderSortRulesById } from "../src/components/sort/reorder-sort-rules.mjs";

test("drag gesture starts only after the shared pointer threshold is exceeded", () => {
  assert.equal(ONE_DIMENSIONAL_DRAG_THRESHOLD, 4);
  assert.equal(shouldStartOneDimensionalDrag({ startX: 10, startY: 10, currentX: 14, currentY: 10 }), false);
  assert.equal(shouldStartOneDimensionalDrag({ startX: 10, startY: 10, currentX: 15, currentY: 10 }), true);
});

test("arrayMove moves an item to the requested index without mutating the source order", () => {
  const baseOrder = ["alpha", "beta", "gamma", "delta"];
  const nextOrder = arrayMove(baseOrder, "gamma", 1);

  assert.deepEqual(nextOrder, ["alpha", "gamma", "beta", "delta"]);
  assert.deepEqual(baseOrder, ["alpha", "beta", "gamma", "delta"]);
});

test("createVerticalProjection derives drop index and projected order from item geometry", () => {
  const projection = createVerticalProjection({
    axis: "vertical",
    itemSize: 40,
    items: [
      { id: "alpha", start: 0, size: 40 },
      { id: "beta", start: 40, size: 40 },
      { id: "gamma", start: 80, size: 40 },
      { id: "delta", start: 120, size: 40 },
    ],
  });

  const result = projectVerticalDrag({
    projection,
    order: ["alpha", "beta", "gamma", "delta"],
    activeId: "gamma",
    pointer: 10,
  });

  assert.equal(result.dropIndex, 0);
  assert.deepEqual(result.projectedOrder, ["gamma", "alpha", "beta", "delta"]);
  assert.equal(result.direction, "backward");
});

test("projection uses asymmetric trigger ratios for upward and downward moves", () => {
  const projection = createVerticalProjection({
    axis: "vertical",
    itemSize: 40,
    forwardTriggerRatio: ONE_DIMENSIONAL_FORWARD_TRIGGER_RATIO,
    backwardTriggerRatio: ONE_DIMENSIONAL_BACKWARD_TRIGGER_RATIO,
    items: [
      { id: "alpha", start: 0, size: 40 },
      { id: "beta", start: 40, size: 40 },
      { id: "gamma", start: 80, size: 40 },
    ],
  });

  const upward = projectVerticalDrag({
    projection,
    order: ["alpha", "beta", "gamma"],
    activeId: "beta",
    pointer: 25,
  });
  const downward = projectVerticalDrag({
    projection,
    order: ["alpha", "beta", "gamma"],
    activeId: "beta",
    pointer: 85,
  });

  assert.deepEqual(upward.projectedOrder, ["beta", "alpha", "gamma"]);
  assert.deepEqual(downward.projectedOrder, ["alpha", "beta", "gamma"]);
});

test("projection falls back to the active item start when pointer is missing", () => {
  const projection = createVerticalProjection({
    axis: "vertical",
    itemSize: 36,
    items: [
      { id: "alpha", start: 0, size: 36 },
      { id: "beta", start: 36, size: 36 },
      { id: "gamma", start: 72, size: 36 },
    ],
  });

  const result = projectVerticalDrag({
    projection,
    order: ["alpha", "beta", "gamma"],
    activeId: "beta",
    pointer: null,
  });

  assert.equal(result.dropIndex, 1);
  assert.deepEqual(result.projectedOrder, ["alpha", "beta", "gamma"]);
  assert.equal(result.direction, null);
});

test("projection merges visible subset order back into the full committed order", () => {
  const result = mergeProjectedSubsetOrder({
    fullOrder: ["alpha", "beta", "gamma", "delta", "epsilon"],
    subsetOrder: ["beta", "delta"],
    projectedSubsetOrder: ["delta", "beta"],
  });

  assert.deepEqual(result, ["alpha", "delta", "beta", "gamma", "epsilon"]);
});

test("drag session commits only after release and exposes the latest preview order", () => {
  const calls = [];
  const session = createOneDimensionalDragSession({
    pointerId: 1,
    startX: 10,
    startY: 10,
    onStart: () => calls.push("start"),
    onPreview: () => ["beta", "alpha"],
    onCommit: (order) => calls.push(`commit:${order.join(",")}`),
    onCancel: () => calls.push("cancel"),
  });

  assert.deepEqual(session.move({ clientX: 12, clientY: 12 }), { started: false, previewOrder: null });
  assert.deepEqual(session.move({ clientX: 20, clientY: 20 }), { started: true, previewOrder: ["beta", "alpha"] });
  assert.deepEqual(calls, ["start"]);
  assert.deepEqual(session.release(), ["beta", "alpha"]);
  assert.deepEqual(calls, ["start", "commit:beta,alpha"]);
});

test("drag session cancel clears preview without committing", () => {
  const calls = [];
  const session = createOneDimensionalDragSession({
    pointerId: 1,
    startX: 0,
    startY: 0,
    onPreview: () => ["beta", "alpha"],
    onCommit: () => calls.push("commit"),
    onCancel: () => calls.push("cancel"),
  });

  session.move({ clientX: 10, clientY: 10 });
  session.cancel();

  assert.deepEqual(calls, ["cancel"]);
});

test("sidebar file projection derives preview order without mutating the provided source order", () => {
  const baseOrder = ["alpha", "beta", "gamma", "delta"];

  const previewOrder = projectSidebarFileOrder({
    fullOrder: baseOrder,
    renderedOrder: ["alpha", "beta", "gamma", "delta"],
    activePath: "gamma",
    pointerY: 10,
    items: [
      { id: "alpha", start: 0, size: 40 },
      { id: "beta", start: 40, size: 40 },
      { id: "gamma", start: 80, size: 40 },
      { id: "delta", start: 120, size: 40 },
    ],
  });

  assert.deepEqual(previewOrder, ["gamma", "alpha", "beta", "delta"]);
  assert.deepEqual(baseOrder, ["alpha", "beta", "gamma", "delta"]);
});

test("reorderSortRulesById rebuilds sort rules from ordered ids without dropping metadata", () => {
  const sorts = [
    { id: "sort:name", field: "name", direction: "asc" },
    { id: "sort:id", field: "id", direction: "desc" },
    { id: "sort:rarity", field: "rarity", direction: "asc" },
  ];

  const reordered = reorderSortRulesById(sorts, ["sort:id", "sort:name", "sort:rarity"]);

  assert.deepEqual(reordered, [
    { id: "sort:id", field: "id", direction: "desc" },
    { id: "sort:name", field: "name", direction: "asc" },
    { id: "sort:rarity", field: "rarity", direction: "asc" },
  ]);
  assert.equal(reordered[0], sorts[1]);
  assert.equal(reordered[1], sorts[0]);
});
