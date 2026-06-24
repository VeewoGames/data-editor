import test from "node:test";
import assert from "node:assert/strict";
import {
  promoteStablePrefixBatch7Suggestion,
  promoteStreamlineStablePrefixBatch7Suggestions,
} from "../../scripts/streamline-export/promote-streamline-stable-prefix-batch7.mjs";

test("promoteStablePrefixBatch7Suggestion promotes alarm profile", () => {
  const result = promoteStablePrefixBatch7Suggestion({
    itemId: "time-alarm",
    decision: "review_required",
    confidence: 0.99,
    suggestedTags: ["alarm", "alert", "bell", "notification", "reminder"],
  });

  assert.equal(result.promote, true);
  assert.deepEqual(result.suggestedTags, [
    "time",
    "alarm",
    "alert",
    "reminder",
  ]);
});

test("promoteStablePrefixBatch7Suggestion promotes shaped clock profile", () => {
  const result = promoteStablePrefixBatch7Suggestion({
    itemId: "time-clock-circle",
    decision: "review_required",
    confidence: 0.99,
    suggestedTags: ["clock", "time", "schedule", "flight", "timer"],
  });

  assert.equal(result.promote, true);
  assert.deepEqual(result.suggestedTags, [
    "time",
    "clock",
    "circle",
  ]);
});

test("promoteStablePrefixBatch7Suggestion promotes off and digit profiles", () => {
  assert.deepEqual(
    promoteStablePrefixBatch7Suggestion({
      itemId: "time-history-off",
      decision: "review_required",
      confidence: 0.99,
      suggestedTags: ["off", "disable", "clock", "time"],
    }).suggestedTags,
    ["time", "history", "off", "disable"],
  );

  assert.deepEqual(
    promoteStablePrefixBatch7Suggestion({
      itemId: "time-nine",
      decision: "review_required",
      confidence: 0.99,
      suggestedTags: ["clock", "time", "digit", "nine", "number"],
    }).suggestedTags,
    ["time", "nine", "digit"],
  );
});

test("promoteStablePrefixBatch7Suggestion rejects unsupported prefix", () => {
  assert.equal(
    promoteStablePrefixBatch7Suggestion({
      itemId: "share-code",
      decision: "review_required",
      confidence: 0.99,
      suggestedTags: ["share"],
    }).promote,
    false,
  );
});

test("promoteStreamlineStablePrefixBatch7Suggestions emits auto_accept suggestions for time prefixes", () => {
  const report = promoteStreamlineStablePrefixBatch7Suggestions({
    family: "micro-solid",
    suggestions: [
      {
        itemId: "time-hour-glass",
        slug: "time-hour-glass",
        decision: "review_required",
        confidence: 0.99,
        suggestedTags: ["clock", "time", "schedule"],
      },
      {
        itemId: "time-reset",
        slug: "time-reset",
        decision: "review_required",
        confidence: 0.99,
        suggestedTags: ["clock", "time", "schedule"],
      },
      {
        itemId: "warning-circle",
        slug: "warning-circle",
        decision: "review_required",
        confidence: 0.77,
        suggestedTags: ["warning"],
      },
    ],
  });

  assert.equal(report.summary.promotedCount, 2);
  assert.equal(report.promotedSuggestions[0].decision, "auto_accept");
  assert.equal(report.audit[2].reason, "unsupported_prefix");
});
