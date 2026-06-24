import test from "node:test";
import assert from "node:assert/strict";
import {
  promoteStableClusterSuggestion,
  promoteStableClusterSuggestions,
} from "../../scripts/streamline-export/promote-streamline-stable-clusters.mjs";
import { stableClusterProfiles } from "../../scripts/streamline-export/stable-cluster-profiles.mjs";

test("wave4 profiles promote representative variants", () => {
  assert.deepEqual(
    promoteStableClusterSuggestion({ itemId: "music-note-circle-off", decision: "review_required" }, stableClusterProfiles.music).suggestedTags,
    ["music", "note", "audio", "circle", "off", "mute", "disable"],
  );
  assert.deepEqual(
    promoteStableClusterSuggestion({ itemId: "pathfinder-minus-front", decision: "review_required" }, stableClusterProfiles.pathfinder).suggestedTags,
    ["pathfinder", "minus", "front", "layer"],
  );
  assert.deepEqual(
    promoteStableClusterSuggestion({ itemId: "play-list-folder", decision: "review_required" }, stableClusterProfiles.play).suggestedTags,
    ["play", "playlist", "folder"],
  );
  assert.deepEqual(
    promoteStableClusterSuggestion({ itemId: "print-add-printer", decision: "review_required" }, stableClusterProfiles.print).suggestedTags,
    ["print", "printer", "add", "plus"],
  );
  assert.deepEqual(
    promoteStableClusterSuggestion({ itemId: "screen-sharing-tutorial", decision: "review_required" }, stableClusterProfiles.screen).suggestedTags,
    ["screen", "display", "sharing", "tutorial"],
  );
  assert.deepEqual(
    promoteStableClusterSuggestion({ itemId: "timer-pace-average", decision: "review_required" }, stableClusterProfiles.timer).suggestedTags,
    ["timer", "time", "pace", "average"],
  );
});

test("wave4 profiles emit auto_accept suggestions", () => {
  const report = promoteStableClusterSuggestions({
    family: "micro-solid",
    suggestions: [
      { itemId: "music-note-1", slug: "music-note-1", decision: "review_required" },
      { itemId: "music-note-off-1", slug: "music-note-off-1", decision: "review_required" },
      { itemId: "timer-auto", slug: "timer-auto", decision: "review_required" },
      { itemId: "wifi-disabled", slug: "wifi-disabled", decision: "review_required" },
    ],
  }, stableClusterProfiles.music);

  assert.equal(report.summary.promotedCount, 2);
  assert.equal(report.promotedSuggestions[0].promotedBy, "stable_prefix_batch17");
  assert.equal(report.audit[2].reason, "unsupported_prefix");
});
