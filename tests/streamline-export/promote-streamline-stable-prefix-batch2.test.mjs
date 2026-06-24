import test from "node:test";
import assert from "node:assert/strict";
import {
  promoteStablePrefixBatch2Suggestion,
  promoteStreamlineStablePrefixBatch2Suggestions,
} from "../../scripts/streamline-export/promote-streamline-stable-prefix-batch2.mjs";

test("promoteStablePrefixBatch2Suggestion promotes navigation profile with cleaned directional tags", () => {
  const result = promoteStablePrefixBatch2Suggestion({
    itemId: "navigation-arrow-fork-left",
    decision: "review_required",
    confidence: 0.77,
    suggestedTags: ["arrow", "direction", "dashed", "forward", "point", "backward", "click", "cursor", "guide", "interface", "left", "mouse"],
  });

  assert.equal(result.promote, true);
  assert.equal(result.reason, "stable_prefix_batch2");
  assert.deepEqual(result.suggestedTags, [
    "arrow",
    "direction",
    "navigation",
    "fork",
    "left",
  ]);
});

test("promoteStablePrefixBatch2Suggestion promotes search profile and removes app-browser noise", () => {
  const result = promoteStablePrefixBatch2Suggestion({
    itemId: "search-check",
    decision: "review_required",
    confidence: 0.99,
    suggestedTags: ["check", "apps", "browser", "explore", "find", "search", "window", "confirm"],
  });

  assert.equal(result.promote, true);
  assert.deepEqual(result.suggestedTags, [
    "search",
    "find",
    "lookup",
    "check",
    "confirm",
  ]);
});

test("promoteStablePrefixBatch2Suggestion promotes menu profile and trims shape filler tags", () => {
  const result = promoteStablePrefixBatch2Suggestion({
    itemId: "menu-alternate-vertical",
    decision: "review_required",
    confidence: 0.99,
    suggestedTags: ["menu", "navigation", "button", "interface", "options", "circle", "dots", "app", "ellipsis", "dropdown", "hamburger", "horizontal"],
  });

  assert.equal(result.promote, true);
  assert.deepEqual(result.suggestedTags, [
    "menu",
    "navigation",
    "options",
    "interface",
    "alternate",
    "vertical",
  ]);
});

test("promoteStablePrefixBatch2Suggestion rejects unsupported prefix or low confidence", () => {
  assert.equal(
    promoteStablePrefixBatch2Suggestion({
      itemId: "watch-circle-download",
      decision: "review_required",
      confidence: 0.99,
      suggestedTags: ["download"],
    }).promote,
    false,
  );
  assert.equal(
    promoteStablePrefixBatch2Suggestion({
      itemId: "search-circle",
      decision: "review_required",
      confidence: 0.88,
      suggestedTags: ["search"],
    }).promote,
    false,
  );
});

test("promoteStreamlineStablePrefixBatch2Suggestions emits auto_accept suggestions for batch2 prefixes", () => {
  const report = promoteStreamlineStablePrefixBatch2Suggestions({
    family: "micro-solid",
    suggestions: [
      {
        itemId: "navigation-arrow-west",
        slug: "navigation-arrow-west",
        decision: "review_required",
        confidence: 0.77,
        suggestedTags: ["arrow", "direction", "dashed", "forward", "point", "backward", "click", "cursor", "guide", "interface", "left", "mouse"],
      },
      {
        itemId: "search-text",
        slug: "search-text",
        decision: "review_required",
        confidence: 0.99,
        suggestedTags: ["text", "app", "interface", "navigation", "explore", "find", "search"],
      },
      {
        itemId: "menu-line-1",
        slug: "menu-line-1",
        decision: "review_required",
        confidence: 0.99,
        suggestedTags: ["menu", "navigation", "button", "interface", "options", "circle"],
      },
      {
        itemId: "watch-circle-download",
        slug: "watch-circle-download",
        decision: "review_required",
        confidence: 0.99,
        suggestedTags: ["download"],
      },
    ],
  });

  assert.equal(report.summary.promotedCount, 3);
  assert.equal(report.promotedSuggestions[0].decision, "auto_accept");
  assert.equal(report.audit[3].reason, "unsupported_prefix");
});
