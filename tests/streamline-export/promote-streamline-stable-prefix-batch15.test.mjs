import test from "node:test";
import assert from "node:assert/strict";
import { promoteStablePrefixBatch15Suggestion, promoteStreamlineStablePrefixBatch15Suggestions } from "../../scripts/streamline-export/promote-streamline-stable-prefix-batch15.mjs";
test("promoteStablePrefixBatch15Suggestion promotes location variants", () => {
  assert.deepEqual(promoteStablePrefixBatch15Suggestion({ itemId: "location-pin-option-add", decision: "review_required", suggestedTags: ["add"] }).suggestedTags, ["location", "pin", "marker", "add", "plus"]);
  assert.deepEqual(promoteStablePrefixBatch15Suggestion({ itemId: "location-target-off", decision: "review_required", suggestedTags: ["off"] }).suggestedTags, ["location", "target", "off", "disable"]);
});
test("promoteStreamlineStablePrefixBatch15Suggestions emits auto_accept suggestions for location prefixes", () => {
  const report = promoteStreamlineStablePrefixBatch15Suggestions({ family: "micro-solid", suggestions: [{ itemId: "location-compass-1", slug: "location-compass-1", decision: "review_required", suggestedTags: ["compass"] }, { itemId: "list-add", slug: "list-add", decision: "review_required", suggestedTags: ["list"] }] });
  assert.equal(report.summary.promotedCount, 1);
  assert.equal(report.promotedSuggestions[0].promotedBy, "stable_prefix_batch15");
});
