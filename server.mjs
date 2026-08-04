import http from "node:http";
import crypto from "node:crypto";
import path from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parseCsv, serializeCsv } from "./src/csv-codec.mjs";
import { parseJson, serializeJson } from "./src/json-codec.mjs";
import { buildDocumentModel } from "./src/document-model.mjs";
import { buildDocumentIndex, readResolvedDocument } from "./src/document-service.mjs";
import {
  entryActionHandoffPath,
  describeEntryActionArtifacts,
  entryActionOutputPath,
  findActiveEntryActionRuns,
  findLatestEntryActionRun,
  migrateLegacyEntryActionStateArtifacts,
  normalizeEntryActionPath,
  normalizeEntryActionRowId,
  normalizeEntryActionSourceRowIndex,
  readEntryActionResult,
  readEntryActionStarted,
} from "./src/entry-actions.mjs";
import { loadAutomationBindings, saveAutomationBindings } from "./src/automation-bindings.mjs";
import { loadAutomationSkillCatalog } from "./src/automation-skill-catalog.mjs";
import { resolveCodexBindingStatus } from "./src/codex-runtime.mjs";
import { loadAutomationProfile, saveAutomationProfile } from "./src/automation-profile.mjs";
import { listDataFiles, normalizeDataFileVirtualPath, readTextFile, resolveInsideRoot, writeTextFile } from "./src/file-service.mjs";
import { listViewProfiles, loadViewProfile, saveViewProfile } from "./src/view-profile.mjs";
import { loadViewConfig, saveViewConfig } from "./src/view-config.mjs";
import { loadSharedViews, saveSharedViews } from "./src/shared-views.mjs";
import { clearServiceStateIfOwned } from "./src/runtime-state.mjs";
import { createProjectContext } from "./src/project-context.mjs";
import { addOrActivateProject, loadProjectRegistry, saveProjectRegistry } from "./src/project-registry.mjs";
import { createProjectCapabilityRegistry, findCapabilityBinding } from "./src/project-capability-registry.mjs";
import { loadDocumentContract, DocumentContractError } from "./src/document-contract-service.mjs";
import { createConnectionShutdown } from "./src/server-shutdown.mjs";
import { createJobSupervisor } from "./src/job-supervisor.mjs";
import { createDocumentCommitCoordinator } from "./src/document-commit-coordinator.mjs";
import { createEntryActionRunRoute } from "./src/entry-action-route.mjs";
import { promoteEmbeddedIdentity, recoverPendingEmbeddedIdentityPromotions } from "./src/durable-identity-coordinator.mjs";
import { createPendingEntryActionStore } from "./src/pending-entry-action.mjs";
import { createFencingAllocator } from "./src/fencing-lock.mjs";
import { createCommitJournal } from "./src/commit-journal.mjs";
import { executeJournaledDocumentCommit } from "./src/document-commit-executor.mjs";
import { classifyCommitJournalRecovery } from "./src/commit-journal-recovery.mjs";
import { listSharedViewIconManifestEntries } from "./src/shared-view-icon-manifest.mjs";
import { assertSkillNodeContractSemantics } from "./src/skill-node-contract-semantics.mjs";
import { SUPPORTED_CONTRACT_VERSION } from "./src/skill-node-contract-version.mjs";
import {
  SkillNodeContractError,
} from "./src/skill-node-contract-service.mjs";

const args = parseArgs(process.argv.slice(2));
const projectRoot = path.resolve(args.project ?? args.root ?? process.cwd());
const registryOptions = args.registryHome ? { home: path.resolve(args.registryHome) } : {};
const port = Number(args.port ?? 8787);
const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const toolRoot = args.toolRoot ? path.resolve(args.toolRoot) : scriptRoot;
const bridgePort = Number(args.bridgePort ?? 8791);
const staticRoot = args.static ? path.resolve(scriptRoot, args.static) : null;
const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const execFileAsync = promisify(execFile);
let shuttingDown = false;
let initialProjectPromise = null;
const recoveredIdentityPromotionProjects = new Set();
const entryActionStateMigrationByProjectRoot = new Map();
const connectionShutdown = createConnectionShutdown();
const jobSupervisor = createJobSupervisor({ toolRoot });
const documentCommitCoordinator = createDocumentCommitCoordinator();
const projectCapabilityRegistry = createProjectCapabilityRegistry(registryOptions);
const activeEntryActionCompletions = new Map();
const runEntryAction = createEntryActionRunRoute({
  loadRegistry: async () => {
    await ensureInitialProject();
    return loadProjectRegistry(registryOptions);
  },
  toolRoot,
  jobSupervisor,
  documentCommitCoordinator,
  promoteIdentity: (input) => promoteEmbeddedIdentity({
    ...input,
    validateCandidate: async ({ sourcePath, root, format, capabilityState }) => {
      const contracts = await resolveApplicableDocumentContracts(input.projectContext, sourcePath, root, format);
      if (contracts.error) throw contracts.error;
      if (contracts.state.status !== "active"
        || contracts.state.generation !== capabilityState.generation
        || contracts.state.manifestDigest !== capabilityState.manifestDigest) {
        throw new DocumentSaveError("IDENTITY_PROMOTION_CAPABILITY_STALE", "身份升级期间 capability 或文档合同发生变化。", "documentContracts", { status: 409 });
      }
      // Promotion is a server-owned writer, but it is deliberately held to the
      // same exact binding/token shape as an ordinary document save.
      validateDocumentContractSave({ documentContracts: contracts.contracts.map(({ binding, loaded }) => ({
        contractId: binding.id, manifestDigest: contracts.state.manifestDigest,
        contractDigest: loaded.contractDigest, version: loaded.version,
      })) }, contracts);
      await assertDocumentContractsUnchanged(input.projectContext, sourcePath, root, format, contracts);
    },
  }),
  resolveCapabilityState: (project) => projectCapabilityRegistry.resolve(project),
  onCompletion(started) {
    activeEntryActionCompletions.set(started.runId, started.completion);
    void started.completion.finally(() => activeEntryActionCompletions.delete(started.runId));
  },
});

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/api/entry-actions/run" && req.method === "POST") {
      return await handleRunEntryAction(req, res);
    }
    if (url.pathname === "/api/entry-actions/ack-start" && req.method === "POST") {
      return await handleAckStartEntryAction(req, res);
    }
    await ensureInitialProject();
    if (url.pathname === "/api/projects" && req.method === "GET") return sendJson(res, await loadProjectRegistry(registryOptions));
    if (url.pathname === "/api/project-capabilities" && req.method === "GET") return await handleProjectCapabilities(url, res);
    if (url.pathname === "/api/nested-schema-capabilities" && req.method === "GET") return await handleNestedSchemaCapabilities(url, res);
    if (url.pathname === "/api/projects" && req.method === "POST") return await handleCreateProject(req, res);
    if (url.pathname === "/api/project-update" && req.method === "POST") return await handleUpdateProject(req, res);
    if (url.pathname === "/api/project-delete" && req.method === "POST") return await handleDeleteProject(req, res);
    if (url.pathname === "/api/project-activate" && req.method === "POST") return await handleActivateProject(req, res);
    if (url.pathname === "/api/files") return sendJson(res, await listDataFiles(await projectContextForUrl(url)));
    if (url.pathname === "/api/document") return await handleDocument(url, res);
    if (url.pathname === "/api/document-index") return await handleDocumentIndex(url, res);
    if (url.pathname === "/api/document-content") return await handleDocumentContent(url, res);
    if (url.pathname === "/api/document-contracts" && req.method === "GET") return await handleDocumentContracts(url, res);
    if (url.pathname === "/api/skill-node-contract" && req.method === "GET") return await handleSkillNodeContract(req, url, res);
    if (url.pathname === "/api/save" && req.method === "POST") return await handleSave(req, res);
    if (url.pathname === "/api/view-config" && req.method === "GET") return sendJson(res, await loadViewConfig(await projectContextForUrl(url)));
    if (url.pathname === "/api/view-config" && req.method === "POST") return await handleSaveViewConfig(req, res);
    if (url.pathname === "/api/shared-views" && req.method === "GET") return sendJson(res, await loadSharedViews(await projectContextForUrl(url)));
    if (url.pathname === "/api/shared-views" && req.method === "POST") return await handleSaveSharedViews(req, res);
    if (url.pathname === "/api/view-profiles") return sendJson(res, await listViewProfiles(await projectContextForUrl(url)));
    if (url.pathname === "/api/view-profile" && req.method === "GET") return await handleLoadViewProfile(url, res);
    if (url.pathname === "/api/view-profile" && req.method === "POST") return await handleSaveViewProfile(req, res);
    if (url.pathname === "/api/automation-profile" && req.method === "GET") return await handleLoadAutomationProfile(url, res);
    if (url.pathname === "/api/automation-profile" && req.method === "POST") return await handleSaveAutomationProfile(req, res);
    if (url.pathname === "/api/automation-skill-catalog" && req.method === "GET") return await handleLoadAutomationSkillCatalog(url, res);
    if (url.pathname === "/api/automation-bindings" && req.method === "GET") return await handleLoadAutomationBindings(url, res);
    if (url.pathname === "/api/automation-bindings" && req.method === "POST") return await handleSaveAutomationBindings(req, res);
    if (url.pathname === "/api/entry-actions/result" && req.method === "GET") return await handleLoadEntryActionResult(url, res);
    if (url.pathname === "/api/entry-actions/latest" && req.method === "GET") return await handleLoadLatestEntryActionResult(url, res);
    if (url.pathname === "/api/entry-actions/active" && req.method === "GET") return await handleLoadActiveEntryActionRuns(url, res);
    if (url.pathname === "/api/entry-actions/output" && req.method === "GET") return await handleLoadEntryActionOutput(url, res);
    if (url.pathname === "/api/shared-view-icon-pack-manifest" && req.method === "GET") return await handleSharedViewIconPackManifest(url, res);
    if (url.pathname === "/api/shared-view-icon-pack" && req.method === "GET") return await handleSharedViewIconPack(url, res);
    if (url.pathname === "/api/health" && req.method === "GET") return sendJson(res, { ok: true, bridgePort });
    if (url.pathname === "/api/rebuild" && req.method === "POST") return await handleRebuild(res);
    if (url.pathname === "/api/shutdown" && req.method === "POST") return handleShutdown(res);
    return await serveStatic(url.pathname, res);
  } catch (error) {
    sendJson(res, {
      error: error.message,
      ...(error?.code ? { code: error.code } : {}),
      ...(error?.field ? { field: error.field } : {}),
      ...(error?.details ? { details: error.details } : {}),
    }, Number.isInteger(error?.status) ? error.status : 500, { "cache-control": "no-store" });
  }
});
connectionShutdown.attach(server);

if (isMainModule) {
  registerRuntimeStateCleanup();
  await ensureInitialProject();
  server.listen(port, "127.0.0.1", () => {
    console.log(`Data Editor running at http://127.0.0.1:${port}`);
    console.log(`Project root: ${projectRoot}`);
  });
}

async function ensureInitialProject() {
  initialProjectPromise ??= addOrActivateProject({ root: projectRoot }, registryOptions);
  await initialProjectPromise;
  const registry = await loadProjectRegistry(registryOptions);
  const project = registry.projects.find((candidate) => candidate.id === registry.activeProjectId);
  if (project && !recoveredIdentityPromotionProjects.has(project.id)) {
    const context = createProjectContext({ projectRoot: project.root, projectId: project.id, dataSources: project.dataSources, filePolicy: project.filePolicy });
    const capabilityState = await projectCapabilityRegistry.resolve(project);
    await recoverPendingEmbeddedIdentityPromotions({ projectContext: context, capabilityState });
    const pendingStore = createPendingEntryActionStore({ projectContext: context });
    const allocator = createFencingAllocator({ stateRoot: resolveInsideRoot(context.projectRoot, path.join(context.runtimeDir, "entry-action-fencing")) });
    for (const pending of await pendingStore.list()) {
      if (pending?.state !== "pending" || !pendingStore.isExpired(pending)) continue;
      await allocator.cancelPromotion(pending.lease).then(() => pendingStore.write({ ...pending, state: "expired", expiredAt: new Date().toISOString() })).catch(() => {});
    }
    recoveredIdentityPromotionProjects.add(project.id);
  }
  return registry;
}

async function handleDocument(url, res) {
  const relativePath = url.searchParams.get("path");
  if (!relativePath) throw new Error("Missing document path");
  const projectContext = await projectContextForUrl(url);
  const text = await readTextFile(projectContext, relativePath);
  const ext = path.extname(relativePath).toLowerCase();
  const parsed = ext === ".csv" ? { data: parseCsv(text), format: "csv" } : parseJson(text);
  sendJson(res, {
    ...buildDocumentModel(parsed.data, parsed.format, relativePath),
    documentEtag: documentEtag(text),
  });
}

async function handleProjectCapabilities(url, res) {
  const registry = await loadProjectRegistry(registryOptions);
  const requestedProjectId = typeof url.searchParams.get("projectId") === "string" ? url.searchParams.get("projectId").trim() : "";
  const projectId = requestedProjectId || registry.activeProjectId;
  const project = registry.projects.find((candidate) => candidate.id === projectId);
  if (!project) throw new Error(projectId ? `Unknown project: ${projectId}` : "No active project is configured.");
  sendJson(res, await projectCapabilityRegistry.resolve(project), 200, { "cache-control": "no-cache" });
}

async function handleNestedSchemaCapabilities(url, res) {
  const registry = await loadProjectRegistry(registryOptions);
  const projectId = String(url.searchParams.get("projectId") ?? "").trim() || registry.activeProjectId;
  const project = registry.projects.find((candidate) => candidate.id === projectId);
  if (!project) throw new Error(projectId ? `Unknown project: ${projectId}` : "No active project is configured.");
  const state = await projectCapabilityRegistry.resolve(project);
  if (state.status !== "active") return sendJson(res, { projectId: project.id, generation: state.generation, bindings: [] }, 200, { "cache-control": "no-cache" });
  const bindings = await Promise.all(state.bindings.nestedSchemas.map(async (binding) => {
    let definition;
    try {
      const resource = JSON.parse(await readFile(resolveInsideRoot(project.root, binding.manifest), "utf8"));
      definition = resource?.schemas?.[binding.id] ?? resource;
    } catch (error) {
      throw Object.assign(new Error(`Nested schema capability is unreadable: ${binding.manifest}`), { code: "NESTED_SCHEMA_CAPABILITY_INVALID", status: 409, details: { bindingId: binding.id } });
    }
    return { id: binding.id, match: binding.match, definition };
  }));
  sendJson(res, { projectId: project.id, generation: state.generation, bindings }, 200, { "cache-control": "no-cache" });
}

async function resolveApplicableDocumentContracts(projectContext, documentPath, root, format) {
  const registry = await loadProjectRegistry(registryOptions);
  const project = registry.projects.find((candidate) => candidate.id === projectContext.projectId);
  if (!project) throw new Error(`Unknown project: ${projectContext.projectId}`);
  const capabilityState = await projectCapabilityRegistry.resolve(project);
  if (capabilityState.status === "generic_absent") return { state: capabilityState, contracts: [] };
  if (capabilityState.status !== "active") {
    return { state: capabilityState, contracts: [], error: new DocumentSaveError("DOCUMENT_CONTRACT_CAPABILITY_UNAVAILABLE", "项目 capability 状态不可用于安全保存。", "path", { status: 409, details: capabilityState.error ?? null }) };
  }
  const virtualPath = normalizeDataFileVirtualPath(projectContext, documentPath);
  const separator = virtualPath.indexOf("/");
  const dataSourceId = virtualPath.slice(0, separator);
  const innerPath = virtualPath.slice(separator + 1);
  const model = buildDocumentModel(root, format, documentPath);
  const contracts = [];
  for (const collection of model.collections) {
    const binding = findCapabilityBinding(capabilityState, { engine: "document-contract-v1", dataSourceId, path: innerPath, collection: collection.path });
    if (binding) contracts.push({ binding, loaded: await loadDocumentContract(projectContext.projectRoot, binding) });
  }
  return { state: capabilityState, contracts };
}

async function handleDocumentContracts(url, res) {
  const documentPath = url.searchParams.get("path");
  if (!documentPath) throw new Error("Missing document contract path");
  const projectContext = await projectContextForUrl(url);
  const ext = path.extname(documentPath).toLowerCase();
  const text = await readTextFile(projectContext, documentPath);
  const root = ext === ".csv" ? parseCsv(text) : parseJson(text).data;
  const resolution = await resolveApplicableDocumentContracts(projectContext, documentPath, root, ext.slice(1));
  if (resolution.error) throw resolution.error;
  sendJson(res, {
    projectId: projectContext.projectId,
    documentContracts: resolution.contracts.map(({ binding, loaded }) => ({
      contractId: binding.id,
      manifestDigest: resolution.state.manifestDigest,
      contractDigest: loaded.contractDigest,
      version: loaded.version,
    })),
  }, 200, { "cache-control": "no-cache" });
}

async function handleSave(req, res) {
  try {
    const body = await readJsonBody(req);
    if (!body.path) throw new Error("Missing save path");
    assertDocumentSaveIdempotencyKey(body.idempotencyKey);
    const projectContext = await projectContextForId(body.projectId);
    const ext = path.extname(body.path).toLowerCase();
    if (![".json", ".csv"].includes(ext)) throw new Error(`Unsupported save extension: ${ext}`);
    const text = ext === ".csv" ? serializeCsv(body.root) : serializeJson(body.root);
    const requestDigest = sha256(JSON.stringify({ path: body.path, documentEtag: body.documentEtag, text }));
    await documentCommitCoordinator.withCommit({ projectContext, sourcePath: body.path }, async (identity) => {
      const active = await findActiveEntryActionRuns(projectContext, body.path);
      if (active.runs.length > 0) {
        throw new DocumentSaveError(
          "DOCUMENT_SAVE_ENTRY_ACTION_ACTIVE",
          "当前文件存在正在执行的条目自动化，已暂缓普通保存。",
          "path",
          { status: 409, details: { runs: active.runs } },
        );
      }
      const journal = createCommitJournal({ directory: commitJournalDirectory(projectContext) });
      const existing = await readJournalIfPresent(journal, body.idempotencyKey);
      if (existing) {
        if (existing.saveType !== "document_save" || existing.requestDigest !== requestDigest) {
          throw new DocumentSaveError("DOCUMENT_SAVE_IDEMPOTENCY_CONFLICT", "idempotencyKey 已用于不同的保存请求。", "idempotencyKey");
        }
        if (existing.stage === "result_published") {
          const currentText = await readTextFile(projectContext, body.path);
          const recovery = classifyCommitJournalRecovery({ entry: existing, currentEtag: documentEtag(currentText), currentDigest: sha256(currentText) });
          if (recovery.disposition !== "completed") {
            throw new DocumentSaveError("DOCUMENT_SAVE_NEEDS_RECOVERY", "保存记录与当前文件无法证明一致，已停止重放。", "idempotencyKey", { status: 503 });
          }
          sendJson(res, { ok: true, documentEtag: existing.newEtag, replayed: true });
          return;
        }
      }
      const currentText = await readTextFile(projectContext, body.path);
      const entry = existing ?? createDocumentSaveJournalEntry({ body, identity, currentText, text, requestDigest });
      if (existing) await resumeDocumentSaveJournal({ journal, entry, currentText });
      else assertDocumentEtagUnchanged(body.documentEtag, currentText);
      const documentContracts = await resolveApplicableDocumentContracts(projectContext, body.path, body.root, ext.slice(1));
      if (documentContracts.error) throw documentContracts.error;
      validateDocumentContractSave(body, documentContracts);
      await assertDocumentContractsUnchanged(projectContext, body.path, body.root, ext.slice(1), documentContracts);
      await executeJournaledDocumentCommit({
        journal,
        entry,
        replace: () => writeTextFile(projectContext, body.path, text),
        verify: async () => {
          const persisted = await readTextFile(projectContext, body.path);
          if (documentEtag(persisted) !== entry.newEtag || sha256(persisted) !== entry.afterDigest) {
            throw new DocumentSaveError("DOCUMENT_SAVE_VERIFY_FAILED", "保存后的文件未通过完整性校验。", "path", { status: 503 });
          }
        },
      });
      sendJson(res, { ok: true, documentEtag: documentEtag(text) });
    });
  } catch (error) {
    if (!(error instanceof SkillNodeContractError) && !(error instanceof SkillDocumentSaveError) && !(error instanceof DocumentSaveError) && !(error instanceof DocumentContractError)) throw error;
    sendJson(res, {
      error: error.message,
      code: error.code,
      field: error.field ?? "contract",
      ...(error.details == null ? {} : { details: error.details }),
    }, error.status, { "cache-control": "no-cache" });
  }
}

class SkillDocumentSaveError extends Error {
  constructor(code, message, field, { status = 409, details = null } = {}) {
    super(message);
    this.name = "SkillDocumentSaveError";
    this.code = code;
    this.field = field;
    this.status = status;
    this.details = details;
  }
}

async function validateSkillDocumentSave(body, projectContext) {
  const requestProjectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
  if (!requestProjectId) {
    throw new SkillDocumentSaveError(
      "SKILL_NODE_CONTRACT_SAVE_PROJECT_REQUIRED",
      "projectId is required to save the skill document.",
      "projectId",
      { status: 400 },
    );
  }
  if (!Number.isInteger(body.contractVersion)) {
    throw new SkillDocumentSaveError(
      "SKILL_NODE_CONTRACT_SAVE_VERSION_MISSING",
      "contractVersion is required to save the skill document.",
      "contractVersion",
      { status: 400 },
    );
  }
  if (typeof body.contractEtag !== "string" || !body.contractEtag) {
    throw new SkillDocumentSaveError(
      "SKILL_NODE_CONTRACT_SAVE_ETAG_MISSING",
      "contractEtag is required to save the skill document.",
      "contractEtag",
      { status: 400 },
    );
  }
  const token = body.saveToken;
  if (!token || typeof token !== "object" || Array.isArray(token)) {
    throw new SkillDocumentSaveError(
      "SKILL_NODE_CONTRACT_SAVE_TOKEN_MISSING",
      "A project-scoped skill node contract save token is required.",
      "saveToken",
      { status: 400 },
    );
  }
  if (token.projectId !== requestProjectId) {
    throw new SkillDocumentSaveError(
      "SKILL_NODE_CONTRACT_SAVE_TOKEN_PROJECT_MISMATCH",
      "The save token belongs to a different project.",
      "saveToken.projectId",
      { details: { requestProjectId, tokenProjectId: token.projectId ?? null } },
    );
  }
  if (token.contractVersion !== body.contractVersion) {
    throw new SkillDocumentSaveError(
      "SKILL_NODE_CONTRACT_SAVE_TOKEN_VERSION_MISMATCH",
      "The save token version does not match contractVersion.",
      "saveToken.contractVersion",
    );
  }
  if (token.etag !== body.contractEtag) {
    throw new SkillDocumentSaveError(
      "SKILL_NODE_CONTRACT_SAVE_TOKEN_ETAG_MISMATCH",
      "The save token ETag does not match contractEtag.",
      "saveToken.etag",
    );
  }
  if (!body.root || typeof body.root !== "object" || Array.isArray(body.root)
    || !Number.isInteger(body.root.skill_node_contract_version)) {
    throw new SkillDocumentSaveError(
      "SKILL_NODE_CONTRACT_ROOT_VERSION_MISSING",
      "The skill document root is missing skill_node_contract_version.",
      "root.skill_node_contract_version",
    );
  }
  if (body.root.skill_node_contract_version !== body.contractVersion) {
    throw new SkillDocumentSaveError(
      "SKILL_NODE_CONTRACT_ROOT_VERSION_MISMATCH",
      "The skill document contract version does not match contractVersion.",
      "root.skill_node_contract_version",
    );
  }

  const current = await loadDeclaredSkillNodeContract(projectContext);
  if (current.contract.contract_version !== body.contractVersion) {
    throw new SkillDocumentSaveError(
      "SKILL_NODE_CONTRACT_SAVE_VERSION_MISMATCH",
      "contractVersion does not match the current skill node contract.",
      "contractVersion",
      { details: { expected: current.contract.contract_version, actual: body.contractVersion } },
    );
  }
  if (current.etag !== body.contractEtag) {
    throw new SkillDocumentSaveError(
      "SKILL_NODE_CONTRACT_SAVE_ETAG_STALE",
      "contractEtag does not match the current skill node contract.",
      "contractEtag",
      { details: { expected: current.etag, actual: body.contractEtag } },
    );
  }
  return current;
}

export async function assertSkillNodeContractUnchanged(projectContext, validatedEtag) {
  const current = await loadDeclaredSkillNodeContract(projectContext);
  if (current.etag !== validatedEtag) {
    throw new SkillDocumentSaveError(
      "SKILL_NODE_CONTRACT_CHANGED_DURING_SAVE",
      "The skill node contract changed after the save gate was validated.",
      "contractEtag",
      { details: { expected: validatedEtag, actual: current.etag } },
    );
  }
}

async function handleSkillNodeContract(req, url, res) {
  try {
    const projectContext = await projectContextForSkillNodeContract(url.searchParams.get("projectId"));
    const { contract, etag } = await loadDeclaredSkillNodeContract(projectContext);
    const headers = { etag, "cache-control": "no-cache" };
    if (matchesIfNoneMatch(req.headers["if-none-match"], etag)) {
      res.writeHead(304, headers);
      res.end();
      return;
    }
    sendJson(res, contract, 200, headers);
  } catch (error) {
    if (!(error instanceof SkillNodeContractError)) throw error;
    sendJson(res, {
      error: error.message,
      code: error.code,
      ...(error.details == null ? {} : { details: error.details }),
    }, error.status, { "cache-control": "no-cache" });
  }
}

async function projectContextForSkillNodeContract(projectId) {
  const resolvedProjectId = typeof projectId === "string" ? projectId.trim() : "";
  if (!resolvedProjectId) {
    throw new SkillNodeContractError(
      "SKILL_NODE_CONTRACT_PROJECT_REQUIRED",
      "projectId is required for the skill node contract endpoint.",
      { status: 400 },
    );
  }
  const registry = await loadProjectRegistry(registryOptions);
  const project = registry.projects.find((candidate) => candidate.id === resolvedProjectId);
  if (!project) {
    throw new SkillNodeContractError(
      "SKILL_NODE_CONTRACT_PROJECT_UNKNOWN",
      `Unknown project: ${resolvedProjectId}`,
      { status: 404, details: { projectId: resolvedProjectId } },
    );
  }
  return createProjectContext({
    projectRoot: project.root,
    projectId: project.id,
    dataSources: project.dataSources,
    filePolicy: project.filePolicy,
  });
}

async function handleDocumentIndex(url, res) {
  const relativePath = url.searchParams.get("path");
  if (!relativePath) throw new Error("Missing document path");
  const projectContext = await projectContextForUrl(url);
  const viewConfig = await loadViewConfig(projectContext);
  const forceRefresh = url.searchParams.get("refresh") === "1";
  sendJson(res, await buildDocumentIndex(projectContext, viewConfig.documentFiles, relativePath, { forceRefresh }));
}

async function handleDocumentContent(url, res) {
  const relativePath = url.searchParams.get("path");
  const documentId = url.searchParams.get("id");
  if (!relativePath) throw new Error("Missing document path");
  if (!documentId) throw new Error("Missing document id");
  const projectContext = await projectContextForUrl(url);
  const viewConfig = await loadViewConfig(projectContext);
  const forceRefresh = url.searchParams.get("refresh") === "1";
  sendJson(res, await readResolvedDocument(projectContext, viewConfig.documentFiles, relativePath, documentId, { forceRefresh }));
}

async function handleSaveViewConfig(req, res) {
  const body = await readJsonBody(req);
  const projectContext = await projectContextForId(body.projectId);
  const config = body && typeof body === "object" && "config" in body ? body.config : body;
  const result = await saveViewConfig(projectContext, config);
  sendJson(res, { ok: true, ...result });
}

async function handleSaveSharedViews(req, res) {
  const body = await readJsonBody(req);
  const projectContext = await projectContextForId(body.projectId);
  const config = body && typeof body === "object" && "config" in body ? body.config : body;
  const result = await saveSharedViews(projectContext, config);
  sendJson(res, { ok: true, ...result });
}

async function handleLoadViewProfile(url, res) {
  const name = url.searchParams.get("name");
  if (!name) throw new Error("Missing view profile name");
  sendJson(res, await loadViewProfile(await projectContextForUrl(url), name));
}

async function handleSaveViewProfile(req, res) {
  const body = await readJsonBody(req);
  if (!body.name) throw new Error("Missing view profile name");
  const projectContext = await projectContextForId(body.projectId);
  const result = await saveViewProfile(projectContext, body.name, body.profile);
  sendJson(res, { ok: true, ...result });
}

async function handleLoadAutomationProfile(url, res) {
  sendJson(res, await loadAutomationProfile(await projectContextForUrl(url)));
}

async function handleSaveAutomationProfile(req, res) {
  const body = await readJsonBody(req);
  const projectContext = await projectContextForId(body.projectId);
  const profile = body && typeof body === "object" && "profile" in body ? body.profile : body;
  try {
    const result = await saveAutomationProfile(projectContext, profile, body?.etag ?? null);
    sendJson(res, { ok: true, ...result });
  } catch (error) {
    if (error?.code === "AUTOMATION_PROFILE_ETAG_STALE") return sendJson(res, { error: error.message, code: error.code, field: "etag" }, 409);
    throw error;
  }
}

async function loadDeclaredSkillNodeContract(projectContext) {
  const registry = await loadProjectRegistry(registryOptions);
  const project = registry.projects.find((candidate) => candidate.id === projectContext.projectId);
  if (!project) throw new SkillNodeContractError("SKILL_NODE_CONTRACT_PROJECT_UNKNOWN", `Unknown project: ${projectContext.projectId}.`, { status: 404 });
  const state = await projectCapabilityRegistry.resolve(project);
  if (state.status !== "active") {
    throw new SkillNodeContractError("SKILL_NODE_CONTRACT_CAPABILITY_UNAVAILABLE", "The project has no active capability manifest for its skill node contract.", { status: 409, details: state.error ?? null });
  }
  const bindings = state.bindings.documentContracts.filter((binding) => binding.id === "skill-node-contract");
  if (bindings.length !== 1) {
    throw new SkillNodeContractError("SKILL_NODE_CONTRACT_BINDING_REQUIRED", "The project must declare exactly one skill-node-contract binding.", { status: 409, details: { count: bindings.length } });
  }
  let loaded;
  try {
    loaded = await loadDocumentContract(projectContext.projectRoot, bindings[0]);
  } catch (error) {
    if (!(error instanceof DocumentContractError)) throw error;
    const legacy = {
      DOCUMENT_CONTRACT_MISSING: ["SKILL_NODE_CONTRACT_MISSING", "Skill node contract is missing.", 404],
      DOCUMENT_CONTRACT_SCHEMA_MISSING: ["SKILL_NODE_CONTRACT_META_SCHEMA_MISSING", "Skill node contract meta-schema is missing.", 404],
      DOCUMENT_CONTRACT_INVALID_JSON: ["SKILL_NODE_CONTRACT_INVALID_JSON", "Skill node contract contains invalid JSON.", 422],
      DOCUMENT_CONTRACT_SCHEMA_INVALID_JSON: ["SKILL_NODE_CONTRACT_META_SCHEMA_INVALID_JSON", "Skill node contract meta-schema contains invalid JSON.", 422],
      DOCUMENT_CONTRACT_SCHEMA_COMPILE_INVALID: ["SKILL_NODE_CONTRACT_META_SCHEMA_INVALID", "Skill node contract meta-schema is not a valid JSON Schema.", 422],
      DOCUMENT_CONTRACT_SCHEMA_INVALID: ["SKILL_NODE_CONTRACT_SCHEMA_INVALID", "Skill node contract does not satisfy its meta-schema.", 422],
    }[error.code];
    if (!legacy) throw error;
    throw new SkillNodeContractError(legacy[0], legacy[1], { status: legacy[2], details: error.details });
  }
  if (loaded.version !== SUPPORTED_CONTRACT_VERSION) {
    throw new SkillNodeContractError("SKILL_NODE_CONTRACT_VERSION_UNSUPPORTED", `Unsupported skill node contract version: ${String(loaded.version)}.`, { status: 409, details: { actual: loaded.version, supported: SUPPORTED_CONTRACT_VERSION } });
  }
  try {
    assertSkillNodeContractSemantics(loaded.contract);
  } catch (error) {
    throw new SkillNodeContractError("SKILL_NODE_CONTRACT_SEMANTICS_INVALID", "Skill node contract contains incomplete or ambiguous runtime semantics.", { details: error instanceof Error ? error.message : String(error) });
  }
  return { contract: loaded.contract, etag: loaded.etag };
}

function matchesIfNoneMatch(ifNoneMatch, etag) {
  if (typeof ifNoneMatch !== "string" || !ifNoneMatch.trim()) return false;
  return ifNoneMatch.split(",").some((candidate) => {
    const normalized = candidate.trim().replace(/^W\//, "");
    return normalized === "*" || normalized === etag;
  });
}

function validateDocumentContractSave(body, resolution) {
  if (!resolution.contracts.length) return;
  const tokens = body.documentContracts;
  if (!Array.isArray(tokens)) throw new DocumentSaveError("DOCUMENT_CONTRACT_TOKEN_MISSING", "命中文档合同的保存请求必须携带 documentContracts token。", "documentContracts", { status: 400 });
  const expected = resolution.contracts.map(({ binding, loaded }) => ({ contractId: binding.id, manifestDigest: resolution.state.manifestDigest, contractDigest: loaded.contractDigest, version: loaded.version }));
  const actual = tokens.map((token) => ({ contractId: token?.contractId, manifestDigest: token?.manifestDigest, contractDigest: token?.contractDigest, version: token?.version }));
  if (JSON.stringify(actual.sort((a, b) => String(a.contractId).localeCompare(String(b.contractId)))) !== JSON.stringify(expected.sort((a, b) => a.contractId.localeCompare(b.contractId)))) {
    throw new DocumentSaveError("DOCUMENT_CONTRACT_TOKEN_STALE", "documentContracts token 与当前 capability 或合同不一致。", "documentContracts", { status: 409, details: { expected } });
  }
}

async function assertDocumentContractsUnchanged(projectContext, documentPath, root, format, previous) {
  const current = await resolveApplicableDocumentContracts(projectContext, documentPath, root, format);
  if (current.error) throw current.error;
  const before = previous.contracts.map(({ binding, loaded }) => `${binding.id}:${loaded.contractDigest}`).sort();
  const after = current.contracts.map(({ binding, loaded }) => `${binding.id}:${loaded.contractDigest}`).sort();
  if (JSON.stringify(before) !== JSON.stringify(after) || current.state.manifestDigest !== previous.state.manifestDigest) {
    throw new DocumentSaveError("DOCUMENT_CONTRACT_CHANGED_DURING_SAVE", "保存期间 capability 或文档合同发生变化。", "documentContracts", { status: 409 });
  }
}

function commitJournalDirectory(projectContext) {
  return resolveInsideRoot(projectContext.projectRoot, path.join(projectContext.runtimeDir, "commit-journal"));
}

async function readJournalIfPresent(journal, idempotencyKey) {
  try { return await journal.read(idempotencyKey); }
  catch (error) { if (error?.code === "COMMIT_JOURNAL_MISSING") return null; throw error; }
}

function createDocumentSaveJournalEntry({ body, identity, currentText, text, requestDigest }) {
  return {
    idempotencyKey: body.idempotencyKey,
    saveType: "document_save",
    canonicalFileKey: identity.canonicalFileKey,
    baseEtag: documentEtag(currentText), newEtag: documentEtag(text),
    beforeDigest: sha256(currentText), afterDigest: sha256(text), requestDigest,
  };
}

async function resumeDocumentSaveJournal({ journal, entry, currentText }) {
  const disposition = classifyCommitJournalRecovery({ entry, currentEtag: documentEtag(currentText), currentDigest: sha256(currentText) });
  if (disposition.disposition === "uncommitted") return;
  if (disposition.disposition !== "resume") {
    throw new DocumentSaveError("DOCUMENT_SAVE_NEEDS_RECOVERY", "保存记录与当前文件无法证明一致，已停止重试。", "idempotencyKey", { status: 503 });
  }
  // Only infer the post-replace marker from an intent record. Later stages must
  // still execute their own verification/publish operation before advancing.
  if (entry.stage === "commit_intent" && disposition.nextStage === "source_replaced") {
    await journal.advance(entry, "source_replaced");
  }
}

function assertDocumentSaveIdempotencyKey(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(value)) {
    throw new DocumentSaveError("DOCUMENT_SAVE_IDEMPOTENCY_KEY_REQUIRED", "idempotencyKey must be a stable UUID-like token for one logical save.", "idempotencyKey", { status: 400 });
  }
}

async function handleLoadAutomationSkillCatalog(url, res) {
  const projectContext = await projectContextForUrl(url);
  sendJson(res, await loadAutomationSkillCatalog({ projectRoot: projectContext.projectRoot }));
}

async function handleLoadAutomationBindings(url, res) {
  const projectContext = await projectContextForUrl(url);
  const bindings = await loadAutomationBindings(projectContext);
  const bindingStatuses = {};
  for (const [ruleId, binding] of Object.entries(bindings.bindings ?? {})) {
    bindingStatuses[ruleId] = await resolveCodexBindingStatus(binding, { projectRoot: projectContext.projectRoot });
  }
  sendJson(res, { ...bindings, bindingStatuses });
}

async function handleSaveAutomationBindings(req, res) {
  const body = await readJsonBody(req);
  const projectContext = await projectContextForId(body.projectId);
  const bindings = body && typeof body === "object" && "bindings" in body ? body.bindings : body;
  if (body?.validateOnly) {
    await saveAutomationBindings(projectContext, bindings, { validateRuntime: true, validateOnly: true });
    sendJson(res, { ok: true, validated: true });
    return;
  }
  const result = await saveAutomationBindings(projectContext, bindings, { validateRuntime: true });
  sendJson(res, { ok: true, ...result });
}

async function handleCreateProject(req, res) {
  const body = await readJsonBody(req);
  const result = await addOrActivateProject(body, registryOptions);
  sendJson(res, { ok: true, activeProjectId: result.registry.activeProjectId, project: result.project });
}

async function handleUpdateProject(req, res) {
  const body = await readJsonBody(req);
  if (!body.id) throw new Error("Missing project id");
  const registry = await loadProjectRegistry(registryOptions);
  const index = registry.projects.findIndex((project) => project.id === body.id);
  if (index < 0) throw new Error(`Unknown project: ${body.id}`);
  registry.projects[index] = {
    ...registry.projects[index],
    ...body,
    root: body.root ?? registry.projects[index].root,
    dataSources: body.dataSources ?? registry.projects[index].dataSources,
    filePolicy: body.filePolicy ?? registry.projects[index].filePolicy,
  };
  const saved = await saveProjectRegistry(registry, registryOptions);
  sendJson(res, { ok: true, registry: saved });
}

async function handleDeleteProject(req, res) {
  const body = await readJsonBody(req);
  if (!body.projectId) throw new Error("Missing project id");
  const registry = await loadProjectRegistry(registryOptions);
  const projects = registry.projects.filter((project) => project.id !== body.projectId);
  if (projects.length === registry.projects.length) throw new Error(`Unknown project: ${body.projectId}`);
  if (projects.length === 0) throw new Error("Cannot delete the last project.");
  const activeProjectId = registry.activeProjectId === body.projectId ? projects[0].id : registry.activeProjectId;
  const saved = await saveProjectRegistry({ ...registry, activeProjectId, projects }, registryOptions);
  sendJson(res, { ok: true, registry: saved });
}

async function handleActivateProject(req, res) {
  const body = await readJsonBody(req);
  const projectId = body.projectId;
  if (!projectId) throw new Error("Missing project id");
  const registry = await loadProjectRegistry(registryOptions);
  if (!registry.projects.some((project) => project.id === projectId)) throw new Error(`Unknown project: ${projectId}`);
  const saved = await saveProjectRegistry({ ...registry, activeProjectId: projectId }, registryOptions);
  sendJson(res, { ok: true, activeProjectId: saved.activeProjectId });
}

async function handleRunEntryAction(req, res) {
  const body = await readJsonBody(req);
  sendJson(res, await runEntryAction.run(body));
}

async function handleAckStartEntryAction(req, res) {
  const body = await readJsonBody(req);
  sendJson(res, await runEntryAction.ackStart(body));
}

async function handleLoadEntryActionResult(url, res) {
  const runId = String(url.searchParams.get("runId") ?? "").trim();
  if (!runId) throw new Error("Missing runId");
  const projectContext = await projectContextForUrl(url);
  try {
    const result = await readEntryActionResult(projectContext, runId);
    sendJson(res, { ...result, artifacts: await describeEntryActionArtifacts(projectContext, runId) });
    return;
  } catch {}
  try {
    sendJson(res, await readEntryActionStarted(projectContext, runId));
    return;
  } catch {}
  try {
    await readFile(entryActionHandoffPath(projectContext, runId), "utf8");
    sendJson(res, { runId, status: "started" });
    return;
  } catch {}
  sendJson(res, { error: `Unknown entry action run: ${runId}` }, 404);
}

class DocumentSaveError extends Error {
  constructor(code, message, field, { status = 409, details = null } = {}) {
    super(message);
    this.name = "DocumentSaveError";
    this.code = code;
    this.field = field;
    this.status = status;
    this.details = details;
  }
}

function documentEtag(text) {
  return `"${sha256(text)}"`;
}

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function assertDocumentEtagUnchanged(expectedEtag, currentText) {
  if (typeof expectedEtag !== "string" || !expectedEtag) {
    throw new DocumentSaveError(
      "DOCUMENT_SAVE_ETAG_REQUIRED",
      "documentEtag must be a non-empty string loaded with the document.",
      "documentEtag",
      { status: 400 },
    );
  }
  const currentEtag = documentEtag(currentText);
  if (expectedEtag !== currentEtag) {
    throw new DocumentSaveError(
      "DOCUMENT_SAVE_ETAG_STALE",
      "文件已被外部更新。为避免覆盖新内容，已拒绝保存；请刷新后再继续编辑。",
      "documentEtag",
      { details: { expected: expectedEtag, actual: currentEtag } },
    );
  }
}

async function handleLoadLatestEntryActionResult(url, res) {
  const sourcePath = normalizeEntryActionPath(url.searchParams.get("sourcePath"), "sourcePath");
  const collectionPath = normalizeEntryActionPath(url.searchParams.get("collectionPath"), "collectionPath");
  const rowId = normalizeEntryActionRowId(url.searchParams.get("rowId"));
  const sourceRowIndex = normalizeEntryActionSourceRowIndex(url.searchParams.get("sourceRowIndex"));
  const actionId = String(url.searchParams.get("actionId") ?? "").trim();
  if (!actionId) throw new Error("Missing actionId");
  if (rowId == null && sourceRowIndex == null) throw new Error("Entry action requires rowId or sourceRowIndex");
  const projectContext = await projectContextForUrl(url);
  const run = await findLatestEntryActionRun(projectContext, {
    actionId,
    sourcePath,
    collectionPath,
    rowId,
    sourceRowIndex,
  });
  sendJson(res, { run });
}

async function handleLoadActiveEntryActionRuns(url, res) {
  const sourcePath = normalizeEntryActionPath(url.searchParams.get("sourcePath"), "sourcePath");
  const projectContext = await projectContextForUrl(url);
  sendJson(res, await findActiveEntryActionRuns(projectContext, sourcePath));
}

async function handleLoadEntryActionOutput(url, res) {
  const runId = String(url.searchParams.get("runId") ?? "").trim();
  if (!runId) throw new Error("Missing runId");
  const projectContext = await projectContextForUrl(url);
  try {
    const output = await readFile(entryActionOutputPath(projectContext, runId), "utf8");
    sendJson(res, { runId, output });
  } catch {
    sendJson(res, { error: `Entry action output is unavailable: ${runId}` }, 404);
  }
}

function handleShutdown(res) {
  sendJson(res, { ok: true, stopping: true }, 202);
  scheduleControllerStop();
}

async function handleRebuild(res) {
  await runBuildCommand();
  sendJson(res, { ok: true });
}

async function handleSharedViewIconPack(url, res) {
  const packId = String(url.searchParams.get("packId") ?? "").trim();
  const packRoot = resolveSharedViewIconPackRoot(packId);
  const payload = {};
  await collectSharedViewIconPackSvg(packRoot, payload);
  sendJson(res, payload);
}

async function handleSharedViewIconPackManifest(url, res) {
  const packId = String(url.searchParams.get("packId") ?? "").trim();
  sendJson(res, listSharedViewIconManifestEntries(packId));
}

async function serveStatic(urlPath, res) {
  if (!staticRoot) {
    sendJson(res, { error: "Static build is not configured. Use npm run dev for development." }, 404);
    return;
  }
  const rel = urlPath === "/" ? "index.html" : urlPath.slice(1);
  const abs = resolveInsideRoot(staticRoot, rel);
  let data;
  try {
    data = await readFile(abs);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      sendJson(res, { error: `Static asset not found: ${rel}` }, 404);
      return;
    }
    throw error;
  }
  res.writeHead(200, { "content-type": contentType(abs) });
  res.end(data);
}

function sendJson(res, data, status = 200, headers = {}) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(data));
}

function scheduleControllerStop() {
  const timer = setTimeout(() => {
    void postControllerStopRequest(bridgePort).catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
    });
  }, 100);
  timer.unref?.();
}

export async function postControllerStopRequest(targetBridgePort) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({});
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port: targetBridgePort,
        path: "/stop-service",
        method: "POST",
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-length": Buffer.byteLength(payload),
        },
        timeout: 15000,
      },
      (response) => {
        let responseBody = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          responseBody += chunk;
        });
        response.on("end", () => {
          const data = responseBody ? JSON.parse(responseBody) : {};
          if ((response.statusCode ?? 500) >= 400) {
            reject(new Error(data.error ?? `HTTP ${response.statusCode ?? 500}`));
            return;
          }
          resolve(data);
        });
      },
    );
    request.on("timeout", () => request.destroy(new Error("timeout")));
    request.on("error", reject);
    request.end(payload);
  });
}

export async function runBuildCommand({
  execFileImpl = execFileAsync,
  cwd = toolRoot,
  command = process.execPath,
} = {}) {
  const args = [path.resolve(cwd, "node_modules", "vite", "bin", "vite.js"), "build"];
  try {
    await execFileImpl(command, args, {
      cwd,
      shell: false,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
  } catch (error) {
    const details = [
      error && typeof error === "object" && "stderr" in error ? String(error.stderr).trim() : "",
      error && typeof error === "object" && "stdout" in error ? String(error.stdout).trim() : "",
      error instanceof Error ? error.message : String(error),
    ].filter(Boolean);
    throw new Error(details.join("\n") || "npm run build failed.");
  }
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml; charset=utf-8";
  return "application/octet-stream";
}

function resolveSharedViewIconPackRoot(packId) {
  const mapping = {
    "micro-solid": "vendor/streamline-svg/micro-solid",
    "core-solid": "vendor/streamline-svg/core-solid",
    "micro-line": "vendor/streamline-svg/micro-line",
    "tabler-filled": "vendor/tabler-svg/filled",
    "tabler-outline": "vendor/tabler-svg/outline",
  };
  const relativeRoot = mapping[packId];
  if (!relativeRoot) throw new Error(`Unsupported shared view icon pack: ${packId}`);
  return {
    relativeRoot,
    absoluteRoot: resolveInsideRoot(toolRoot, relativeRoot),
  };
}

async function collectSharedViewIconPackSvg(packRoot, payload, currentRelativeDir = "") {
  const currentAbsoluteDir = currentRelativeDir
    ? resolveInsideRoot(packRoot.absoluteRoot, currentRelativeDir)
    : packRoot.absoluteRoot;
  const entries = await readdir(currentAbsoluteDir, { withFileTypes: true });
  for (const entry of entries) {
    const nextRelative = currentRelativeDir
      ? `${currentRelativeDir}/${entry.name}`.replaceAll("\\", "/")
      : entry.name;
    if (entry.isDirectory()) {
      await collectSharedViewIconPackSvg(packRoot, payload, nextRelative);
      continue;
    }
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".svg")) continue;
    const absolutePath = resolveInsideRoot(packRoot.absoluteRoot, nextRelative);
    const relativePath = `${packRoot.relativeRoot}/${nextRelative}`.replaceAll("\\", "/");
    payload[relativePath] = await readFile(absolutePath, "utf8");
  }
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--root") result.root = argv[++i];
    else if (argv[i] === "--project") result.project = argv[++i];
    else if (argv[i] === "--adapter") throw new Error("--adapter is no longer supported. Project capabilities are declared in .data-editor/project.json.");
    else if (argv[i] === "--port") result.port = argv[++i];
    else if (argv[i] === "--static") result.static = argv[++i];
    else if (argv[i] === "--tool-root") result.toolRoot = argv[++i];
    else if (argv[i] === "--bridge-port") result.bridgePort = argv[++i];
    else if (argv[i] === "--runtime-dir") result.runtimeDir = argv[++i];
    else if (argv[i] === "--logs-dir") result.logsDir = argv[++i];
    else if (argv[i] === "--registry-home") result.registryHome = argv[++i];
  }
  return result;
}

function registerRuntimeStateCleanup() {
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      void shutdownServer(0);
    });
  }
  process.on("uncaughtException", (error) => {
    console.error(error);
    void shutdownServer(1);
  });
  process.on("unhandledRejection", (reason) => {
    console.error(reason);
    void shutdownServer(1);
  });
}

async function shutdownServer(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;
  process.exitCode = exitCode;
  await jobSupervisor.shutdown().catch((error) => console.error(error));
  await Promise.allSettled([...activeEntryActionCompletions.values()]);
  await clearServiceStateIfOwned(runtimeTargetFromArgs(), process.pid).catch(() => {});
  await connectionShutdown.close(server);
  process.exit(exitCode);
}

async function projectContextForUrl(url) {
  return projectContextForId(url.searchParams.get("projectId"));
}

async function projectContextForId(projectId) {
  const registry = await loadProjectRegistry(registryOptions);
  const resolvedProjectId = typeof projectId === "string" && projectId.trim() ? projectId.trim() : registry.activeProjectId;
  const project = registry.projects.find((candidate) => candidate.id === resolvedProjectId);
  if (!project) throw new Error(resolvedProjectId ? `Unknown project: ${resolvedProjectId}` : "No active project is configured.");
  const projectContext = createProjectContext({
    projectRoot: project.root,
    projectId: project.id,
    dataSources: project.dataSources,
    filePolicy: project.filePolicy,
  });
  await ensureEntryActionStateMigration(projectContext);
  return projectContext;
}

async function ensureEntryActionStateMigration(projectContext) {
  const key = projectContext.projectRoot;
  let migration = entryActionStateMigrationByProjectRoot.get(key);
  if (!migration) {
    migration = migrateLegacyEntryActionStateArtifacts(projectContext).catch((error) => {
      entryActionStateMigrationByProjectRoot.delete(key);
      throw error;
    });
    entryActionStateMigrationByProjectRoot.set(key, migration);
  }
  await migration;
}

function runtimeTargetFromArgs() {
  return args.registryHome ? { projectRoot: path.resolve(args.registryHome), runtimeDir: "runtime", logsDir: "logs" } : createProjectContext({
    projectRoot,
    runtimeDir: args.runtimeDir,
    logsDir: args.logsDir,
  });
}
