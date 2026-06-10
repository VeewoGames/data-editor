import test from "node:test";
import assert from "node:assert/strict";
import {
  applySidebarTreePreferences,
  buildSidebarTree,
  buildSidebarTreePreferences,
  findSidebarFallbackFilePath,
  findSidebarNodeAncestorIds,
  reorderSidebarSiblingIds,
} from "../src/sidebar-tree.mjs";

const files = [
  {
    path: "data/items/potion.json",
    displayPath: "items/potion.json",
    dataSourceId: "data",
    dataSourceLabel: "Data",
  },
  {
    path: "data/items/elixir.json",
    displayPath: "items/elixir.json",
    dataSourceId: "data",
    dataSourceLabel: "Data",
  },
  {
    path: "data/actors/player.json",
    displayPath: "actors/player.json",
    dataSourceId: "data",
    dataSourceLabel: "Data",
  },
  {
    path: "extra/loot/rare.json",
    displayPath: "loot/rare.json",
    dataSourceId: "extra",
    dataSourceLabel: "Extra",
  },
];

test("buildSidebarTree creates source-folder-file hierarchy with sorted default sibling order", () => {
  const tree = buildSidebarTree(files);
  assert.equal(tree.length, 2);
  assert.equal(tree[0].id, "source:data");
  assert.equal(tree[0].children[0].id, "folder:data/actors");
  assert.equal(tree[0].children[1].id, "folder:data/items");
  assert.equal(tree[0].children[1].children[0].id, "file:data/items/elixir.json");
  assert.equal(tree[0].children[1].children[1].id, "file:data/items/potion.json");
});

test("buildSidebarTree keeps a source root node even when only one source exists", () => {
  const tree = buildSidebarTree([
    {
      path: "data/items/potion.json",
      displayPath: "items/potion.json",
      dataSourceId: "data",
      dataSourceLabel: "Data",
    },
  ]);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].id, "source:data");
});

test("applySidebarTreePreferences reorders only siblings under the same parent", () => {
  const tree = buildSidebarTree(files);
  const nextTree = applySidebarTreePreferences(tree, {
    childOrderByParent: {
      "source:data": ["folder:data/items", "folder:data/actors"],
      "folder:data/items": ["file:data/items/potion.json", "file:data/items/elixir.json"],
    },
    expandedNodeIds: [],
  });
  assert.equal(nextTree[0].children[0].id, "folder:data/items");
  assert.equal(nextTree[0].children[0].children[0].id, "file:data/items/potion.json");
});

test("reorderSidebarSiblingIds reorders only within the provided sibling set", () => {
  assert.deepEqual(
    reorderSidebarSiblingIds(
      ["folder:data/actors", "folder:data/items", "file:data/root.json"],
      "file:data/root.json",
      "folder:data/actors",
      "before",
    ),
    ["file:data/root.json", "folder:data/actors", "folder:data/items"],
  );
});

test("findSidebarNodeAncestorIds returns source and folder chain for a file path", () => {
  const tree = buildSidebarTree(files);
  assert.deepEqual(findSidebarNodeAncestorIds(tree, "data/items/potion.json"), ["source:data", "folder:data/items"]);
});

test("findSidebarFallbackFilePath keeps current path when it still exists", () => {
  const tree = applySidebarTreePreferences(buildSidebarTree(files), buildSidebarTreePreferences());
  assert.equal(findSidebarFallbackFilePath(tree, "data/items/elixir.json"), "data/items/elixir.json");
});

test("findSidebarFallbackFilePath falls back to first visible file in tree order", () => {
  const tree = applySidebarTreePreferences(buildSidebarTree(files), {
    childOrderByParent: {
      "source:data": ["folder:data/items", "folder:data/actors"],
      "folder:data/items": ["file:data/items/potion.json", "file:data/items/elixir.json"],
    },
    expandedNodeIds: [],
  });
  assert.equal(findSidebarFallbackFilePath(tree, "data/missing.json"), "data/items/potion.json");
});
