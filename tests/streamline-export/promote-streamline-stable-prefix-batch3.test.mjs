import test from "node:test";
import assert from "node:assert/strict";
import {
  promoteStablePrefixBatch3Suggestion,
  promoteStreamlineStablePrefixBatch3Suggestions,
} from "../../scripts/streamline-export/promote-streamline-stable-prefix-batch3.mjs";

test("promoteStablePrefixBatch3Suggestion promotes charging profile", () => {
  const result = promoteStablePrefixBatch3Suggestion({
    itemId: "watch-circle-charging",
    decision: "review_required",
    confidence: 0.77,
    suggestedTags: ["charging", "energy", "power", "battery", "bolt", "charge", "device"],
  });

  assert.equal(result.promote, true);
  assert.deepEqual(result.suggestedTags, [
    "watch",
    "circle",
    "charging",
    "energy",
    "power",
    "battery",
    "charge",
  ]);
});

test("promoteStablePrefixBatch3Suggestion promotes download profile and removes abstract noise", () => {
  const result = promoteStablePrefixBatch3Suggestion({
    itemId: "watch-square-download",
    decision: "review_required",
    confidence: 0.77,
    suggestedTags: ["download", "backup", "data", "save", "storage", "transfer", "arrow", "cloud", "abstract"],
  });

  assert.equal(result.promote, true);
  assert.deepEqual(result.suggestedTags, [
    "watch",
    "square",
    "download",
    "data",
    "storage",
    "transfer",
  ]);
});

test("promoteStablePrefixBatch3Suggestion promotes time profile and removes travel noise", () => {
  const result = promoteStablePrefixBatch3Suggestion({
    itemId: "watch-square-time",
    decision: "review_required",
    confidence: 0.99,
    suggestedTags: ["clock", "time", "flight", "schedule", "travel", "abstract", "design"],
  });

  assert.equal(result.promote, true);
  assert.deepEqual(result.suggestedTags, [
    "watch",
    "square",
    "clock",
    "time",
    "schedule",
  ]);
});

test("promoteStablePrefixBatch3Suggestion rejects unsupported prefix", () => {
  assert.equal(
    promoteStablePrefixBatch3Suggestion({
      itemId: "menu-line-1",
      decision: "review_required",
      confidence: 0.99,
      suggestedTags: ["menu"],
    }).promote,
    false,
  );
});

test("promoteStreamlineStablePrefixBatch3Suggestions emits auto_accept suggestions for watch prefixes", () => {
  const report = promoteStreamlineStablePrefixBatch3Suggestions({
    family: "micro-solid",
    suggestions: [
      {
        itemId: "watch-circle-disable",
        slug: "watch-circle-disable",
        decision: "review_required",
        confidence: 0.77,
        suggestedTags: ["disable", "off", "blocked", "deactivate", "denied"],
      },
      {
        itemId: "watch-square-upload",
        slug: "watch-square-upload",
        decision: "review_required",
        confidence: 0.77,
        suggestedTags: ["backup", "data", "storage", "upload", "save"],
      },
      {
        itemId: "search-text",
        slug: "search-text",
        decision: "review_required",
        confidence: 0.99,
        suggestedTags: ["search", "find"],
      },
    ],
  });

  assert.equal(report.summary.promotedCount, 2);
  assert.equal(report.promotedSuggestions[0].decision, "auto_accept");
  assert.equal(report.audit[2].reason, "unsupported_prefix");
});
