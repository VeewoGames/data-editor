import test from "node:test";
import assert from "node:assert/strict";
import { promoteReviewRequiredSuggestion, promoteStreamlineReviewRequiredSuggestions } from "../../scripts/streamline-export/promote-streamline-review-required.mjs";

test("promoteReviewRequiredSuggestion upgrades suggestions with dual evidence and multi-token semantic coverage", () => {
  const result = promoteReviewRequiredSuggestion({
    itemId: "mail-send-email",
    decision: "review_required",
    confidence: 0.77,
    suggestedTags: ["email", "envelope", "message", "communication", "mail", "inbox", "send"],
    evidence: {
      nameNeighbors: [{ itemId: "email-forward" }, { itemId: "email-all-stacked" }],
      imageNeighbors: [{ itemId: "email-forward" }, { itemId: "email-all-stacked" }],
    },
  });

  assert.equal(result.promote, true);
  assert.equal(result.reason, "promoted");
  assert.deepEqual(result.coveredTokens, ["mail", "send", "email"]);
});

test("promoteReviewRequiredSuggestion rejects semantic drift with blocked top tags", () => {
  const result = promoteReviewRequiredSuggestion({
    itemId: "sim-card",
    decision: "review_required",
    confidence: 0.77,
    suggestedTags: ["card", "payment", "credit", "transaction", "finance", "atm"],
    evidence: {
      nameNeighbors: [{ itemId: "atm-card-1" }, { itemId: "atm-card-2" }],
      imageNeighbors: [{ itemId: "atm-card-1" }, { itemId: "atm-card-2" }],
    },
  });

  assert.equal(result.promote, false);
  assert.equal(result.reason, "insufficient_semantic_coverage");
});

test("promoteStreamlineReviewRequiredSuggestions emits promoted auto_accept suggestions and audit summary", () => {
  const report = promoteStreamlineReviewRequiredSuggestions({
    family: "micro-solid",
    suggestions: [
      {
        itemId: "mail-send-email",
        slug: "mail-send-email",
        decision: "review_required",
        confidence: 0.77,
        suggestedTags: ["email", "envelope", "message", "communication", "mail", "inbox", "send"],
        evidence: {
          nameNeighbors: [{ itemId: "email-forward" }, { itemId: "email-all-stacked" }],
          imageNeighbors: [{ itemId: "email-forward" }, { itemId: "email-all-stacked" }],
        },
      },
      {
        itemId: "sim-card",
        slug: "sim-card",
        decision: "review_required",
        confidence: 0.77,
        suggestedTags: ["card", "payment", "credit", "transaction", "finance", "atm"],
        evidence: {
          nameNeighbors: [{ itemId: "atm-card-1" }, { itemId: "atm-card-2" }],
          imageNeighbors: [{ itemId: "atm-card-1" }, { itemId: "atm-card-2" }],
        },
      },
    ],
  });

  assert.equal(report.summary.reviewRequiredCount, 2);
  assert.equal(report.summary.promotedCount, 1);
  assert.equal(report.promotedSuggestions[0].decision, "auto_accept");
  assert.equal(report.audit[1].reason, "insufficient_semantic_coverage");
});
