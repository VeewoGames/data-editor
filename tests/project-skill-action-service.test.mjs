import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startProjectSkillEntryAction } from "../src/project-skill-action-service.mjs";
import { readEntryActionResult, readEntryActionStarted } from "../src/entry-actions.mjs";

async function fixture(t, result = { kind: "project-skill-result", resultOnly: true, status: "checked" }) {
  const root = await mkdtemp(path.join(os.tmpdir(), "project-skill-service-")); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, ".data-editor"), { recursive: true });
  await writeFile(path.join(root, ".data-editor", "automation-profile.json"), JSON.stringify({ rules: [{ id: "verify", label: "Verify", icon: "refresh", targets: [{ file: "data/a.json", collection: "items" }], payload: { includeRow: true, includeNeighbors: false }, execution: { kind: "project-skill" } }] }));
  await writeFile(path.join(root, ".data-editor", "local-automation-bindings.json"), JSON.stringify({ defaults: {}, bindings: { verify: { provider: "codex", skill: "verify" } } }));
  await writeFile(path.join(root, "SKILL.md"), "# fixture");
  const supervisor = { async start(spec) { await writeFile(spec.args[spec.args.indexOf("--reply") + 1], JSON.stringify(result)); return { completion: Promise.resolve({ exitCode: 0, timedOut: false }) }; } };
  return { root, supervisor };
}

test("project skill runs from its project root and accepts only result-only", async (t) => {
  const { root, supervisor } = await fixture(t);
  const started = await startProjectSkillEntryAction({ projectContext: { projectRoot: root, automationProfilePath: path.join(root, ".data-editor", "automation-profile.json"), localAutomationBindingsPath: path.join(root, ".data-editor", "local-automation-bindings.json") }, project: { id: "fixture" }, request: { actionId: "verify", sourcePath: "data/a.json" }, toolRoot: process.cwd(), jobSupervisor: supervisor, dependencies: { resolveBindingStatus: async () => ({ status: "ready", skillPath: path.join(root, "SKILL.md"), codexCliPath: process.execPath }) } });
  assert.equal((await readEntryActionStarted({ projectRoot: root }, started.runId)).phase, "running");
  const result = await started.completion;
  assert.equal(result.resultOnly, true);
  assert.equal((await readEntryActionResult({ projectRoot: root }, started.runId)).outcome, "completed_without_changes");
});

test("project skill rejects a non-result-only reply", async (t) => {
  const { root, supervisor } = await fixture(t, { kind: "proposal" });
  const started = await startProjectSkillEntryAction({ projectContext: { projectRoot: root, automationProfilePath: path.join(root, ".data-editor", "automation-profile.json"), localAutomationBindingsPath: path.join(root, ".data-editor", "local-automation-bindings.json") }, project: { id: "fixture" }, request: { actionId: "verify" }, toolRoot: process.cwd(), jobSupervisor: supervisor, dependencies: { resolveBindingStatus: async () => ({ status: "ready", skillPath: path.join(root, "SKILL.md"), codexCliPath: process.execPath }) } });
  await assert.rejects(started.completion, { code: "PROJECT_SKILL_RESULT_INVALID" });
  assert.equal((await readEntryActionResult({ projectRoot: root }, started.runId)).outcome, "failed");
});
