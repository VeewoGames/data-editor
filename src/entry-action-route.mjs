import { createProjectContext } from "./project-context.mjs";
import { resolveInsideRoot } from "./project-context.mjs";
import crypto from "node:crypto";
import path from "node:path";
import { canonicalFileIdentity } from "./canonical-file-identity.mjs";
import { createFencingAllocator } from "./fencing-lock.mjs";
import { entryActionHandoffPath, readEntryActionStarted } from "./entry-actions.mjs";
import { startProposalOnlyEntryAction } from "./entry-action-service.mjs";
import { preflightEntryActionAdmission } from "./entry-action-admission.mjs";
import { createPendingEntryActionStore } from "./pending-entry-action.mjs";
import { resolveEntryActionExecution } from "./entry-action-execution.mjs";

export function createEntryActionRunRoute({
  loadRegistry,
  toolRoot,
  jobSupervisor,
  documentCommitCoordinator,
  promoteIdentity = null,
  resolveCapabilityState = null,
  preflightEntryAction = preflightEntryActionAdmission,
  startEntryAction = startProposalOnlyEntryAction,
  startProjectSkill = null,
  projectSkillArtifactPublicationUrl = null,
  resolveExecution = resolveEntryActionExecution,
  submitProjectSkillResult = null,
  onCompletion = () => {},
}) {
  if (typeof loadRegistry !== "function") throw new TypeError("loadRegistry is required.");
  if (typeof startEntryAction !== "function") throw new TypeError("startEntryAction is required.");

  async function resolveProject(body) {
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
      dataSources: project.dataSources,
      filePolicy: project.filePolicy,
    });
    return { project, projectContext };
  }

  async function start(body, dependencies = {}) {
    const { project, projectContext } = await resolveProject(body);
    const started = await startEntryAction({
      projectContext,
      project,
      request: body,
      toolRoot,
      jobSupervisor,
      documentCommitCoordinator,
      dependencies,
    });
    onCompletion(started);
    return {
      ok: true,
      status: "started",
      runId: started.runId,
      handoffPath: entryActionHandoffPath(projectContext, started.runId),
    };
  }

  return {
    async run(body) {
      const { project, projectContext } = await resolveProject(body);
      const execution = await resolveExecution(projectContext, body.actionId);
      if (execution.kind === "project-skill") {
        if (typeof startProjectSkill !== "function") routeError("PROJECT_SKILL_HOST_UNAVAILABLE", "Project-skill execution host is unavailable.", 503);
        const started = await startProjectSkill({ projectContext, project, request: body, toolRoot, jobSupervisor, documentCommitCoordinator, dependencies: {
          ...(typeof submitProjectSkillResult === "function" ? { submitProposalResult: (input) => submitProjectSkillResult({ ...input, documentCommitCoordinator }) } : {}),
          ...(typeof projectSkillArtifactPublicationUrl === "string" && projectSkillArtifactPublicationUrl
            ? { projectSkillArtifactPublicationUrl }
            : {}),
        } });
        onCompletion(started);
        return { ok: true, status: "started", runId: started.runId, handoffPath: entryActionHandoffPath(projectContext, started.runId), resultOnly: execution.resultPolicy === "result-only", resultPolicy: execution.resultPolicy };
      }
      if (typeof promoteIdentity !== "function" || typeof resolveCapabilityState !== "function") return start(body);
      const capabilityState = await resolveCapabilityState(project);
      // Capability admission is checked before action authority; candidate contract
      // validation is then repeated inside the promotion commit mutex.
      if (capabilityState?.status !== "active") routeError("IDENTITY_PROMOTION_CAPABILITY_UNAVAILABLE", "Capability state is not active for durable identity promotion.", 409);
      await preflightEntryAction({ projectContext, request: body });
      const sourceIdentity = await canonicalFileIdentity(projectContext, body.sourcePath);
      const runId = crypto.randomUUID();
      const jobInstanceId = crypto.randomUUID();
      const allocator = createFencingAllocator({ stateRoot: resolveInsideRoot(projectContext.projectRoot, path.join(projectContext.runtimeDir, "entry-action-fencing")) });
      const store = createPendingEntryActionStore({ projectContext });
      await expirePendingPromotionsForSource({
        store,
        allocator,
        projectId: project.id,
        canonicalFileKey: sourceIdentity.canonicalFileKey,
      });
      const lease = await allocator.reservePromotion({ canonicalFileKey: sourceIdentity.canonicalFileKey, runId, jobInstanceId });
      const idempotencyKey = String(body?.idempotencyKey ?? "").trim();
      let promotion;
      try {
        promotion = await promoteIdentity({
          projectContext, capabilityState, sourcePath: body.sourcePath, collectionPath: body.collectionPath,
          sourceRowIndex: body.sourceRowIndex, expectedRowDigest: body.expectedRowDigest, idempotencyKey,
          documentCommitCoordinator,
        });
      } catch (error) {
        await allocator.cancelPromotion(lease).catch(() => {});
        throw error;
      }
      const promotedCapabilityState = await resolveCapabilityState(project);
      if (promotedCapabilityState?.status !== "active") {
        await allocator.cancelPromotion(lease).catch(() => {});
        routeError("IDENTITY_PROMOTION_CAPABILITY_UNAVAILABLE", "Capability state is not active after durable identity promotion.", 409);
      }
      const pending = await store.create({
        projectId: project.id, actionId: body.actionId, sourcePath: body.sourcePath, collectionPath: body.collectionPath,
        rowId: promotion.receipt.durableId, expectedRowDigest: promotion.receipt.canonicalRowDigest,
        capabilityGeneration: promotedCapabilityState.generation, manifestDigest: promotedCapabilityState.manifestDigest,
        idempotencyKey, receipt: promotion.receipt, runId, jobInstanceId, lease,
      });
      return { ok: true, status: "promotion_pending", pendingActionToken: pending.token, receipt: promotion.receipt, identityCreated: promotion.identityCreated === true, root: promotion.root, format: promotion.format, documentEtag: promotion.documentEtag };
    },
    async ackStart(body) {
      const token = String(body?.pendingActionToken ?? "").trim();
      const projectId = String(body?.projectId ?? "").trim();
      const { project, projectContext } = await resolveProject({ projectId });
      const store = createPendingEntryActionStore({ projectContext });
      const pending = await store.read(token);
      if (!pending || pending.projectId !== project.id) routeError("ENTRY_ACTION_PENDING_TOKEN_UNKNOWN", "Pending action token is unavailable.", 404);
      if (pending.state === "started") return { ok: true, status: "started", runId: pending.runId, handoffPath: pending.handoffPath, replayed: true };
      const allocator = createFencingAllocator({ stateRoot: resolveInsideRoot(projectContext.projectRoot, path.join(projectContext.runtimeDir, "entry-action-fencing")) });
      if (pending.state !== "pending" || store.isExpired(pending)) {
        if (pending.state === "pending") await allocator.cancelPromotion(pending.lease).then(() => store.write({ ...pending, state: "expired", expiredAt: new Date().toISOString() })).catch(() => {});
        routeError("ENTRY_ACTION_PENDING_TOKEN_EXPIRED", "Pending action token has expired.", 409);
      }
      const state = await resolveCapabilityState(project);
      if (state.status !== "active" || state.generation !== pending.capabilityGeneration || state.manifestDigest !== pending.manifestDigest) {
        await allocator.cancelPromotion(pending.lease).then(() => store.write({ ...pending, state: "invalidated", invalidatedAt: new Date().toISOString() })).catch(() => {});
        routeError("ENTRY_ACTION_PENDING_AUTHORITY_STALE", "Capability authority changed before action start.", 409);
      }
      await allocator.activatePromotion(pending.lease);
      let started;
      try {
        started = await start({ ...pending, projectId: project.id, sourceRowIndex: null }, { lease: pending.lease, runId: pending.runId, jobInstanceId: pending.jobInstanceId });
      } catch (error) {
        const persistedStart = await readEntryActionStarted(projectContext, pending.runId).then(() => true).catch(() => false);
        if (!persistedStart) {
          await allocator.abortLaunching(pending.lease).then(() => store.write({ ...pending, state: "failed", failedAt: new Date().toISOString() })).catch(() => {});
        }
        throw error;
      }
      await store.write({ ...pending, state: "started", startedAt: new Date().toISOString(), runId: started.runId, handoffPath: started.handoffPath });
      return started;
    },
  };
}

/** Expired pending tokens never started a host, so their promotion lease is safe to cancel. */
export async function expirePendingPromotionsForSource({ store, allocator, projectId, canonicalFileKey, now = () => new Date().toISOString() }) {
  const entries = await store.list();
  const expired = [];
  for (const entry of entries) {
    if (entry?.projectId !== projectId || entry?.state !== "pending" || entry?.lease?.canonicalFileKey !== canonicalFileKey || !store.isExpired(entry)) continue;
    const current = await allocator.probe(entry.lease);
    if (current.status !== "owned") continue;
    if (current.phase === "promotion_pending") {
      await allocator.cancelPromotion(entry.lease);
    } else if (current.phase === "launching") {
      const started = await readEntryActionStarted({ projectRoot: store.projectRoot, runtimeDir: store.runtimeDir }, entry.runId).then(() => true).catch(() => false);
      if (started) continue;
      await allocator.abortLaunching(entry.lease);
    } else {
      continue;
    }
    await store.write({ ...entry, state: "expired", expiredAt: now() });
    expired.push(entry.token);
  }
  return expired;
}

function routeError(code, message, status) {
  throw Object.assign(new Error(message), { code, status });
}
