import test from "node:test";
import assert from "node:assert/strict";
import { promoteStablePrefixBatch11Suggestion, promoteStreamlineStablePrefixBatch11Suggestions } from "../../scripts/streamline-export/promote-streamline-stable-prefix-batch11.mjs";
test("promoteStablePrefixBatch11Suggestion promotes text formatting variants", () => {
  assert.deepEqual(promoteStablePrefixBatch11Suggestion({ itemId: "text-line-spacing", decision: "review_required", suggestedTags: ["text"] }).suggestedTags, ["text", "line", "spacing", "formatting"]);
  assert.deepEqual(promoteStablePrefixBatch11Suggestion({ itemId: "text-to-speech-1", decision: "review_required", suggestedTags: ["text"] }).suggestedTags, ["text", "speech", "audio"]);
});
test("promoteStreamlineStablePrefixBatch11Suggestions emits auto_accept suggestions for text prefixes", () => {
  const report = promoteStreamlineStablePrefixBatch11Suggestions({ family: "micro-solid", suggestions: [{ itemId: "text-search", slug: "text-search", decision: "review_required", suggestedTags: ["text"] }, { itemId: "volume-low", slug: "volume-low", decision: "review_required", suggestedTags: ["volume"] }] });
  assert.equal(report.summary.promotedCount, 1);
  assert.equal(report.promotedSuggestions[0].promotedBy, "stable_prefix_batch11");
});
