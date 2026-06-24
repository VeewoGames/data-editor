import test from "node:test";
import assert from "node:assert/strict";
import {
  promoteStablePrefixBatch10Suggestion,
  promoteStreamlineStablePrefixBatch10Suggestions,
} from "../../scripts/streamline-export/promote-streamline-stable-prefix-batch10.mjs";

test("promoteStablePrefixBatch10Suggestion promotes laptop device action variants", () => {
  assert.deepEqual(
    promoteStablePrefixBatch10Suggestion({
      itemId: "laptop-add-plus",
      decision: "review_required",
      suggestedTags: ["add", "plus"],
    }).suggestedTags,
    ["laptop", "computer", "add", "plus"],
  );

  assert.deepEqual(
    promoteStablePrefixBatch10Suggestion({
      itemId: "laptop-lock",
      decision: "review_required",
      suggestedTags: ["lock", "secure"],
    }).suggestedTags,
    ["laptop", "computer", "lock", "secure", "privacy"],
  );
});

test("promoteStablePrefixBatch10Suggestion promotes laptop semantic variants", () => {
  assert.deepEqual(
    promoteStablePrefixBatch10Suggestion({
      itemId: "laptop-charging",
      decision: "review_required",
      suggestedTags: ["charging", "power"],
    }).suggestedTags,
    ["laptop", "computer", "charging", "power", "battery"],
  );

  assert.deepEqual(
    promoteStablePrefixBatch10Suggestion({
      itemId: "laptop-project-screen",
      decision: "review_required",
      suggestedTags: ["project", "screen"],
    }).suggestedTags,
    ["laptop", "computer", "project", "screen", "display"],
  );
});

test("promoteStreamlineStablePrefixBatch10Suggestions emits auto_accept suggestions for laptop prefixes", () => {
  const report = promoteStreamlineStablePrefixBatch10Suggestions({
    family: "micro-solid",
    suggestions: [
      { itemId: "laptop-search", slug: "laptop-search", decision: "review_required", suggestedTags: ["search", "find"] },
      { itemId: "laptop-warning-1", slug: "laptop-warning-1", decision: "review_required", suggestedTags: ["warning", "alert"] },
      { itemId: "shopping-bag", slug: "shopping-bag", decision: "review_required", suggestedTags: ["shopping"] },
    ],
  });

  assert.equal(report.summary.promotedCount, 2);
  assert.equal(report.promotedSuggestions[0].promotedBy, "stable_prefix_batch10");
  assert.equal(report.audit[2].reason, "unsupported_prefix");
});
