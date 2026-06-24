import test from "node:test";
import assert from "node:assert/strict";
import { promoteStablePrefixBatch16Suggestion, promoteStreamlineStablePrefixBatch16Suggestions } from "../../scripts/streamline-export/promote-streamline-stable-prefix-batch16.mjs";
test("promoteStablePrefixBatch16Suggestion promotes wifi variants", () => {
  assert.deepEqual(promoteStablePrefixBatch16Suggestion({ itemId: "wifi-secure-connection", decision: "review_required", suggestedTags: ["secure"] }).suggestedTags, ["wifi", "network", "connection", "secure"]);
  assert.deepEqual(promoteStablePrefixBatch16Suggestion({ itemId: "wifi-signal-low", decision: "review_required", suggestedTags: ["signal"] }).suggestedTags, ["wifi", "network", "signal", "low"]);
});
test("promoteStreamlineStablePrefixBatch16Suggestions emits auto_accept suggestions for wifi prefixes", () => {
  const report = promoteStreamlineStablePrefixBatch16Suggestions({ family: "micro-solid", suggestions: [{ itemId: "wifi-disabled", slug: "wifi-disabled", decision: "review_required", suggestedTags: ["disabled"] }, { itemId: "location-pin", slug: "location-pin", decision: "review_required", suggestedTags: ["location"] }] });
  assert.equal(report.summary.promotedCount, 1);
  assert.equal(report.promotedSuggestions[0].promotedBy, "stable_prefix_batch16");
});
