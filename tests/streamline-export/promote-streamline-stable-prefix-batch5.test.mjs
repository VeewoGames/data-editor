import test from "node:test";
import assert from "node:assert/strict";
import {
  promoteStablePrefixBatch5Suggestion,
  promoteStreamlineStablePrefixBatch5Suggestions,
} from "../../scripts/streamline-export/promote-streamline-stable-prefix-batch5.mjs";

test("promoteStablePrefixBatch5Suggestion promotes circle warning profile", () => {
  const result = promoteStablePrefixBatch5Suggestion({
    itemId: "warning-circle",
    decision: "review_required",
    confidence: 0.77,
    suggestedTags: ["warning", "alert", "notification", "attention", "caution", "exclamation", "bubble"],
  });

  assert.equal(result.promote, true);
  assert.deepEqual(result.suggestedTags, [
    "warning",
    "alert",
    "caution",
    "exclamation",
    "circle",
  ]);
});

test("promoteStablePrefixBatch5Suggestion promotes shape-specific variants", () => {
  assert.deepEqual(
    promoteStablePrefixBatch5Suggestion({
      itemId: "warning-shield",
      decision: "review_required",
      confidence: 0.77,
      suggestedTags: ["warning", "alert", "attention"],
    }).suggestedTags,
    ["warning", "alert", "caution", "exclamation", "shield"],
  );

  assert.deepEqual(
    promoteStablePrefixBatch5Suggestion({
      itemId: "warning-triangle",
      decision: "review_required",
      confidence: 0.77,
      suggestedTags: ["warning", "alert", "attention"],
    }).suggestedTags,
    ["warning", "alert", "caution", "exclamation", "triangle"],
  );
});

test("promoteStablePrefixBatch5Suggestion rejects unsupported prefix", () => {
  assert.equal(
    promoteStablePrefixBatch5Suggestion({
      itemId: "number-zero",
      decision: "review_required",
      confidence: 0.77,
      suggestedTags: ["number"],
    }).promote,
    false,
  );
});

test("promoteStreamlineStablePrefixBatch5Suggestions emits auto_accept suggestions for warning prefixes", () => {
  const report = promoteStreamlineStablePrefixBatch5Suggestions({
    family: "micro-solid",
    suggestions: [
      {
        itemId: "warning-square",
        slug: "warning-square",
        decision: "review_required",
        confidence: 0.77,
        suggestedTags: ["warning", "alert", "notification", "attention", "caution", "exclamation", "bubble"],
      },
      {
        itemId: "warning-octagon",
        slug: "warning-octagon",
        decision: "review_required",
        confidence: 0.77,
        suggestedTags: ["warning", "alert", "notification", "attention", "caution", "exclamation", "bubble"],
      },
      {
        itemId: "share-code",
        slug: "share-code",
        decision: "review_required",
        confidence: 0.99,
        suggestedTags: ["share", "code"],
      },
    ],
  });

  assert.equal(report.summary.promotedCount, 2);
  assert.equal(report.promotedSuggestions[0].decision, "auto_accept");
  assert.equal(report.audit[2].reason, "unsupported_prefix");
});
