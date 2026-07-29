import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import {
  assertEntryActionEligible,
  loadEntryActionEligibility,
} from "../src/entry-action-eligibility.mjs";

test("eligibility is an explicit project/action proposal-only allowlist", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "entry-eligibility-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, ".data-editor"));
  await writeFile(path.join(root, ".data-editor", "entry-action-eligibility.json"), JSON.stringify({
    version: 1,
    protocolMode: "proposal-only",
    actions: ["fixture-rename"],
  }));
  const eligibility = await loadEntryActionEligibility(root);
  assert.equal(assertEntryActionEligible(eligibility, "fixture-rename"), true);
  assert.throws(() => assertEntryActionEligible(eligibility, "other"), { code: "ENTRY_ACTION_PROTOCOL_DISABLED" });
});

test("missing or malformed eligibility remains fail-closed", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "entry-eligibility-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(() => loadEntryActionEligibility(root), { code: "ENTRY_ACTION_PROTOCOL_DISABLED" });
  await mkdir(path.join(root, ".data-editor"));
  await writeFile(path.join(root, ".data-editor", "entry-action-eligibility.json"), '{"version":1,"protocolMode":"proposal-only","actions":[]}');
  await assert.rejects(() => loadEntryActionEligibility(root), { code: "ENTRY_ACTION_PROTOCOL_DISABLED" });
});
