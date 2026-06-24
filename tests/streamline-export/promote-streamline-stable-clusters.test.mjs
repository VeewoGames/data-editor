import test from "node:test";
import assert from "node:assert/strict";
import {
  promoteStableClusterSuggestion,
  promoteStableClusterSuggestions,
} from "../../scripts/streamline-export/promote-streamline-stable-clusters.mjs";
import { stableClusterProfiles } from "../../scripts/streamline-export/stable-cluster-profiles.mjs";

test("promoteStableClusterSuggestion promotes warning profile via generic engine", () => {
  const result = promoteStableClusterSuggestion({
    itemId: "warning-circle",
    decision: "review_required",
    suggestedTags: ["warning", "alert"],
  }, stableClusterProfiles.warning);

  assert.equal(result.promote, true);
  assert.deepEqual(result.suggestedTags, [
    "warning",
    "alert",
    "caution",
    "exclamation",
    "circle",
  ]);
});

test("promoteStableClusterSuggestion promotes share profile via generic engine", () => {
  const result = promoteStableClusterSuggestion({
    itemId: "share-link-lock",
    decision: "review_required",
    suggestedTags: ["share", "lock"],
  }, stableClusterProfiles.share);

  assert.equal(result.promote, true);
  assert.deepEqual(result.suggestedTags, [
    "share",
    "link",
    "lock",
    "privacy",
    "secure",
  ]);
});

test("promoteStableClusterSuggestions emits generic auto_accept payload for time profile", () => {
  const report = promoteStableClusterSuggestions({
    family: "micro-solid",
    suggestions: [
      {
        itemId: "time-reset",
        slug: "time-reset",
        decision: "review_required",
        suggestedTags: ["time"],
      },
      {
        itemId: "share-code",
        slug: "share-code",
        decision: "review_required",
        suggestedTags: ["share"],
      },
    ],
  }, stableClusterProfiles.time);

  assert.equal(report.summary.promotedCount, 1);
  assert.equal(report.promotedSuggestions[0].promotedBy, "stable_prefix_batch7");
  assert.equal(report.audit[1].reason, "unsupported_prefix");
});
