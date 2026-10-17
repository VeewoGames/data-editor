import assert from "node:assert/strict";
import test from "node:test";
import { resolveResultOnlyStatus, proposalResultStatuses } from "../src/entry-action-result-status.mjs";
import { presentEntryActionResult } from "../src/entry-action-result-presentation.mjs";

for (const status of ["completed", "no_changes", "failed", "blocked", "stopped", "evidence_insufficient", "changes_required", "approved", "checked", "passed", "rejected"]) {
  test(`recognized structured result ${status} has a truthful presentation`, () => {
    assert.equal(resolveResultOnlyStatus({ status }), status);
    const ui = presentEntryActionResult({ outcome: status === "failed" ? "failed" : "completed_without_changes", resultOnly: true, resultStatus: status, message: "Successful completed analysis" }, "Review");
    if (["failed", "blocked", "stopped", "evidence_insufficient", "changes_required", "rejected"].includes(status)) { assert.notEqual(ui.tone, "success"); assert.doesNotMatch(ui.title, /已完成/); }
    else assert.equal(ui.tone, "success");
  });
}

test("formal review aliases are validated without reading natural-language summaries", () => {
  assert.equal(resolveResultOnlyStatus({ result: { designVerdict: "approved" } }), "approved");
  assert.equal(resolveResultOnlyStatus({ status: "completed", result: { verdict: "failed" } }), "failed");
  assert.equal(resolveResultOnlyStatus({ designVerdict: "evidence_insufficient", summary: "all done" }), "evidence_insufficient");
  for (const result of [{}, { status: "invented" }, { status: null }, { status: "completed", result: { designVerdict: "unknown" } }]) assert.throws(() => resolveResultOnlyStatus(result), { code: "PROJECT_SKILL_RESULT_INVALID" });
});

test("partial write shows saved modifications and unresolved task; legacy write remains normal", () => {
  const presentation = presentEntryActionResult({ outcome: "completed_with_writeback", resultStatus: "blocked", message: "All work complete" }, "设计");
  assert.equal(presentation.tone, "warning"); assert.equal(presentation.title, "已保存部分修改，设计未完成");
  assert.equal(presentEntryActionResult({ outcome: "completed_with_writeback" }, "其他动作"), null);
  assert.equal(presentEntryActionResult({ outcome: "completed_without_changes", resultOnly: true, resultStatus: "unrecognized" }, "检查").tone, "warning");
});
