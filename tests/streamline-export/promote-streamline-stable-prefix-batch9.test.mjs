import test from "node:test";
import assert from "node:assert/strict";
import {
  promoteStablePrefixBatch9Suggestion,
  promoteStreamlineStablePrefixBatch9Suggestions,
} from "../../scripts/streamline-export/promote-streamline-stable-prefix-batch9.mjs";

test("promoteStablePrefixBatch9Suggestion promotes shopping bag and cart action variants", () => {
  assert.deepEqual(
    promoteStablePrefixBatch9Suggestion({
      itemId: "shopping-bag",
      decision: "review_required",
      suggestedTags: ["bag", "checkout"],
    }).suggestedTags,
    ["shopping", "bag", "commerce"],
  );

  assert.deepEqual(
    promoteStablePrefixBatch9Suggestion({
      itemId: "shopping-cart-add",
      decision: "review_required",
      suggestedTags: ["cart", "add"],
    }).suggestedTags,
    ["shopping", "cart", "checkout", "commerce", "add", "plus"],
  );
});

test("promoteStablePrefixBatch9Suggestion promotes subtract and unload variants", () => {
  assert.deepEqual(
    promoteStablePrefixBatch9Suggestion({
      itemId: "shopping-cart-subtract",
      decision: "review_required",
      suggestedTags: ["cart", "subtract"],
    }).suggestedTags,
    ["shopping", "cart", "checkout", "commerce", "subtract", "minus"],
  );

  assert.deepEqual(
    promoteStablePrefixBatch9Suggestion({
      itemId: "shopping-cart-unload",
      decision: "review_required",
      suggestedTags: ["cart", "unload"],
    }).suggestedTags,
    ["shopping", "cart", "checkout", "commerce", "unload"],
  );
});

test("promoteStreamlineStablePrefixBatch9Suggestions emits auto_accept suggestions for shopping prefixes", () => {
  const report = promoteStreamlineStablePrefixBatch9Suggestions({
    family: "micro-solid",
    suggestions: [
      { itemId: "shopping-cart-check", slug: "shopping-cart-check", decision: "review_required", suggestedTags: ["cart", "check"] },
      { itemId: "shopping-basket-remove", slug: "shopping-basket-remove", decision: "review_required", suggestedTags: ["basket", "remove"] },
      { itemId: "user-add", slug: "user-add", decision: "review_required", suggestedTags: ["user"] },
    ],
  });

  assert.equal(report.summary.promotedCount, 2);
  assert.equal(report.promotedSuggestions[0].promotedBy, "stable_prefix_batch9");
  assert.equal(report.audit[2].reason, "unsupported_prefix");
});
