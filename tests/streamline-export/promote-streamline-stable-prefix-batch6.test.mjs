import test from "node:test";
import assert from "node:assert/strict";
import {
  promoteStablePrefixBatch6Suggestion,
  promoteStreamlineStablePrefixBatch6Suggestions,
} from "../../scripts/streamline-export/promote-streamline-stable-prefix-batch6.mjs";

test("promoteStablePrefixBatch6Suggestion promotes code share profile", () => {
  const result = promoteStablePrefixBatch6Suggestion({
    itemId: "share-code",
    decision: "review_required",
    confidence: 0.99,
    suggestedTags: ["code", "programming", "script", "software", "browser"],
  });

  assert.equal(result.promote, true);
  assert.deepEqual(result.suggestedTags, [
    "share",
    "code",
    "programming",
    "software",
  ]);
});

test("promoteStablePrefixBatch6Suggestion promotes secure link share profile", () => {
  const result = promoteStablePrefixBatch6Suggestion({
    itemId: "share-link-lock",
    decision: "review_required",
    confidence: 0.99,
    suggestedTags: ["network", "lock", "privacy", "secure", "server", "share"],
  });

  assert.equal(result.promote, true);
  assert.deepEqual(result.suggestedTags, [
    "share",
    "link",
    "lock",
    "privacy",
    "secure",
  ]);
});

test("promoteStablePrefixBatch6Suggestion promotes user share profile", () => {
  const result = promoteStablePrefixBatch6Suggestion({
    itemId: "share-user",
    decision: "review_required",
    confidence: 0.99,
    suggestedTags: ["share", "internet", "network", "server", "account", "avatar"],
  });

  assert.equal(result.promote, true);
  assert.deepEqual(result.suggestedTags, [
    "share",
    "user",
    "account",
  ]);
});

test("promoteStablePrefixBatch6Suggestion rejects unsupported prefix", () => {
  assert.equal(
    promoteStablePrefixBatch6Suggestion({
      itemId: "warning-circle",
      decision: "review_required",
      confidence: 0.77,
      suggestedTags: ["warning"],
    }).promote,
    false,
  );
});

test("promoteStreamlineStablePrefixBatch6Suggestions emits auto_accept suggestions for share prefixes", () => {
  const report = promoteStreamlineStablePrefixBatch6Suggestions({
    family: "micro-solid",
    suggestions: [
      {
        itemId: "share-heart",
        slug: "share-heart",
        decision: "review_required",
        confidence: 0.99,
        suggestedTags: ["favorite", "heart", "like", "love", "share"],
      },
      {
        itemId: "share-symbol",
        slug: "share-symbol",
        decision: "review_required",
        confidence: 0.99,
        suggestedTags: ["share", "card", "symbol"],
      },
      {
        itemId: "text-bar",
        slug: "text-bar",
        decision: "review_required",
        confidence: 0.99,
        suggestedTags: ["text"],
      },
    ],
  });

  assert.equal(report.summary.promotedCount, 2);
  assert.equal(report.promotedSuggestions[0].decision, "auto_accept");
  assert.equal(report.audit[2].reason, "unsupported_prefix");
});
