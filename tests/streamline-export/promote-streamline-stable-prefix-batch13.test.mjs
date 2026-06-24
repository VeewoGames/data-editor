import test from "node:test";
import assert from "node:assert/strict";
import { promoteStablePrefixBatch13Suggestion, promoteStreamlineStablePrefixBatch13Suggestions } from "../../scripts/streamline-export/promote-streamline-stable-prefix-batch13.mjs";
test("promoteStablePrefixBatch13Suggestion promotes select variants", () => {
  assert.deepEqual(promoteStablePrefixBatch13Suggestion({ itemId: "select-all", decision: "review_required", suggestedTags: ["all"] }).suggestedTags, ["select", "all"]);
  assert.deepEqual(promoteStablePrefixBatch13Suggestion({ itemId: "select-square-area-1", decision: "review_required", suggestedTags: ["area"] }).suggestedTags, ["select", "square", "area"]);
});
test("promoteStreamlineStablePrefixBatch13Suggestions emits auto_accept suggestions for select prefixes", () => {
  const report = promoteStreamlineStablePrefixBatch13Suggestions({ family: "micro-solid", suggestions: [{ itemId: "select-frame--26552", slug: "select-frame--26552", decision: "review_required", suggestedTags: ["frame"] }, { itemId: "user-add", slug: "user-add", decision: "review_required", suggestedTags: ["user"] }] });
  assert.equal(report.summary.promotedCount, 1);
  assert.equal(report.promotedSuggestions[0].promotedBy, "stable_prefix_batch13");
});
