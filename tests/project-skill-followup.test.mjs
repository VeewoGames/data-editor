import assert from "node:assert/strict";
import test from "node:test";
import { fork } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { startProjectSkillEntryAction } from "../src/project-skill-action-service.mjs";
import { recoverProjectSkillFollowups, resumeProjectSkillFollowup, readProjectSkillFollowup, cancelProjectSkillEntryAction, followupIdentity } from "../src/project-skill-followup.mjs";
import { assertProjectSkillRunCurrent, projectSkillCancellationPath, projectSkillConfigDigest } from "../src/project-skill-run-guard.mjs";
import { entryActionHandoffPath, entryActionsRuntimeDir, writeEntryActionHandoff, writeEntryActionStarted, publishEntryActionResultIdempotently, readEntryActionResult } from "../src/entry-actions.mjs";
import { loadAutomationProfile, validateAutomationProfile } from "../src/automation-profile.mjs";
import { loadAutomationBindings } from "../src/automation-bindings.mjs";
import { rowDigest } from "../src/row-digest.mjs";

const target = { sourcePath: "data/items.json", collectionPath: "$", rowId: "row-1" };
const rule = (id) => ({ id, label: id, icon: "refresh", enabled: true, targets: [{ file: target.sourcePath, collection: "$" }], payload: { includeRow: true, includeNeighbors: false }, execution: { kind: "project-skill", resultPolicy: "proposal" }, contractId: `fixture.${id}` });

async function fixture(t, parentStatus = "no_changes", childStatus = "evidence_insufficient") {
  const root = await mkdtemp(path.join(os.tmpdir(), "followup-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, ".data-editor")); await mkdir(path.join(root, "data"));
  const profile = { rules: [{ ...rule("design"), followup: { actionId: "review", on: ["completed_with_writeback", "no_changes"] } }, rule("review")] };
  const context = { projectRoot: root, projectId: "fixture", automationProfilePath: path.join(root, ".data-editor", "automation-profile.json"), localAutomationBindingsPath: path.join(root, ".data-editor", "bindings.json") };
  await writeFile(context.automationProfilePath, JSON.stringify(profile));
  await writeFile(context.localAutomationBindingsPath, JSON.stringify({ defaults: {}, bindings: { design: { provider: "codex", skill: "design" }, review: { provider: "codex", skill: "review" } } }));
  await writeFile(path.join(root, "SKILL.md"), "# Fixture");
  await writeFile(path.join(root, target.sourcePath), JSON.stringify([{ __entry_id: target.rowId, value: 1 }]));
  const calls = [];
  const supervisor = { async start(spec) {
    const prompt = await readFile(spec.args[spec.args.indexOf("--prompt") + 1], "utf8");
    const id = JSON.parse(prompt.split("## Data Editor handoff\n")[1].split("\n\nIf an execution")[0]).action.id;
    calls.push(id);
    if (id === "review") assert.ok(prompt.includes('"value": 2') || parentStatus === "no_changes");
    const reply = id === "design" && parentStatus === "write" ? { kind: "entry-action-proposal", changes: [], textArtifact: { afterContent: "new" }, summary: "updated", evidence: [] }
      : { kind: "project-skill-result", resultOnly: true, status: id === "design" ? parentStatus : childStatus, summary: id };
    await writeFile(spec.args[spec.args.indexOf("--reply") + 1], JSON.stringify(reply));
    return { completion: Promise.resolve({ exitCode: 0, timedOut: false }) };
  } };
  const dependencies = { resolveBindingStatus: async () => ({ status: "ready", skillPath: path.join(root, "SKILL.md"), codexCliPath: process.execPath }), submitProposalResult: async ({ request, runId }) => {
    const value = JSON.parse(await readFile(path.join(root, target.sourcePath), "utf8"));
    if (request.actionId === "review") assert.equal(request.expectedRowDigest, rowDigest(value[0]));
    value[0].value = 2; await writeFile(path.join(root, target.sourcePath), JSON.stringify(value));
    await publishEntryActionResultIdempotently(context, runId, { runId, actionId: request.actionId, phase: "terminal", outcome: "completed_with_writeback", message: "updated" });
    return { runId, kind: "entry-action-proposal" };
  } };
  const startChild = ({ request, childRunId, parentRunId, configDigest }) => startProjectSkillEntryAction({ projectContext: context, project: { id: "fixture" }, request, toolRoot: process.cwd(), jobSupervisor: supervisor, dependencies: { ...dependencies, followupRunId: childRunId, parentRunId, followupConfigDigest: configDigest } });
  const start = () => startProjectSkillEntryAction({ projectContext: context, project: { id: "fixture" }, request: { ...target, actionId: "design" }, toolRoot: process.cwd(), jobSupervisor: supervisor, dependencies });
  return { root, context, profile, calls, start, startChild };
}

async function waitTerminal(context, runId) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const intent = await readProjectSkillFollowup(context, runId);
    if (["completed", "stopped"].includes(intent?.state)) return intent;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail("followup did not reach a terminal state");
}

for (const status of ["write", "no_changes"]) {
  test(`parent ${status} triggers one independent child with latest canonical row`, async (t) => {
    const f = await fixture(t, status);
    const started = await f.start(); await started.completion;
    const intent = await waitTerminal(f.context, started.runId);
    assert.equal(intent.state, "completed"); assert.equal(intent.childResultStatus, "evidence_insufficient");
    assert.deepEqual(f.calls, ["design", "review"]);
    const child = JSON.parse(await readFile(entryActionHandoffPath(f.context, intent.childRunId), "utf8"));
    assert.equal(child.projectSkillLifecycle.parentRunId, started.runId); assert.equal(child.entry.row.value, status === "write" ? 2 : 1);
    await Promise.all([recoverProjectSkillFollowups({ projectContext: f.context, startChild: f.startChild }), recoverProjectSkillFollowups({ projectContext: f.context, startChild: f.startChild })]);
    assert.deepEqual(f.calls, ["design", "review"]);
    // Parent publication survived but pending intent was lost; the exact child receipt repairs it.
    await rm(path.join(entryActionsRuntimeDir(f.context), `${started.runId}.followup.json`));
    await recoverProjectSkillFollowups({ projectContext: f.context, startChild: f.startChild });
    assert.equal((await readProjectSkillFollowup(f.context, started.runId)).childRunId, intent.childRunId);
    assert.deepEqual(f.calls, ["design", "review"]);
  });
}

test("child failure preserves a committed parent and exposes failure", async (t) => {
  const f = await fixture(t, "write", "failed"); const started = await f.start(); await started.completion;
  const intent = await waitTerminal(f.context, started.runId);
  assert.equal(intent.childOutcome, "failed"); assert.equal((await readEntryActionResult(f.context, started.runId)).outcome, "completed_with_writeback");
  assert.equal(JSON.parse(await readFile(path.join(f.root, target.sourcePath), "utf8"))[0].value, 2);
});

for (const status of ["evidence_insufficient", "failed", "stopped"]) {
  test(`parent ${status} does not dispatch a followup`, async (t) => {
    const f = await fixture(t, status); const started = await f.start(); await started.completion;
    assert.equal(await readProjectSkillFollowup(f.context, started.runId), null); assert.deepEqual(f.calls, ["design"]);
  });
}

async function publishedParent(f, runId = "10000000-0000-4000-8000-000000000001") {
  const [profile, bindings] = await Promise.all([loadAutomationProfile(f.context), loadAutomationBindings(f.context)]);
  await writeEntryActionHandoff(f.context, runId, { runId, action: { id: "design" }, entry: target, projectSkillLifecycle: { configDigest: projectSkillConfigDigest(profile, bindings), followup: profile.rules[0].followup } });
  await publishEntryActionResultIdempotently(f.context, runId, { runId, actionId: "design", phase: "terminal", outcome: "completed_with_writeback" });
  return runId;
}

for (const mode of ["cancel", "config", "binding", "intent", "accepted", "child-published"]) {
  test(`recover followup across ${mode} checkpoint without duplicate execution`, async (t) => {
    const f = await fixture(t); const runId = await publishedParent(f);
    const identity = followupIdentity(runId, "review", target);
    if (mode === "cancel") await cancelProjectSkillEntryAction(f.context, runId);
    if (mode === "config") { f.profile.rules[0].label = "Changed"; await writeFile(f.context.automationProfilePath, JSON.stringify(f.profile)); }
    if (mode === "binding") await writeFile(f.context.localAutomationBindingsPath, JSON.stringify({ defaults: {}, bindings: {} }));
    if (["intent", "accepted", "child-published"].includes(mode)) {
      const handoff = JSON.parse(await readFile(entryActionHandoffPath(f.context, runId), "utf8"));
      await writeFile(path.join(entryActionsRuntimeDir(f.context), `${runId}.followup.json`), JSON.stringify({ version: 1, parentRunId: runId, actionId: "review", ...identity, configDigest: handoff.projectSkillLifecycle.configDigest, target, trigger: "completed_with_writeback", state: "launching" }));
    }
    if (mode === "accepted") await writeEntryActionStarted(f.context, identity.childRunId, { runId: identity.childRunId, actionId: "review", phase: "queued", outcome: null });
    if (mode === "child-published") await publishEntryActionResultIdempotently(f.context, identity.childRunId, { runId: identity.childRunId, actionId: "review", phase: "terminal", outcome: "completed_without_changes", resultStatus: "evidence_insufficient" });
    await recoverProjectSkillFollowups({ projectContext: f.context, startChild: f.startChild });
    const intent = ["intent"].includes(mode) ? await waitTerminal(f.context, runId) : await readProjectSkillFollowup(f.context, runId);
    assert.equal(intent.state, ["intent", "child-published"].includes(mode) ? "completed" : "stopped");
    assert.deepEqual(f.calls, mode === "intent" ? ["review"] : []);
    if (mode === "accepted") assert.ok(await readFile(projectSkillCancellationPath(f.context, identity.childRunId), "utf8"));
    assert.equal((await readEntryActionResult(f.context, runId)).outcome, "completed_with_writeback");
  });
}

test("followup config rejects cycles, unknown targets and non project-skill children", () => {
  const parent = { ...rule("design"), followup: { actionId: "review", on: ["no_changes"] } };
  assert.throws(() => validateAutomationProfile({ rules: [parent] }), /existing project-skill/);
  assert.throws(() => validateAutomationProfile({ rules: [parent, { ...rule("review"), followup: { actionId: "design", on: ["no_changes"] } }] }), /another followup/);
  assert.throws(() => validateAutomationProfile({ rules: [{ ...parent, followup: { actionId: "design", on: ["no_changes"] } }] }), /Invalid followup/);
});


test("cancelling an active child prevents proposal admission and preserves the parent", async (t) => {
  const f = await fixture(t, "write"); const parentRunId = await publishedParent(f);
  const identity = followupIdentity(parentRunId, "review", target);
  const parent = JSON.parse(await readFile(entryActionHandoffPath(f.context, parentRunId), "utf8"));
  let resolveCompletion, acceptedHost, terminateCalls = 0;
  const hostAccepted = new Promise((resolve) => { acceptedHost = resolve; });
  const supervisor = { async start(spec) {
    await writeFile(spec.args[spec.args.indexOf("--reply") + 1], JSON.stringify({ kind: "entry-action-proposal", changes: [], textArtifact: { afterContent: "new" }, summary: "review", evidence: [] }));
    const completion = new Promise((resolve) => { resolveCompletion = resolve; });
    acceptedHost();
    return { completion, terminate: async () => { terminateCalls++; resolveCompletion({ exitCode: 0, timedOut: false }); } };
  } };
  const child = await startProjectSkillEntryAction({ projectContext: f.context, project: { id: "fixture" }, request: { ...target, actionId: "review" }, toolRoot: process.cwd(), jobSupervisor: supervisor, dependencies: { followupRunId: identity.childRunId, parentRunId, followupConfigDigest: parent.projectSkillLifecycle.configDigest, resolveBindingStatus: async () => ({ status: "ready", skillPath: path.join(f.root, "SKILL.md"), codexCliPath: process.execPath }), submitProposalResult: async () => assert.fail("cancelled child must never submit") } });
  await hostAccepted;
  // Wait for the service to bind its supervisor handle before cancellation.
  await new Promise((resolve) => setTimeout(resolve, 0));
  const rejected = assert.rejects(child.completion, { code: "PROJECT_SKILL_CANCELLED" });
  await cancelProjectSkillEntryAction(f.context, identity.childRunId);
  await rejected;
  assert.equal(terminateCalls, 1);
  assert.equal((await readEntryActionResult(f.context, parentRunId)).outcome, "completed_with_writeback");
  assert.equal(JSON.parse(await readFile(path.join(f.root, target.sourcePath), "utf8"))[0].value, 1);
});

test("config drift at child commit admission is rejected against the frozen parent config", async (t) => {
  const f = await fixture(t); const parentRunId = await publishedParent(f);
  const parent = JSON.parse(await readFile(entryActionHandoffPath(f.context, parentRunId), "utf8"));
  const identity = followupIdentity(parentRunId, "review", target);
  await writeEntryActionHandoff(f.context, identity.childRunId, { runId: identity.childRunId, projectSkillLifecycle: { parentRunId, configDigest: parent.projectSkillLifecycle.configDigest } });
  f.profile.rules[1].enabled = false; await writeFile(f.context.automationProfilePath, JSON.stringify(f.profile));
  await assert.rejects(assertProjectSkillRunCurrent(f.context, identity.childRunId), { code: "PROJECT_SKILL_CONFIG_STALE" });
});


test("two independent service processes accept and execute only one child through the durable started CAS", async (t) => {
  const f = await fixture(t); const parentRunId = await publishedParent(f);
  const workers = [0, 1].map(() => fork(new URL("./fixtures/project-skill-followup-owner.mjs", import.meta.url), [f.root, parentRunId], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true }));
  t.after(() => { for (const worker of workers) worker.kill(); });
  const ready = workers.map((worker) => new Promise((resolve, reject) => {
    worker.on("message", (message) => { if (message.type === "ready") resolve(); if (message.type === "error") reject(new Error(message.message)); });
    worker.once("error", reject);
  }));
  const completed = workers.map((worker) => new Promise((resolve, reject) => {
    worker.on("message", (message) => { if (message.type === "done") resolve(message.intent); if (message.type === "error") reject(new Error(message.message)); });
    worker.once("error", reject);
  }));
  await Promise.all(ready);
  for (const worker of workers) worker.send({ type: "start" });
  await Promise.all(completed);
  const intent = await waitTerminal(f.context, parentRunId);
  assert.equal(intent.state, "completed"); assert.equal(intent.childResultStatus, "evidence_insufficient");
  assert.equal((await readFile(path.join(f.root, "model-starts.log"), "utf8")).trim().split("\n").length, 1);
  assert.equal((await readEntryActionResult(f.context, parentRunId)).outcome, "completed_with_writeback");
});

test("a live accepted child owned by another service is not cancelled by polling recovery", async (t) => {
  const f = await fixture(t); const parentRunId = await publishedParent(f);
  const identity = followupIdentity(parentRunId, "review", target);
  await writeEntryActionStarted(f.context, identity.childRunId, { runId: identity.childRunId, actionId: "review", phase: "queued", outcome: null, ownerPid: process.pid });
  const intent = await resumeProjectSkillFollowup({ projectContext: f.context, parentRunId, startChild: async () => assert.fail("already accepted") });
  assert.equal(intent.state, "pending");
  await assert.rejects(readFile(projectSkillCancellationPath(f.context, identity.childRunId)), { code: "ENOENT" });
});
