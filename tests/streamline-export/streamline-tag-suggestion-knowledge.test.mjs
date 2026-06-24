import test from "node:test";
import assert from "node:assert/strict";
import {
  buildStreamlineTagKnowledge,
  suggestTagsForManifestItem,
} from "../../scripts/streamline-export/lib/streamline-tag-suggestion-knowledge.mjs";

test("buildStreamlineTagKnowledge indexes labeled manifest items into a controlled vocabulary", async () => {
  const svgByPath = {
    "vendor/streamline-svg/micro-solid/inbox-post.svg": '<svg viewBox="0 0 12 12"><rect/><path/></svg>',
    "vendor/streamline-svg/micro-solid/inbox-tray-1.svg": '<svg viewBox="0 0 12 12"><rect/><path/></svg>',
    "vendor/streamline-svg/micro-solid/camera.svg": '<svg viewBox="0 0 12 12"><circle/><rect/></svg>',
  };

  const knowledge = await buildStreamlineTagKnowledge({
    items: [
      {
        itemId: "inbox-post",
        name: "Inbox Post",
        outputPath: "vendor/streamline-svg/micro-solid/inbox-post.svg",
        tags: ["inbox", "mail", "message", "post"],
        metadataStatus: "success",
      },
      {
        itemId: "inbox-tray-1",
        name: "Inbox Tray 1",
        outputPath: "vendor/streamline-svg/micro-solid/inbox-tray-1.svg",
        tags: ["inbox", "tray", "mail", "storage"],
        metadataStatus: "success",
      },
      {
        itemId: "camera",
        name: "Camera",
        outputPath: "vendor/streamline-svg/micro-solid/camera.svg",
        tags: ["camera", "photo"],
        metadataStatus: "success",
      },
      {
        itemId: "inbox-open",
        name: "Inbox Open",
        outputPath: "vendor/streamline-svg/micro-solid/inbox-open.svg",
        tags: [],
        metadataStatus: "pending",
      },
    ],
    readSvg: async (outputPath) => svgByPath[outputPath] ?? '<svg viewBox="0 0 12 12"></svg>',
  });

  assert.equal(knowledge.labeledItems.length, 3);
  assert.equal(knowledge.tagStats.inbox.count, 2);
  assert.deepEqual(knowledge.tagVocabulary.slice(0, 4), ["camera", "inbox", "mail", "message"]);
});

test("suggestTagsForManifestItem combines name and svg neighbors into scored suggestions", async () => {
  const svgByPath = {
    "vendor/streamline-svg/micro-solid/inbox-post.svg": '<svg viewBox="0 0 12 12"><rect/><path/></svg>',
    "vendor/streamline-svg/micro-solid/inbox-tray-1.svg": '<svg viewBox="0 0 12 12"><rect/><path/></svg>',
    "vendor/streamline-svg/micro-solid/inbox-open.svg": '<svg viewBox="0 0 12 12"><rect/><path/></svg>',
    "vendor/streamline-svg/micro-solid/camera.svg": '<svg viewBox="0 0 12 12"><circle/><rect/></svg>',
  };

  const knowledge = await buildStreamlineTagKnowledge({
    items: [
      {
        itemId: "inbox-post",
        name: "Inbox Post",
        outputPath: "vendor/streamline-svg/micro-solid/inbox-post.svg",
        tags: ["inbox", "mail", "message", "post"],
        metadataStatus: "success",
      },
      {
        itemId: "inbox-tray-1",
        name: "Inbox Tray 1",
        outputPath: "vendor/streamline-svg/micro-solid/inbox-tray-1.svg",
        tags: ["inbox", "tray", "mail", "storage"],
        metadataStatus: "success",
      },
      {
        itemId: "camera",
        name: "Camera",
        outputPath: "vendor/streamline-svg/micro-solid/camera.svg",
        tags: ["camera", "photo"],
        metadataStatus: "success",
      },
    ],
    readSvg: async (outputPath) => svgByPath[outputPath] ?? '<svg viewBox="0 0 12 12"></svg>',
  });

  const suggestion = await suggestTagsForManifestItem(knowledge, {
    itemId: "inbox-open",
    name: "Inbox Open",
    outputPath: "vendor/streamline-svg/micro-solid/inbox-open.svg",
  }, {
    readSvg: async (outputPath) => svgByPath[outputPath] ?? '<svg viewBox="0 0 12 12"></svg>',
    maxTags: 5,
  });

  assert.deepEqual(suggestion.suggestedTags.slice(0, 3), ["inbox", "mail", "message"]);
  assert.equal(suggestion.decision, "review_required");
  assert.match(String(suggestion.confidence), /^0\./);
  assert.deepEqual(
    suggestion.evidence.nameNeighbors.map((entry) => entry.itemId),
    ["inbox-post", "inbox-tray-1"],
  );
  assert.deepEqual(
    suggestion.evidence.imageNeighbors.map((entry) => entry.itemId),
    ["inbox-post", "inbox-tray-1"],
  );
});
