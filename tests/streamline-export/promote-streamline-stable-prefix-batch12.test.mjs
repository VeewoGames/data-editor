import test from "node:test";
import assert from "node:assert/strict";
import { promoteStablePrefixBatch12Suggestion, promoteStreamlineStablePrefixBatch12Suggestions } from "../../scripts/streamline-export/promote-streamline-stable-prefix-batch12.mjs";
test("promoteStablePrefixBatch12Suggestion promotes volume semantic variants", () => {
  assert.deepEqual(promoteStablePrefixBatch12Suggestion({ itemId: "volume-disable-mute-1", decision: "review_required", suggestedTags: ["mute"] }).suggestedTags, ["volume", "audio", "disable", "mute", "off"]);
  assert.deepEqual(promoteStablePrefixBatch12Suggestion({ itemId: "volume-warning", decision: "review_required", suggestedTags: ["warning"] }).suggestedTags, ["volume", "audio", "warning", "alert"]);
});
test("promoteStreamlineStablePrefixBatch12Suggestions emits auto_accept suggestions for volume prefixes", () => {
  const report = promoteStreamlineStablePrefixBatch12Suggestions({ family: "micro-solid", suggestions: [{ itemId: "volume-increase", slug: "volume-increase", decision: "review_required", suggestedTags: ["increase"] }, { itemId: "text-bar", slug: "text-bar", decision: "review_required", suggestedTags: ["text"] }] });
  assert.equal(report.summary.promotedCount, 1);
  assert.equal(report.promotedSuggestions[0].promotedBy, "stable_prefix_batch12");
});
