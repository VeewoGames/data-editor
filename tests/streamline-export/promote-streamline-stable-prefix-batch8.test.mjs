import test from "node:test";
import assert from "node:assert/strict";
import {
  promoteStablePrefixBatch8Suggestion,
  promoteStreamlineStablePrefixBatch8Suggestions,
} from "../../scripts/streamline-export/promote-streamline-stable-prefix-batch8.mjs";

test("promoteStablePrefixBatch8Suggestion promotes action and profile user variants", () => {
  assert.deepEqual(
    promoteStablePrefixBatch8Suggestion({
      itemId: "user-add",
      decision: "review_required",
      suggestedTags: ["add", "plus", "cross"],
    }).suggestedTags,
    ["user", "add", "plus"],
  );

  assert.deepEqual(
    promoteStablePrefixBatch8Suggestion({
      itemId: "user-circle",
      decision: "review_required",
      suggestedTags: ["user", "profile"],
    }).suggestedTags,
    ["user", "circle", "profile"],
  );
});

test("promoteStablePrefixBatch8Suggestion promotes semantic user variants", () => {
  assert.deepEqual(
    promoteStablePrefixBatch8Suggestion({
      itemId: "user-search-magnifier",
      decision: "review_required",
      suggestedTags: ["search", "find", "lookup"],
    }).suggestedTags,
    ["user", "search", "find", "magnifier"],
  );

  assert.deepEqual(
    promoteStablePrefixBatch8Suggestion({
      itemId: "user-team-community",
      decision: "review_required",
      suggestedTags: ["user", "team", "community"],
    }).suggestedTags,
    ["user", "team", "community", "group"],
  );
});

test("promoteStablePrefixBatch8Suggestion rejects unsupported prefix", () => {
  assert.equal(
    promoteStablePrefixBatch8Suggestion({
      itemId: "share-user",
      decision: "review_required",
      suggestedTags: ["share", "user"],
    }).promote,
    false,
  );
});

test("promoteStreamlineStablePrefixBatch8Suggestions emits auto_accept suggestions for user prefixes", () => {
  const report = promoteStreamlineStablePrefixBatch8Suggestions({
    family: "micro-solid",
    suggestions: [
      {
        itemId: "user-warning",
        slug: "user-warning",
        decision: "review_required",
        suggestedTags: ["warning", "alert", "notification"],
      },
      {
        itemId: "user-refresh-sync",
        slug: "user-refresh-sync",
        decision: "review_required",
        suggestedTags: ["refresh", "sync", "cloud"],
      },
      {
        itemId: "time-reset",
        slug: "time-reset",
        decision: "review_required",
        suggestedTags: ["time", "reset"],
      },
    ],
  });

  assert.equal(report.summary.promotedCount, 2);
  assert.equal(report.promotedSuggestions[0].decision, "auto_accept");
  assert.equal(report.promotedSuggestions[0].promotedBy, "stable_prefix_batch8");
  assert.equal(report.audit[2].reason, "unsupported_prefix");
});
