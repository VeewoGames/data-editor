import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSharedViewIdMaps,
  rewriteProfileWithNeutralViewIds,
  rewriteSharedViewsWithNeutralIds,
} from "../src/shared-view-id-migration.mjs";

test("buildSharedViewIdMaps rewrites semantic shared view ids to neutral per-collection ids", () => {
  const collectionIdMaps = buildSharedViewIdMaps({
    collections: {
      "data/skills.json:skills": {
        defaultViewId: "tag-melee-copy-copy-2",
        items: [
          { kind: "view", view: { id: "all", name: "全部" } },
          {
            kind: "group",
            id: "group-4",
            name: "职业",
            views: [
              { kind: "view", view: { id: "tag-melee-copy-copy-2", name: "战士" } },
              { kind: "view", view: { id: "view-1", name: "旧副本" } },
              { kind: "view", view: { id: "tag-melee-copy-copy-2-copy", name: "野蛮人" } },
            ],
          },
        ],
      },
    },
  });

  assert.deepEqual(collectionIdMaps, {
    "data/skills.json:skills": {
      "tag-melee-copy-copy-2": "view-2",
      "tag-melee-copy-copy-2-copy": "view-3",
    },
  });
});

test("rewriteSharedViewsWithNeutralIds updates defaultViewId and leaf ids", () => {
  const collectionIdMaps = {
    "data/skills.json:skills": {
      "tag-melee-copy-copy-2": "view-2",
      "tag-melee-copy-copy-2-copy": "view-3",
    },
  };

  const nextConfig = rewriteSharedViewsWithNeutralIds({
    collections: {
      "data/skills.json:skills": {
        defaultViewId: "tag-melee-copy-copy-2",
        items: [
          { kind: "view", view: { id: "all", name: "全部" } },
          {
            kind: "group",
            id: "group-4",
            name: "职业",
            views: [
              { kind: "view", view: { id: "tag-melee-copy-copy-2", name: "战士" } },
              { kind: "view", view: { id: "tag-melee-copy-copy-2-copy", name: "野蛮人" } },
            ],
          },
        ],
      },
    },
  }, collectionIdMaps);

  assert.equal(nextConfig.collections["data/skills.json:skills"].defaultViewId, "view-2");
  assert.deepEqual(
    nextConfig.collections["data/skills.json:skills"].items[1].views.map((leaf) => leaf.view.id),
    ["view-2", "view-3"],
  );
});

test("rewriteProfileWithNeutralViewIds rewrites lastActiveViews and viewLayouts keys", () => {
  const collectionIdMaps = {
    "data/skills.json:skills": {
      "tag-melee-copy-copy-2": "view-2",
      "tag-melee-copy-copy-2-copy": "view-3",
    },
  };

  const nextProfile = rewriteProfileWithNeutralViewIds({
    lastActiveViews: {
      "data/skills.json:skills": "tag-melee-copy-copy-2",
    },
    viewLayouts: {
      "data/skills.json:skills": {
        "tag-melee-copy-copy-2": { widths: { skill_name: 120 } },
        "tag-melee-copy-copy-2-copy": { widths: { skill_name: 180 } },
      },
    },
    viewDrafts: {
      "data/skills.json:skills": {
        "tag-melee-copy-copy-2": { query: "player" },
      },
    },
    viewOrderDrafts: {
      "data/skills.json:skills": ["all", "tag-melee-copy-copy-2", "tag-melee-copy-copy-2-copy"],
    },
    structureDrafts: {
      "data/skills.json:skills": {
        items: [
          { kind: "view", viewId: "all" },
          { kind: "group", groupId: "group-4", name: "职业", viewIds: ["tag-melee-copy-copy-2", "tag-melee-copy-copy-2-copy"] },
        ],
      },
    },
  }, collectionIdMaps);

  assert.deepEqual(nextProfile.lastActiveViews, {
    "data/skills.json:skills": "view-2",
  });
  assert.deepEqual(Object.keys(nextProfile.viewLayouts["data/skills.json:skills"]), ["view-2", "view-3"]);
  assert.deepEqual(Object.keys(nextProfile.viewDrafts["data/skills.json:skills"]), ["view-2"]);
  assert.deepEqual(nextProfile.viewOrderDrafts["data/skills.json:skills"], ["all", "view-2", "view-3"]);
  assert.deepEqual(nextProfile.structureDrafts["data/skills.json:skills"].items[1].viewIds, ["view-2", "view-3"]);
});
