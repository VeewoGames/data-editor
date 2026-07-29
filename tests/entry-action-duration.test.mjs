import test from "node:test";
import assert from "node:assert/strict";
import { formatEntryActionElapsedDuration } from "../src/entry-action-duration.ts";

test("formatEntryActionElapsedDuration renders a stable running duration", () => {
  assert.equal(formatEntryActionElapsedDuration("2026-07-28T02:00:00.000Z", Date.parse("2026-07-28T02:01:09.000Z")), "已运行 1:09");
  assert.equal(formatEntryActionElapsedDuration("2026-07-28T00:00:00.000Z", Date.parse("2026-07-28T02:01:09.000Z")), "已运行 2:01:09");
  assert.equal(formatEntryActionElapsedDuration("invalid"), null);
});
