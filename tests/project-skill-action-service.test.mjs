import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assertProjectSkillResultPolicy, startProjectSkillEntryAction } from "../src/project-skill-action-service.mjs";
import { entryActionOutputPath, readEntryActionResult, readEntryActionStarted } from "../src/entry-actions.mjs";

test("project-skill proposal envelope may not carry model-authored humanNotes", () => {
  assert.throws(() => assertProjectSkillResultPolicy({ kind: "candidate-create", manifest: {}, humanNotes: { field: "dev_note", text: "forged" } }, "proposal"), { code: "PROJECT_SKILL_RESULT_INVALID" });
});

async function fixture(t, result = { kind: "project-skill-result", resultOnly: true, status: "checked" }) {
  const root = await mkdtemp(path.join(os.tmpdir(), "project-skill-service-")); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, ".data-editor"), { recursive: true });
  await writeFile(path.join(root, ".data-editor", "automation-profile.json"), JSON.stringify({ rules: [{ id: "verify", label: "Verify", icon: "refresh", targets: [{ file: "data/a.json", collection: "items" }], payload: { includeRow: true, includeNeighbors: false }, execution: { kind: "project-skill", resultPolicy: "result-only" }, contractId: "fixture.verify.v1" }] }));
  await writeFile(path.join(root, ".data-editor", "local-automation-bindings.json"), JSON.stringify({ defaults: {}, bindings: { verify: { provider: "codex", skill: "verify" } } }));
  await writeFile(path.join(root, "SKILL.md"), "# fixture");
  const supervisor = { async start(spec) { await writeFile(spec.args[spec.args.indexOf("--reply") + 1], JSON.stringify(result)); return { completion: Promise.resolve({ exitCode: 0, timedOut: false }) }; } };
  return { root, supervisor };
}

test("project skill runs from its project root and publishes the result-only report", async (t) => {
  const { root, supervisor } = await fixture(t, {
    kind: "project-skill-result",
    resultOnly: true,
    status: "stopped",
    summary: "Review evidence is incomplete.",
  });
  const started = await startProjectSkillEntryAction({ projectContext: { projectRoot: root, automationProfilePath: path.join(root, ".data-editor", "automation-profile.json"), localAutomationBindingsPath: path.join(root, ".data-editor", "local-automation-bindings.json") }, project: { id: "fixture" }, request: { actionId: "verify", sourcePath: "data/a.json" }, toolRoot: process.cwd(), jobSupervisor: supervisor, dependencies: { resolveBindingStatus: async () => ({ status: "ready", skillPath: path.join(root, "SKILL.md"), codexCliPath: process.execPath }) } });
  assert.equal((await readEntryActionStarted({ projectRoot: root }, started.runId)).phase, "running");
  const result = await started.completion;
  assert.equal(result.resultOnly, true);
  const terminal = await readEntryActionResult({ projectRoot: root }, started.runId);
  assert.equal(terminal.outcome, "completed_without_changes");
  assert.equal(terminal.message, "Review evidence is incomplete.");
  assert.equal(terminal.resultOnly, true);
  assert.equal(terminal.resultStatus, "stopped");
  assert.equal(terminal.outputPath, entryActionOutputPath({ projectRoot: root }, started.runId));
  assert.deepEqual(JSON.parse(await readFile(terminal.outputPath, "utf8")), result);
});

test("project skill rejects a non-result-only reply", async (t) => {
  const { root, supervisor } = await fixture(t, { kind: "proposal" });
  const started = await startProjectSkillEntryAction({ projectContext: { projectRoot: root, automationProfilePath: path.join(root, ".data-editor", "automation-profile.json"), localAutomationBindingsPath: path.join(root, ".data-editor", "local-automation-bindings.json") }, project: { id: "fixture" }, request: { actionId: "verify" }, toolRoot: process.cwd(), jobSupervisor: supervisor, dependencies: { resolveBindingStatus: async () => ({ status: "ready", skillPath: path.join(root, "SKILL.md"), codexCliPath: process.execPath }) } });
  await assert.rejects(started.completion, { code: "PROJECT_SKILL_RESULT_INVALID" });
  assert.equal((await readEntryActionResult({ projectRoot: root }, started.runId)).outcome, "failed");
});

test("project skill exposes a formal design verdict as the result status", async (t) => {
  const { root, supervisor } = await fixture(t, {
    kind: "project-skill-result",
    resultOnly: true,
    designVerdict: "evidence_insufficient",
    summary: "Design evidence is incomplete.",
  });
  const started = await startProjectSkillEntryAction({ projectContext: { projectRoot: root, automationProfilePath: path.join(root, ".data-editor", "automation-profile.json"), localAutomationBindingsPath: path.join(root, ".data-editor", "local-automation-bindings.json") }, project: { id: "fixture" }, request: { actionId: "verify" }, toolRoot: process.cwd(), jobSupervisor: supervisor, dependencies: { resolveBindingStatus: async () => ({ status: "ready", skillPath: path.join(root, "SKILL.md"), codexCliPath: process.execPath }) } });
  await started.completion;
  const terminal = await readEntryActionResult({ projectRoot: root }, started.runId);
  assert.equal(terminal.resultStatus, "evidence_insufficient");
});

test("project skill exposes a nested formal review result", async (t) => {
  const { root, supervisor } = await fixture(t, {
    kind: "project-skill-result",
    resultOnly: true,
    result: {
      designVerdict: "changes_required",
      summary: "The design needs revision.",
    },
  });
  const started = await startProjectSkillEntryAction({ projectContext: { projectRoot: root, automationProfilePath: path.join(root, ".data-editor", "automation-profile.json"), localAutomationBindingsPath: path.join(root, ".data-editor", "local-automation-bindings.json") }, project: { id: "fixture" }, request: { actionId: "verify" }, toolRoot: process.cwd(), jobSupervisor: supervisor, dependencies: { resolveBindingStatus: async () => ({ status: "ready", skillPath: path.join(root, "SKILL.md"), codexCliPath: process.execPath }) } });
  await started.completion;
  const terminal = await readEntryActionResult({ projectRoot: root }, started.runId);
  assert.equal(terminal.resultStatus, "changes_required");
  assert.equal(terminal.message, "The design needs revision.");
});

test("project skill mutates only its disposable input snapshot and preserves canonical sentinel", async (t) => {
  const { root } = await fixture(t);
  const sentinel = path.join(root, "canonical-sentinel.txt");
  await writeFile(sentinel, "canonical", "utf8");
  const supervisor = {
    async start(spec) {
      const inputRoot = spec.args[spec.args.indexOf("--input-root") + 1];
      const reply = spec.args[spec.args.indexOf("--reply") + 1];
      await writeFile(path.join(inputRoot, "canonical-sentinel.txt"), "attempted mutation", "utf8");
      await writeFile(reply, JSON.stringify({ kind: "project-skill-result", resultOnly: true, status: "checked" }));
      return { completion: Promise.resolve({ exitCode: 0, timedOut: false }) };
    },
  };
  const started = await startProjectSkillEntryAction({ projectContext: { projectRoot: root, automationProfilePath: path.join(root, ".data-editor", "automation-profile.json"), localAutomationBindingsPath: path.join(root, ".data-editor", "local-automation-bindings.json") }, project: { id: "fixture" }, request: { actionId: "verify" }, toolRoot: process.cwd(), jobSupervisor: supervisor, dependencies: { resolveBindingStatus: async () => ({ status: "ready", skillPath: path.join(root, "SKILL.md"), codexCliPath: process.execPath }) } });
  await started.completion;
  assert.equal(await readFile(sentinel, "utf8"), "canonical");
});

test("project-skill proposal is handed to the server admission dependency", async (t) => {
  const { root, supervisor } = await fixture(t, { kind: "candidate-create", version: 1 });
  const profilePath = path.join(root, ".data-editor", "automation-profile.json");
  const profile = JSON.parse(await readFile(profilePath, "utf8"));
  profile.rules[0].execution.resultPolicy = "proposal";
  await writeFile(profilePath, JSON.stringify(profile));
  let admitted = null;
  const started = await startProjectSkillEntryAction({ projectContext: { projectRoot: root, automationProfilePath: profilePath, localAutomationBindingsPath: path.join(root, ".data-editor", "local-automation-bindings.json") }, project: { id: "fixture" }, request: { actionId: "verify" }, toolRoot: process.cwd(), jobSupervisor: supervisor, dependencies: { resolveBindingStatus: async () => ({ status: "ready", skillPath: path.join(root, "SKILL.md"), codexCliPath: process.execPath }), submitProposalResult: async (value) => { admitted = value; return { admitted: true }; } } });
  assert.deepEqual(await started.completion, { admitted: true });
  assert.equal(admitted.result.kind, "candidate-create");
  assert.equal(admitted.runId, started.runId);
});

test("project-skill proposal fails closed when server admission is unavailable", async (t) => {
  const { root, supervisor } = await fixture(t, { kind: "candidate-create", version: 1 });
  const profilePath = path.join(root, ".data-editor", "automation-profile.json");
  const profile = JSON.parse(await readFile(profilePath, "utf8")); profile.rules[0].execution.resultPolicy = "proposal"; await writeFile(profilePath, JSON.stringify(profile));
  const started = await startProjectSkillEntryAction({ projectContext: { projectRoot: root, automationProfilePath: profilePath, localAutomationBindingsPath: path.join(root, ".data-editor", "local-automation-bindings.json") }, project: { id: "fixture" }, request: { actionId: "verify" }, toolRoot: process.cwd(), jobSupervisor: supervisor, dependencies: { resolveBindingStatus: async () => ({ status: "ready", skillPath: path.join(root, "SKILL.md"), codexCliPath: process.execPath }) } });
  await assert.rejects(started.completion, { code: "PROJECT_SKILL_PROPOSAL_ADMISSION_UNAVAILABLE" });
});

test("project transaction publishes stable write and no-write terminal outcomes on the same run", async (t) => {
  for (const changed of [false, true]) {
    const { root, supervisor } = await fixture(t, { kind: "project-transaction-result", ownerId: "receipt-only-v1", capabilityId: "receipt-v1", subject: { sourcePath: "data/a.json", collectionPath: "items", rowId: "row", expectedRowDigest: "digest" }, payload: {}, summary: "Transaction complete" });
    const profilePath = path.join(root, ".data-editor", "automation-profile.json"); const profile = JSON.parse(await readFile(profilePath, "utf8"));
    profile.rules[0].execution = { kind: "project-skill", resultPolicy: "project-transaction", ownerId: "receipt-only-v1", capabilityId: "receipt-v1" }; await writeFile(profilePath, JSON.stringify(profile));
    const started = await startProjectSkillEntryAction({ projectContext: { projectRoot: root, automationProfilePath: profilePath, localAutomationBindingsPath: path.join(root, ".data-editor", "local-automation-bindings.json") }, project: { id: "fixture" }, request: { actionId: "verify", sourcePath: "data/a.json", collectionPath: "items" }, toolRoot: process.cwd(), jobSupervisor: supervisor, dependencies: { resolveBindingStatus: async () => ({ status: "ready", skillPath: path.join(root, "SKILL.md"), codexCliPath: process.execPath }), submitProjectTransactionResult: async ({ runId }) => ({ kind: "project-transaction", runId, changed, receipt: { ok: true }, message: "Transaction complete" }) } });
    const result = await started.completion; assert.equal(result.runId, started.runId);
    assert.equal((await readEntryActionResult({ projectRoot: root }, started.runId)).outcome, changed ? "completed_with_writeback" : "completed_without_changes");
  }
  const { root, supervisor } = await fixture(t, { kind: "project-transaction-result", ownerId: "receipt-only-v1", capabilityId: "receipt-v1", subject: { sourcePath: "data/a.json", collectionPath: "items", rowId: "row", expectedRowDigest: "digest" }, payload: {}, summary: "Transaction pending" });
  const profilePath = path.join(root, ".data-editor", "automation-profile.json"); const profile = JSON.parse(await readFile(profilePath, "utf8")); profile.rules[0].execution = { kind: "project-skill", resultPolicy: "project-transaction", ownerId: "receipt-only-v1", capabilityId: "receipt-v1" }; await writeFile(profilePath, JSON.stringify(profile));
  const pendingStarted = await startProjectSkillEntryAction({ projectContext: { projectRoot: root, automationProfilePath: profilePath, localAutomationBindingsPath: path.join(root, ".data-editor", "local-automation-bindings.json") }, project: { id: "fixture" }, request: { actionId: "verify", sourcePath: "data/a.json", collectionPath: "items" }, toolRoot: process.cwd(), jobSupervisor: supervisor, dependencies: { resolveBindingStatus: async () => ({ status: "ready", skillPath: path.join(root, "SKILL.md"), codexCliPath: process.execPath }), submitProjectTransactionResult: async ({ runId }) => ({ kind: "project-transaction", runId, pending: true, receipt: { state: "abort_unacknowledged" }, message: "pending" }) } });
  assert.equal((await pendingStarted.completion).pending, true); assert.equal((await readEntryActionStarted({ projectRoot: root }, pendingStarted.runId)).phase, "running"); await assert.rejects(() => readEntryActionResult({ projectRoot: root }, pendingStarted.runId), { code: "ENOENT" });
});

test("project snapshot rejects symbolic-link or junction input escape", async (t) => {
  const { root } = await fixture(t);
  const target = path.join(root, "linked-target"); const link = path.join(root, "linked-input"); await mkdir(target);
  try { await symlink(target, link, process.platform === "win32" ? "junction" : "dir"); }
  catch (error) { if (error?.code === "EPERM") return; throw error; }
  await assert.rejects(() => startProjectSkillEntryAction({ projectContext: { projectRoot: root, automationProfilePath: path.join(root, ".data-editor", "automation-profile.json"), localAutomationBindingsPath: path.join(root, ".data-editor", "local-automation-bindings.json") }, project: { id: "fixture" }, request: { actionId: "verify" }, toolRoot: process.cwd(), jobSupervisor: { start: async () => { throw new Error("must not start"); } }, dependencies: { resolveBindingStatus: async () => ({ status: "ready", skillPath: path.join(root, "SKILL.md"), codexCliPath: process.execPath }) } }), { code: "PROJECT_SKILL_INPUT_LINK_UNSUPPORTED" });
});
