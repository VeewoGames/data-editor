import test from "node:test";
import assert from "node:assert/strict";
import {
  promoteStablePrefixBatch4Suggestion,
  promoteStreamlineStablePrefixBatch4Suggestions,
} from "../../scripts/streamline-export/promote-streamline-stable-prefix-batch4.mjs";

test("promoteStablePrefixBatch4Suggestion promotes plain number profile", () => {
  const result = promoteStablePrefixBatch4Suggestion({
    itemId: "number-two",
    decision: "review_required",
    confidence: 0.77,
    suggestedTags: ["interface", "number", "symbol", "arrangement", "arrow", "ascending"],
  });

  assert.equal(result.promote, true);
  assert.deepEqual(result.suggestedTags, [
    "number",
    "two",
    "digit",
    "symbol",
  ]);
});

test("promoteStablePrefixBatch4Suggestion promotes circle variant", () => {
  const result = promoteStablePrefixBatch4Suggestion({
    itemId: "number-eight-circle",
    decision: "review_required",
    confidence: 0.77,
    suggestedTags: ["number", "symbol", "arrow", "ascending", "direction"],
  });

  assert.equal(result.promote, true);
  assert.deepEqual(result.suggestedTags, [
    "number",
    "eight",
    "circle",
    "digit",
    "symbol",
  ]);
});

test("promoteStablePrefixBatch4Suggestion promotes square variant", () => {
  const result = promoteStablePrefixBatch4Suggestion({
    itemId: "number-one-square",
    decision: "review_required",
    confidence: 0.77,
    suggestedTags: ["number", "symbol", "arrow", "ascending", "direction"],
  });

  assert.equal(result.promote, true);
  assert.deepEqual(result.suggestedTags, [
    "number",
    "one",
    "square",
    "digit",
    "symbol",
  ]);
});

test("promoteStablePrefixBatch4Suggestion rejects unsupported prefix", () => {
  assert.equal(
    promoteStablePrefixBatch4Suggestion({
      itemId: "warning-circle",
      decision: "review_required",
      confidence: 0.77,
      suggestedTags: ["warning"],
    }).promote,
    false,
  );
});

test("promoteStreamlineStablePrefixBatch4Suggestions emits auto_accept suggestions for number prefixes", () => {
  const report = promoteStreamlineStablePrefixBatch4Suggestions({
    family: "micro-solid",
    suggestions: [
      {
        itemId: "number-zero",
        slug: "number-zero",
        decision: "review_required",
        confidence: 0.77,
        suggestedTags: ["number", "symbol", "arrow"],
      },
      {
        itemId: "number-zero-circle",
        slug: "number-zero-circle",
        decision: "review_required",
        confidence: 0.77,
        suggestedTags: ["number", "symbol", "arrow"],
      },
      {
        itemId: "search-text",
        slug: "search-text",
        decision: "review_required",
        confidence: 0.99,
        suggestedTags: ["search", "find"],
      },
    ],
  });

  assert.equal(report.summary.promotedCount, 2);
  assert.equal(report.promotedSuggestions[0].decision, "auto_accept");
  assert.equal(report.audit[2].reason, "unsupported_prefix");
});
