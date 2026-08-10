import assert from "node:assert/strict";
import test from "node:test";
import { entryActionHttpStatus } from "../src/entry-action-http-error.mjs";

test("entry action HTTP errors use stable domain status classes", () => {
  assert.equal(entryActionHttpStatus({ code: "EXACT_ARTIFACT_REQUEST_INVALID", status: 409 }), 400);
  assert.equal(entryActionHttpStatus({ code: "CANDIDATE_CREATE_SCHEMA_INVALID" }), 400);
  assert.equal(entryActionHttpStatus({ code: "EXACT_ARTIFACT_RECEIPT_INVALID", status: 400 }), 409);
  assert.equal(entryActionHttpStatus({ code: "EXACT_ARTIFACT_DIGEST_MISMATCH" }), 409);
  assert.equal(entryActionHttpStatus({ code: "CANDIDATE_CREATE_AUTHORITY_STALE" }), 409);
  assert.equal(entryActionHttpStatus({ code: "CANDIDATE_CREATE_CANDIDATE_ID_INVALID" }), 400);
  assert.equal(entryActionHttpStatus({ code: "CANDIDATE_CREATE_IDENTITY_ALLOCATION_FAILED", status: 409 }), 500);
  assert.equal(entryActionHttpStatus({ code: "CANDIDATE_CREATE_IDEMPOTENCY_CONFLICT" }), 409);
  assert.equal(entryActionHttpStatus({ code: "CANDIDATE_CREATE_SERVER_ALLOCATION_UNAVAILABLE" }), 500);
  assert.equal(entryActionHttpStatus({ code: "COMMIT_JOURNAL_INVALID" }), 500);
  assert.equal(entryActionHttpStatus({ code: "ENTRY_ACTION_FUTURE_UNKNOWN" }), 500);
  assert.equal(entryActionHttpStatus({ code: "ENTRY_ACTION_PROJECT_UNKNOWN", status: 409 }), 404);
  assert.equal(entryActionHttpStatus({ code: "PROJECT_TRANSACTION_RESULT_INVALID" }), 400);
  assert.equal(entryActionHttpStatus({ code: "PROJECT_TRANSACTION_SUBJECT_STALE" }), 409);
  assert.equal(entryActionHttpStatus({ code: "PROJECT_TRANSACTION_TIMEOUT" }), 500);
  assert.equal(entryActionHttpStatus({ code: "SOME_OTHER_NOT_FOUND", status: 404 }), 404);
});
