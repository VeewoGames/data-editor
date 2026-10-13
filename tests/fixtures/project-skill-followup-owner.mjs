import path from "node:path";
import { readFile, writeFile, appendFile } from "node:fs/promises";
import { resumeProjectSkillFollowup } from "../../src/project-skill-followup.mjs";
import { startProjectSkillEntryAction } from "../../src/project-skill-action-service.mjs";
const [root, parentRunId] = process.argv.slice(2);
const context = { projectRoot: root, projectId: "fixture", automationProfilePath: path.join(root, ".data-editor", "automation-profile.json"), localAutomationBindingsPath: path.join(root, ".data-editor", "bindings.json") };
let completion;
const supervisor = { async start(spec) {
  await appendFile(path.join(root, "model-starts.log"), `${process.pid}\n`);
  await writeFile(spec.args[spec.args.indexOf("--reply") + 1], JSON.stringify({ kind: "project-skill-result", resultOnly: true, status: "evidence_insufficient" }));
  return { completion: Promise.resolve({ exitCode: 0, timedOut: false }) };
} };
try {
  const intent = await resumeProjectSkillFollowup({ projectContext: context, parentRunId, startChild: async ({ request, childRunId, parentRunId, configDigest }) => {
    process.send({ type: "ready" });
    await new Promise((resolve) => process.once("message", resolve));
    const accepted = await startProjectSkillEntryAction({ projectContext: context, project: { id: "fixture" }, request, toolRoot: process.cwd(), jobSupervisor: supervisor, dependencies: { followupRunId: childRunId, parentRunId, followupConfigDigest: configDigest, resolveBindingStatus: async () => ({ status: "ready", skillPath: path.join(root, "SKILL.md"), codexCliPath: process.execPath }) } });
    completion = accepted.completion;
    return accepted;
  } });
  await completion;
  // Let the owner persist its completion callback before exiting.
  await new Promise((resolve) => setTimeout(resolve, 30));
  process.send({ type: "done", intent });
} catch (error) { process.send({ type: "error", code: error.code, message: error.message }); process.exitCode = 1; }
process.disconnect();
