import test from "node:test";
import assert from "node:assert/strict";
import {
  promoteStablePrefixBatch1Suggestion,
  promoteStreamlineStablePrefixBatch1Suggestions,
} from "../../scripts/streamline-export/promote-streamline-stable-prefix-batch1.mjs";

test("promoteStablePrefixBatch1Suggestion promotes layout profile with cleaned skeleton tags", () => {
  const result = promoteStablePrefixBatch1Suggestion({
    itemId: "layout-border-center",
    decision: "review_required",
    confidence: 0.99,
    suggestedTags: ["center", "align", "design", "layout", "centered", "formatting", "hamburger", "interface"],
  });

  assert.equal(result.promote, true);
  assert.equal(result.reason, "stable_prefix_batch1");
  assert.deepEqual(result.suggestedTags, [
    "layout",
    "dashboard",
    "widgets",
    "arrangement",
    "frame",
    "grid",
    "interface",
    "border",
  ]);
});

test("promoteStablePrefixBatch1Suggestion promotes mail profile and removes polluted helper tags", () => {
  const result = promoteStablePrefixBatch1Suggestion({
    itemId: "mail-search",
    decision: "review_required",
    confidence: 0.99,
    suggestedTags: ["message", "communication", "email", "envelope", "mail", "all", "inbox", "send", "explore", "find"],
  });

  assert.equal(result.promote, true);
  assert.deepEqual(result.suggestedTags, [
    "message",
    "communication",
    "email",
    "envelope",
    "mail",
    "inbox",
    "search",
    "find",
  ]);
});

test("promoteStablePrefixBatch1Suggestion promotes phone profile and strips device-platform noise", () => {
  const result = promoteStablePrefixBatch1Suggestion({
    itemId: "phone-signal-low",
    decision: "review_required",
    confidence: 0.99,
    suggestedTags: ["phone", "call", "contact", "telephone", "device", "android", "assistance", "communication", "alert", "low"],
  });

  assert.equal(result.promote, true);
  assert.deepEqual(result.suggestedTags, [
    "phone",
    "call",
    "contact",
    "telephone",
    "communication",
    "signal",
    "low",
  ]);
});

test("promoteStablePrefixBatch1Suggestion rejects unsupported prefix or low confidence", () => {
  assert.equal(
    promoteStablePrefixBatch1Suggestion({
      itemId: "watch-circle-download",
      decision: "review_required",
      confidence: 0.99,
      suggestedTags: ["download"],
    }).promote,
    false,
  );
  assert.equal(
    promoteStablePrefixBatch1Suggestion({
      itemId: "mail-add",
      decision: "review_required",
      confidence: 0.77,
      suggestedTags: ["mail"],
    }).promote,
    false,
  );
});

test("promoteStreamlineStablePrefixBatch1Suggestions emits auto_accept suggestions for batch1 prefixes", () => {
  const report = promoteStreamlineStablePrefixBatch1Suggestions({
    family: "micro-solid",
    suggestions: [
      {
        itemId: "layout-1",
        slug: "layout-1",
        decision: "review_required",
        confidence: 0.99,
        suggestedTags: ["dashboard", "layout", "widgets", "arrangement", "customization", "frame", "grid", "design"],
      },
      {
        itemId: "mail-lock",
        slug: "mail-lock",
        decision: "review_required",
        confidence: 0.99,
        suggestedTags: ["message", "communication", "email", "envelope", "mail", "all", "inbox", "send", "lock", "privacy"],
      },
      {
        itemId: "watch-circle-download",
        slug: "watch-circle-download",
        decision: "review_required",
        confidence: 0.99,
        suggestedTags: ["download", "backup"],
      },
    ],
  });

  assert.equal(report.summary.promotedCount, 2);
  assert.equal(report.promotedSuggestions[0].decision, "auto_accept");
  assert.equal(report.audit[2].reason, "unsupported_prefix");
});
