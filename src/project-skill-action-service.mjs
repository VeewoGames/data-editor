import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { loadAutomationBindings } from "./automation-bindings.mjs";
import { loadAutomationProfile } from "./automation-profile.mjs";
import { resolveAutomationExecutionConfig } from "./automation-runtime.mjs";
import { resolveCodexBindingStatus } from "./codex-runtime.mjs";
import { findAutomationEntryAction } from "./entry-actions.mjs";

export async function startProjectSkillEntryAction({ projectContext, project, request, toolRoot, jobSupervisor, dependencies = {} }) {
  const [profile, bindings] = await Promise.all([loadAutomationProfile(projectContext), loadAutomationBindings(projectContext)]);
  const action = findAutomationEntryAction(profile, String(request.actionId ?? "").trim());
  if (action.execution?.kind !== "project-skill") throw protocolError("PROJECT_SKILL_EXECUTION_REQUIRED", "Action is not a project-skill.");
  const binding = bindings.bindings?.[action.id];
  const status = await (dependencies.resolveBindingStatus ?? resolveCodexBindingStatus)(binding, { projectRoot: projectContext.projectRoot });
  if (status.status !== "ready") throw protocolError("ENTRY_ACTION_BINDING_INVALID", status.message ?? "Automation binding is unavailable.");
  const runtime = resolveAutomationExecutionConfig({ rule: action, binding, defaults: bindings.defaults }).runtime;
  const runId = crypto.randomUUID();
  const scratch = path.join(os.tmpdir(), `data-editor-project-skill-${runId}`);
  await mkdir(scratch, { recursive: false });
  const promptPath = path.join(scratch, "prompt.md"); const replyPath = path.join(scratch, "reply.json"); const eventsPath = path.join(scratch, "events.jsonl"); const diagnosticsPath = path.join(scratch, "diagnostics.log");
  const skill = await readFile(status.skillPath, "utf8");
  await writeFile(promptPath, `${skill}\n\n## Explicit invocation\nReturn exactly one JSON object with {"kind":"project-skill-result","resultOnly":true}.\n${JSON.stringify({ actionId: action.id, projectId: project.id, request }, null, 2)}\n`, "utf8");
  const handle = await jobSupervisor.start({ id: runId, command: process.execPath, args: [path.resolve(toolRoot, "scripts/run-project-skill-action-host.mjs"), "--codex", status.codexCliPath, "--project-root", projectContext.projectRoot, "--prompt", promptPath, "--reply", replyPath, "--events", eventsPath, "--diagnostics", diagnosticsPath, "--model", runtime.model, "--reasoning", runtime.reasoning, "--verbosity", runtime.verbosity], cwd: projectContext.projectRoot, timeoutMs: runtime.timeoutMs });
  const completion = (async () => {
    try {
      const terminal = await handle.completion;
      if (terminal.exitCode !== 0 || terminal.timedOut) throw protocolError("PROJECT_SKILL_FAILED", "Project skill did not complete successfully.");
      const result = JSON.parse(await readFile(replyPath, "utf8"));
      if (result?.kind !== "project-skill-result" || result?.resultOnly !== true) throw protocolError("PROJECT_SKILL_RESULT_INVALID", "Project skill must return a result-only object.");
      return result;
    } finally { await rm(scratch, { recursive: true, force: true }).catch(() => {}); }
  })();
  return { runId, completion };
}
function protocolError(code, message) { return Object.assign(new Error(message), { code, status: 400 }); }
