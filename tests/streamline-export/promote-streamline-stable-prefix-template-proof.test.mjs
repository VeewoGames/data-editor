import test from "node:test";
import assert from "node:assert/strict";
import {
  promoteStableClusterSuggestion,
  promoteStableClusterSuggestions,
} from "../../scripts/streamline-export/promote-streamline-stable-clusters.mjs";
import { stableClusterProfiles } from "../../scripts/streamline-export/stable-cluster-profiles.mjs";

test("template layer can onboard zoom and light clusters without dedicated wrapper files", () => {
  assert.deepEqual(
    promoteStableClusterSuggestion({ itemId: "zoom-in-area", decision: "review_required" }, stableClusterProfiles.zoom).suggestedTags,
    ["zoom", "area", "in"],
  );
  assert.deepEqual(
    promoteStableClusterSuggestion({ itemId: "light-dark-mode", decision: "review_required" }, stableClusterProfiles.light).suggestedTags,
    ["light", "dark", "mode"],
  );
});

test("template layer emits auto_accept suggestions for zoom and light clusters", () => {
  const report = promoteStableClusterSuggestions({
    family: "micro-solid",
    suggestions: [
      { itemId: "zoom-fit-screen", slug: "zoom-fit-screen", decision: "review_required" },
      { itemId: "light-off", slug: "light-off", decision: "review_required" },
      { itemId: "wifi-disabled", slug: "wifi-disabled", decision: "review_required" },
    ],
  }, stableClusterProfiles.zoom);

  assert.equal(report.summary.promotedCount, 1);
  assert.equal(report.promotedSuggestions[0].promotedBy, "stable_prefix_batch23");
  assert.equal(report.audit[2].reason, "unsupported_prefix");
});
