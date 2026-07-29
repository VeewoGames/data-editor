import { createProjectContext } from "./project-context.mjs";
import { entryActionHandoffPath } from "./entry-actions.mjs";
import { startProposalOnlyEntryAction } from "./entry-action-service.mjs";

export function createEntryActionRunRoute({
  loadRegistry,
  toolRoot,
  jobSupervisor,
  documentCommitCoordinator,
  startEntryAction = startProposalOnlyEntryAction,
  onCompletion = () => {},
}) {
  if (typeof loadRegistry !== "function") throw new TypeError("loadRegistry is required.");
  if (typeof startEntryAction !== "function") throw new TypeError("startEntryAction is required.");

  return async function runEntryAction(body) {
    const projectId = String(body?.projectId ?? "").trim();
    if (!projectId) routeError("ENTRY_ACTION_PROJECT_REQUIRED", "Missing projectId", 400);

    const registry = await loadRegistry();
    if (registry.activeProjectId !== projectId) {
      routeError(
        "ENTRY_ACTION_PROJECT_NOT_ACTIVE",
        `Entry actions are limited to the active project: ${projectId}`,
        409,
      );
    }
    const project = registry.projects.find((candidate) => candidate.id === projectId);
    if (!project) routeError("ENTRY_ACTION_PROJECT_UNKNOWN", `Unknown project: ${projectId}`, 404);

    const projectContext = createProjectContext({
      projectRoot: project.root,
      projectId: project.id,
      adapterId: project.adapter,
      dataSources: project.dataSources,
      filePolicy: project.filePolicy,
    });
    const started = await startEntryAction({
      projectContext,
      project,
      request: body,
      toolRoot,
      jobSupervisor,
      documentCommitCoordinator,
    });
    onCompletion(started);
    return {
      ok: true,
      status: "started",
      runId: started.runId,
      handoffPath: entryActionHandoffPath(projectContext, started.runId),
    };
  };
}

function routeError(code, message, status) {
  throw Object.assign(new Error(message), { code, status });
}
