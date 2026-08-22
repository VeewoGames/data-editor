import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assertProjectSkillResultPolicy, startProjectSkillEntryAction } from "../src/project-skill-action-service.mjs";
import { entryActionOutputPath, readEntryActionResult, readEntryActionStarted } from "../src/entry-actions.mjs";

test("project-skill proposal envelope requires strict evidence and may not carry model-authored humanNotes", () => {
  assert.doesNotThrow(() => assertProjectSkillResultPolicy({ kind: "candidate-create", manifest: {}, evidence: [] }, "proposal"));
  assert.throws(() => assertProjectSkillResultPolicy({ kind: "candidate-create", manifest: {} }, "proposal"), { code: "PROJECT_SKILL_RESULT_INVALID" });
  assert.throws(() => assertProjectSkillResultPolicy({ kind: "candidate-create", manifest: {}, evidence: [{ kind: "test", ref: "run/1", digest: "bad" }] }, "proposal"), { code: "PROJECT_SKILL_RESULT_INVALID" });
  assert.throws(() => assertProjectSkillResultPolicy({ kind: "candidate-create", manifest: {}, evidence: [], humanNotes: { field: "dev_note", text: "forged" } }, "proposal"), { code: "PROJECT_SKILL_RESULT_INVALID" });
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

test("project skill runs from its disposable snapshot and publishes the result-only report", async (t) => {
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
      const inputRoot = spec.args[spec.args.indexOf("--workspace-root") + 1];
      const reply = spec.args[spec.args.indexOf("--reply") + 1];
      assert.equal(path.relative(inputRoot, reply).startsWith(".."), false, "snapshot reply must remain writable below the snapshot workspace");
      const prompt = await readFile(spec.args[spec.args.indexOf("--prompt") + 1], "utf8");
      assert.match(prompt, /Use Codex's built-in shell tool/);
      await writeFile(path.join(inputRoot, "canonical-sentinel.txt"), "attempted mutation", "utf8");
      await writeFile(reply, JSON.stringify({ kind: "project-skill-result", resultOnly: true, status: "checked" }));
      return { completion: Promise.resolve({ exitCode: 0, timedOut: false }) };
    },
  };
  const started = await startProjectSkillEntryAction({ projectContext: { projectRoot: root, automationProfilePath: path.join(root, ".data-editor", "automation-profile.json"), localAutomationBindingsPath: path.join(root, ".data-editor", "local-automation-bindings.json") }, project: { id: "fixture" }, request: { actionId: "verify" }, toolRoot: process.cwd(), jobSupervisor: supervisor, dependencies: { resolveBindingStatus: async () => ({ status: "ready", skillPath: path.join(root, "SKILL.md"), codexCliPath: process.execPath }) } });
  await started.completion;
  assert.equal(await readFile(sentinel, "utf8"), "canonical");
});

test("project skill exposes a generic immutable-artifact publication context", async (t) => {
  const { root } = await fixture(t);
  let prompt = "";
  const supervisor = {
    async start(spec) {
      prompt = await readFile(spec.args[spec.args.indexOf("--prompt") + 1], "utf8");
      await writeFile(spec.args[spec.args.indexOf("--reply") + 1], JSON.stringify({ kind: "project-skill-result", resultOnly: true, status: "checked" }));
      return { completion: Promise.resolve({ exitCode: 0, timedOut: false }) };
    },
  };
  const started = await startProjectSkillEntryAction({
    projectContext: { projectRoot: root, automationProfilePath: path.join(root, ".data-editor", "automation-profile.json"), localAutomationBindingsPath: path.join(root, ".data-editor", "local-automation-bindings.json") },
    project: { id: "fixture" }, request: { actionId: "verify" }, toolRoot: process.cwd(), jobSupervisor: supervisor,
    dependencies: {
      resolveBindingStatus: async () => ({ status: "ready", skillPath: path.join(root, "SKILL.md"), codexCliPath: process.execPath }),
      projectSkillArtifactPublicationUrl: "http://127.0.0.1:8787/api/entry-actions/publish-exact-artifact",
    },
  });
  await started.completion;
  const invocation = JSON.parse(prompt.slice(prompt.lastIndexOf("\n{") + 1));
  assert.equal(invocation.execution.kind, "project-skill");
  assert.equal(invocation.artifactPublication.endpoint, "http://127.0.0.1:8787/api/entry-actions/publish-exact-artifact");
  assert.equal(invocation.artifactPublication.projectId, "fixture");
  assert.match(invocation.artifactPublication.artifactId, /^project-skill-/);
  assert.equal(invocation.artifactPublication.artifactPath, `.data-editor/runtime/entry-action-artifacts/${invocation.artifactPublication.artifactId}.json`);
});

test("project-write runs from the real project root and keeps diagnostics in scratch output", async (t) => {
  const { root } = await fixture(t);
  const profilePath = path.join(root, ".data-editor", "automation-profile.json");
  const profile = JSON.parse(await readFile(profilePath, "utf8"));
  profile.rules[0].execution = { kind: "project-skill", resultPolicy: "result-only", workspaceMode: "project-write" };
  await writeFile(profilePath, JSON.stringify(profile));
  let spec = null;
  const supervisor = {
    async start(nextSpec) {
      spec = nextSpec;
      await writeFile(path.join(root, "project-owned.txt"), "changed", "utf8");
      await writeFile(nextSpec.args[nextSpec.args.indexOf("--reply") + 1], JSON.stringify({ kind: "project-skill-result", resultOnly: true, status: "checked" }));
      return { completion: Promise.resolve({ exitCode: 0, timedOut: false }) };
    },
  };
  const started = await startProjectSkillEntryAction({
    projectContext: { projectRoot: root, automationProfilePath: profilePath, localAutomationBindingsPath: path.join(root, ".data-editor", "local-automation-bindings.json") },
    project: { id: "fixture" }, request: { actionId: "verify", sourcePath: "data/a.json", collectionPath: "items" }, toolRoot: process.cwd(), jobSupervisor: supervisor,
    dependencies: { resolveBindingStatus: async () => ({ status: "ready", skillPath: path.join(root, "SKILL.md"), codexCliPath: process.execPath }) },
  });
  await started.completion;
  assert.equal(spec.cwd, root);
  assert.equal(spec.args[spec.args.indexOf("--workspace-root") + 1], root);
  const outputRoot = spec.args[spec.args.indexOf("--output-root") + 1];
  assert.equal(path.relative(root, outputRoot).startsWith(".."), false, "project-write output must remain writable below the project workspace");
  assert.match(outputRoot, /\.data-editor[\\/]runtime[\\/]entry-actions[\\/]\.task-output[\\/]/);
  assert.equal(spec.args.includes("--ignore-rules"), false);
  assert.equal(await readFile(path.join(root, "project-owned.txt"), "utf8"), "changed");
});

test("project snapshot skips linked assistant-skill aliases without following them", async (t) => {
  const { root, supervisor } = await fixture(t);
  const skills = path.join(root, ".claude", "skills");
  const target = path.join(root, ".agents", "skills", "review");
  const alias = path.join(skills, "review");
  await mkdir(target, { recursive: true });
  await mkdir(skills, { recursive: true });
  try { await symlink(target, alias, process.platform === "win32" ? "junction" : "dir"); }
  catch (error) { if (["EPERM", "EACCES", "ENOSYS"].includes(error?.code)) return; throw error; }

  const started = await startProjectSkillEntryAction({
    projectContext: { projectRoot: root, automationProfilePath: path.join(root, ".data-editor", "automation-profile.json"), localAutomationBindingsPath: path.join(root, ".data-editor", "local-automation-bindings.json") },
    project: { id: "fixture" }, request: { actionId: "verify" }, toolRoot: process.cwd(), jobSupervisor: supervisor,
    dependencies: { resolveBindingStatus: async () => ({ status: "ready", skillPath: path.join(root, "SKILL.md"), codexCliPath: process.execPath }) },
  });
  await started.completion;
});

test("project-skill proposal is handed to the server admission dependency", async (t) => {
  const { root, supervisor } = await fixture(t, { kind: "candidate-create", version: 1, evidence: [] });
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

test("project-skill proposal policy accepts a no-change result without proposal admission", async (t) => {
  const result = {
    kind: "project-skill-result",
    resultOnly: true,
    status: "evidence_insufficient",
    summary: "Review evidence is incomplete.",
  };
  const { root, supervisor } = await fixture(t, result);
  const profilePath = path.join(root, ".data-editor", "automation-profile.json");
  const profile = JSON.parse(await readFile(profilePath, "utf8"));
  profile.rules[0].execution.resultPolicy = "proposal";
  await writeFile(profilePath, JSON.stringify(profile));
  const started = await startProjectSkillEntryAction({
    projectContext: { projectRoot: root, automationProfilePath: profilePath, localAutomationBindingsPath: path.join(root, ".data-editor", "local-automation-bindings.json") },
    project: { id: "fixture" }, request: { actionId: "verify" }, toolRoot: process.cwd(), jobSupervisor: supervisor,
    dependencies: { resolveBindingStatus: async () => ({ status: "ready", skillPath: path.join(root, "SKILL.md"), codexCliPath: process.execPath }) },
  });
  assert.deepEqual(await started.completion, result);
  const terminal = await readEntryActionResult({ projectRoot: root }, started.runId);
  assert.equal(terminal.outcome, "completed_without_changes");
  assert.equal(terminal.resultOnly, true);
  assert.equal(terminal.resultStatus, "evidence_insufficient");
});

test("project-skill proposal fails closed when server admission is unavailable", async (t) => {
  const { root, supervisor } = await fixture(t, { kind: "candidate-create", version: 1, evidence: [] });
  const profilePath = path.join(root, ".data-editor", "automation-profile.json");
  const profile = JSON.parse(await readFile(profilePath, "utf8")); profile.rules[0].execution.resultPolicy = "proposal"; await writeFile(profilePath, JSON.stringify(profile));
  const started = await startProjectSkillEntryAction({ projectContext: { projectRoot: root, automationProfilePath: profilePath, localAutomationBindingsPath: path.join(root, ".data-editor", "local-automation-bindings.json") }, project: { id: "fixture" }, request: { actionId: "verify" }, toolRoot: process.cwd(), jobSupervisor: supervisor, dependencies: { resolveBindingStatus: async () => ({ status: "ready", skillPath: path.join(root, "SKILL.md"), codexCliPath: process.execPath }) } });
  await assert.rejects(started.completion, { code: "PROJECT_SKILL_PROPOSAL_ADMISSION_UNAVAILABLE" });
});

test("project snapshot rejects symbolic-link or junction input escape", async (t) => {
  const { root } = await fixture(t);
  const target = path.join(root, "linked-target"); const link = path.join(root, "linked-input"); await mkdir(target);
  try { await symlink(target, link, process.platform === "win32" ? "junction" : "dir"); }
  catch (error) { if (error?.code === "EPERM") return; throw error; }
  await assert.rejects(() => startProjectSkillEntryAction({ projectContext: { projectRoot: root, automationProfilePath: path.join(root, ".data-editor", "automation-profile.json"), localAutomationBindingsPath: path.join(root, ".data-editor", "local-automation-bindings.json") }, project: { id: "fixture" }, request: { actionId: "verify" }, toolRoot: process.cwd(), jobSupervisor: { start: async () => { throw new Error("must not start"); } }, dependencies: { resolveBindingStatus: async () => ({ status: "ready", skillPath: path.join(root, "SKILL.md"), codexCliPath: process.execPath }) } }), { code: "PROJECT_SKILL_INPUT_LINK_UNSUPPORTED" });
});

test("project-skill copies declared input and runs only the matching local preflight", async (t) => {
  const { root } = await fixture(t);
  await mkdir(path.join(root, "data"), { recursive: true });
  await writeFile(path.join(root, "data", "a.json"), "{}", "utf8");
  await writeFile(path.join(root, "check.mjs"), "process.exit(0);", "utf8");
  const script = path.join(root, "check.mjs");
  const sha256 = (await import("node:crypto")).createHash("sha256").update(await readFile(script)).digest("hex");
  const profilePath = path.join(root, ".data-editor", "automation-profile.json");
  const profile = JSON.parse(await readFile(profilePath, "utf8"));
  profile.rules[0].execution.advancedExecution = { projectInput: { paths: ["data/a.json"], preflightId: "fixture-preflight" } };
  await writeFile(profilePath, JSON.stringify(profile));
  const bindingPath = path.join(root, ".data-editor", "local-automation-bindings.json");
  await writeFile(bindingPath, JSON.stringify({
    defaults: {}, bindings: { verify: { provider: "codex", skill: "verify" } },
    preflights: { "fixture-preflight": { interpreter: process.execPath, script, sha256, timeoutMs: 10000 } },
  }));
  let preflight = null;
  const supervisor = { async start(spec) { await writeFile(spec.args[spec.args.indexOf("--reply") + 1], JSON.stringify({ kind: "project-skill-result", resultOnly: true })); return { completion: Promise.resolve({ exitCode: 0, timedOut: false }) }; } };
  const started = await startProjectSkillEntryAction({
    projectContext: { projectRoot: root, automationProfilePath: profilePath, localAutomationBindingsPath: bindingPath }, project: { id: "fixture" },
    request: { actionId: "verify", sourcePath: "data/a.json", collectionPath: "items" }, toolRoot: process.cwd(), jobSupervisor: supervisor,
    dependencies: {
      resolveBindingStatus: async () => ({ status: "ready", skillPath: path.join(root, "SKILL.md"), codexCliPath: process.execPath }),
      runPreflight: async (input) => { preflight = input; return { exitCode: 0, timedOut: false }; },
    },
  });
  await started.completion;
  assert.deepEqual(preflight.args.slice(0, 3), [script, "--input-root", preflight.args[2]]);
  assert.match(preflight.args[2], /data-editor-project-skill-.+\\input$/);
  assert.deepEqual(preflight.args.slice(3), ["--source-path", "data/a.json", "--collection-path", "items", "--row-id", "", "--source-row-index", ""]);
  assert.match(preflight.stdoutPath, /preflight\.stdout\.log$/);
  assert.match(preflight.stderrPath, /preflight\.stderr\.log$/);
  assert.equal(await readEntryActionStarted({ projectRoot: root }, started.runId).then((value) => value.phaseHistory.some((item) => item.phase === "preflight_running")), true);
});

test("project-skill with declared input but no preflight starts Codex directly", async (t) => {
  const { root } = await fixture(t);
  await mkdir(path.join(root, "data"), { recursive: true });
  await writeFile(path.join(root, "data", "a.json"), "{}", "utf8");
  const profilePath = path.join(root, ".data-editor", "automation-profile.json");
  const profile = JSON.parse(await readFile(profilePath, "utf8"));
  profile.rules[0].execution.advancedExecution = { projectInput: { paths: ["data/a.json"] } };
  await writeFile(profilePath, JSON.stringify(profile));
  const supervisor = { async start(spec) { await writeFile(spec.args[spec.args.indexOf("--reply") + 1], JSON.stringify({ kind: "project-skill-result", resultOnly: true })); return { completion: Promise.resolve({ exitCode: 0, timedOut: false }) }; } };
  const started = await startProjectSkillEntryAction({
    projectContext: { projectRoot: root, automationProfilePath: profilePath, localAutomationBindingsPath: path.join(root, ".data-editor", "local-automation-bindings.json") }, project: { id: "fixture" },
    request: { actionId: "verify", sourcePath: "data/a.json", collectionPath: "items" }, toolRoot: process.cwd(), jobSupervisor: supervisor,
    dependencies: {
      resolveBindingStatus: async () => ({ status: "ready", skillPath: path.join(root, "SKILL.md"), codexCliPath: process.execPath }),
      runPreflight: async () => { throw new Error("must not run"); },
    },
  });
  await started.completion;
  const state = await readEntryActionStarted({ projectRoot: root }, started.runId);
  assert.equal(state.phaseHistory.some((item) => item.phase === "preflight_running"), false);
  assert.equal(state.phaseHistory.some((item) => item.phase === "review_running"), true);
});

test("project-skill rejects a changed local preflight script before Codex starts", async (t) => {
  const { root } = await fixture(t);
  await mkdir(path.join(root, "data"), { recursive: true });
  await writeFile(path.join(root, "data", "a.json"), "{}", "utf8");
  const script = path.join(root, "check.mjs");
  await writeFile(script, "process.exit(1);", "utf8");
  const profilePath = path.join(root, ".data-editor", "automation-profile.json");
  const profile = JSON.parse(await readFile(profilePath, "utf8"));
  profile.rules[0].execution.advancedExecution = { projectInput: { paths: ["data/a.json"], preflightId: "fixture-preflight" } };
  await writeFile(profilePath, JSON.stringify(profile));
  const bindingPath = path.join(root, ".data-editor", "local-automation-bindings.json");
  await writeFile(bindingPath, JSON.stringify({ defaults: {}, bindings: { verify: { provider: "codex", skill: "verify" } }, preflights: { "fixture-preflight": { interpreter: process.execPath, script, sha256: "0".repeat(64), timeoutMs: 10000 } } }));
  await assert.rejects(() => startProjectSkillEntryAction({
    projectContext: { projectRoot: root, automationProfilePath: profilePath, localAutomationBindingsPath: bindingPath }, project: { id: "fixture" },
    request: { actionId: "verify", sourcePath: "data/a.json", collectionPath: "items" }, toolRoot: process.cwd(), jobSupervisor: { start: async () => { throw new Error("must not start"); } },
    dependencies: { resolveBindingStatus: async () => ({ status: "ready", skillPath: path.join(root, "SKILL.md"), codexCliPath: process.execPath }) },
  }), { code: "PROJECT_SKILL_PREFLIGHT_BINDING_INVALID" });
});
