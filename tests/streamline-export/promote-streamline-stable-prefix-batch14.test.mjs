import test from "node:test";
import assert from "node:assert/strict";
import { promoteStablePrefixBatch14Suggestion, promoteStreamlineStablePrefixBatch14Suggestions } from "../../scripts/streamline-export/promote-streamline-stable-prefix-batch14.mjs";
test("promoteStablePrefixBatch14Suggestion promotes list variants", () => {
  assert.deepEqual(promoteStablePrefixBatch14Suggestion({ itemId: "list-a-to-z-arrangement", decision: "review_required", suggestedTags: ["list"] }).suggestedTags, ["list", "sort", "ascending", "alphabet"]);
  assert.deepEqual(promoteStablePrefixBatch14Suggestion({ itemId: "list-to-do-tasks-checklist", decision: "review_required", suggestedTags: ["list"] }).suggestedTags, ["list", "todo", "tasks", "checklist"]);
});
test("promoteStreamlineStablePrefixBatch14Suggestions emits auto_accept suggestions for list prefixes", () => {
  const report = promoteStreamlineStablePrefixBatch14Suggestions({ family: "micro-solid", suggestions: [{ itemId: "list-add", slug: "list-add", decision: "review_required", suggestedTags: ["add"] }, { itemId: "wifi-antenna", slug: "wifi-antenna", decision: "review_required", suggestedTags: ["wifi"] }] });
  assert.equal(report.summary.promotedCount, 1);
  assert.equal(report.promotedSuggestions[0].promotedBy, "stable_prefix_batch14");
});
