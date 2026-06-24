import test from "node:test";
import assert from "node:assert/strict";
import {
  promoteStableClusterSuggestion,
  promoteStableClusterSuggestions,
} from "../../scripts/streamline-export/promote-streamline-stable-clusters.mjs";
import { stableClusterProfiles } from "../../scripts/streamline-export/stable-cluster-profiles.mjs";

test("machine layer can onboard pathfinder shopping scroll shield sign via generic cluster entry", () => {
  assert.deepEqual(
    promoteStableClusterSuggestion({ itemId: "pathfinder-union", decision: "review_required" }, stableClusterProfiles.pathfinder).suggestedTags,
    ["pathfinder", "union", "combine"],
  );
  assert.deepEqual(
    promoteStableClusterSuggestion({ itemId: "shopping-store-signage-1", decision: "review_required" }, stableClusterProfiles.shopping).suggestedTags,
    ["shopping", "store", "commerce", "signage"],
  );
  assert.deepEqual(
    promoteStableClusterSuggestion({ itemId: "scroll-up-down", decision: "review_required" }, stableClusterProfiles.scroll).suggestedTags,
    ["scroll", "up", "arrow", "down", "arrows"],
  );
  assert.deepEqual(
    promoteStableClusterSuggestion({ itemId: "shield-star-police-badge", decision: "review_required" }, stableClusterProfiles.shield).suggestedTags,
    ["shield", "protection", "security", "star", "police", "badge"],
  );
  assert.deepEqual(
    promoteStableClusterSuggestion({ itemId: "sign-cross-shield", decision: "review_required" }, stableClusterProfiles.sign).suggestedTags,
    ["sign", "symbol", "cross", "shield"],
  );
});

test("machine layer can onboard lock move notepad shipment signal via generic cluster entry", () => {
  assert.deepEqual(
    promoteStableClusterSuggestion({ itemId: "lock-shield", decision: "review_required" }, stableClusterProfiles.lock).suggestedTags,
    ["lock", "secure", "shield", "protection"],
  );
  assert.deepEqual(
    promoteStableClusterSuggestion({ itemId: "move-object-left", decision: "review_required" }, stableClusterProfiles.move).suggestedTags,
    ["move", "object", "left"],
  );
  assert.deepEqual(
    promoteStableClusterSuggestion({ itemId: "notepad-subtract", decision: "review_required" }, stableClusterProfiles.notepad).suggestedTags,
    ["notepad", "subtract", "minus"],
  );
  assert.deepEqual(
    promoteStableClusterSuggestion({ itemId: "shipment-search", decision: "review_required" }, stableClusterProfiles.shipment).suggestedTags,
    ["shipment", "search", "find"],
  );
  assert.deepEqual(
    promoteStableClusterSuggestion({ itemId: "signal-graph-circle", decision: "review_required" }, stableClusterProfiles.signal).suggestedTags,
    ["signal", "graph", "bars", "circle"],
  );
});

test("machine layer emits auto_accept suggestions for new generic clusters", () => {
  const report = promoteStableClusterSuggestions({
    family: "micro-solid",
    suggestions: [
      { itemId: "scroll-top", slug: "scroll-top", decision: "review_required" },
      { itemId: "scroll-up", slug: "scroll-up", decision: "review_required" },
      { itemId: "wifi-disabled", slug: "wifi-disabled", decision: "review_required" },
    ],
  }, stableClusterProfiles.scroll);

  assert.equal(report.summary.promotedCount, 2);
  assert.equal(report.promotedSuggestions[0].promotedBy, "stable_prefix_batch30");
  assert.equal(report.audit[2].reason, "unsupported_prefix");
});
