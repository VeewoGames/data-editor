import http from "node:http";
import crypto from "node:crypto";
import path from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parseCsv, serializeCsv } from "./src/csv-codec.mjs";
import { parseJson, serializeJson } from "./src/json-codec.mjs";
import { buildDocumentModel } from "./src/document-model.mjs";
import { buildDocumentIndex, readResolvedDocument } from "./src/document-service.mjs";
import {
  buildEntryActionHandoff,
  createEntryActionRunId,
  entryActionHandoffPath,
  describeEntryActionArtifacts,
  entryActionOutputPath,
  findActiveEntryActionRuns,
  findLatestEntryActionRun,
  findAutomationEntryAction,
  normalizeEntryActionPath,
  normalizeEntryActionRowId,
  normalizeEntryActionSourceRowIndex,
  readEntryActionResult,
  readEntryActionStarted,
  resolveAutomationEntryActionBinding,
  resolveEntryActionRow,
  validateEntryActionTarget,
  writeEntryActionHandoff,
} from "./src/entry-actions.mjs";
import { loadAutomationBindings, saveAutomationBindings } from "./src/automation-bindings.mjs";
import { loadAutomationSkillCatalog } from "./src/automation-skill-catalog.mjs";
import { loadAutomationProfile, saveAutomationProfile } from "./src/automation-profile.mjs";
import { resolveAutomationExecutionConfig } from "./src/automation-runtime.mjs";
import { resolveCodexBindingStatus } from "./src/codex-runtime.mjs";
import { listDataFiles, readTextFile, resolveInsideRoot, writeTextFile } from "./src/file-service.mjs";
import { listViewProfiles, loadViewProfile, saveViewProfile } from "./src/view-profile.mjs";
import { loadViewConfig, saveViewConfig } from "./src/view-config.mjs";
import { loadSharedViews, saveSharedViews } from "./src/shared-views.mjs";
import { clearServiceStateIfOwned } from "./src/runtime-state.mjs";
import { createProjectContext } from "./src/project-context.mjs";
import { addOrActivateProject, loadProjectRegistry, saveProjectRegistry } from "./src/project-registry.mjs";
import { createConnectionShutdown } from "./src/server-shutdown.mjs";
import { createJobSupervisor } from "./src/job-supervisor.mjs";
import { createDocumentCommitCoordinator } from "./src/document-commit-coordinator.mjs";
import { createCommitJournal } from "./src/commit-journal.mjs";
import { executeJournaledDocumentCommit } from "./src/document-commit-executor.mjs";
import { classifyCommitJournalRecovery } from "./src/commit-journal-recovery.mjs";
import { listSharedViewIconManifestEntries } from "./src/shared-view-icon-manifest.mjs";
import {
  loadSkillNodeContract,
  matchesIfNoneMatch,
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
const connectionShutdown = createConnectionShutdown();
const jobSupervisor = createJobSupervisor({ toolRoot });
const documentCommitCoordinator = createDocumentCommitCoordinator();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/api/entry-actions/run" && req.method === "POST") {
      return sendJson(
        res,
        {
          error: "条目自动化写回协议正在安全升级，当前禁止启动新任务。",
          code: "ENTRY_ACTION_PROTOCOL_DISABLED",
          field: "entryAction",
          details: { protocolMode: "legacy-disabled" },
        },
        503,
        { "cache-control": "no-store" },
      );
    }
    await ensureInitialProject();
    if (url.pathname === "/api/projects" && req.method === "GET") return sendJson(res, await loadProjectRegistry(registryOptions));
    if (url.pathname === "/api/projects" && req.method === "POST") return await handleCreateProject(req, res);
    if (url.pathname === "/api/project-update" && req.method === "POST") return await handleUpdateProject(req, res);
    if (url.pathname === "/api/project-delete" && req.method === "POST") return await handleDeleteProject(req, res);
    if (url.pathname === "/api/project-activate" && req.method === "POST") return await handleActivateProject(req, res);
    if (url.pathname === "/api/files") return sendJson(res, await listDataFiles(await projectContextForUrl(url)));
    if (url.pathname === "/api/document") return await handleDocument(url, res);
    if (url.pathname === "/api/document-index") return await handleDocumentIndex(url, res);
    if (url.pathname === "/api/document-content") return await handleDocumentContent(url, res);
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
    sendJson(res, { error: error.message }, 500);
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

function ensureInitialProject() {
  initialProjectPromise ??= addOrActivateProject({ root: projectRoot, adapter: args.adapter ?? "nocturnel" }, registryOptions);
  return initialProjectPromise;
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
      const validatedContract = isSkillDocumentPath(body.path)
        ? await validateSkillDocumentSave(body, projectContext)
        : null;
      if (validatedContract) await assertSkillNodeContractUnchanged(projectContext, validatedContract.etag);
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
    if (!(error instanceof SkillNodeContractError) && !(error instanceof SkillDocumentSaveError) && !(error instanceof DocumentSaveError)) throw error;
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

function isSkillDocumentPath(documentPath) {
  if (typeof documentPath !== "string") return false;
  return documentPath.replaceAll("\\", "/").replace(/^\.\//, "") === "data/content/skills.json";
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

  const current = await loadSkillNodeContract(projectContext.projectRoot);
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
  const current = await loadSkillNodeContract(projectContext.projectRoot);
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
    const { contract, etag } = await loadSkillNodeContract(projectContext.projectRoot);
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
    adapterId: project.adapter,
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
  const projectId = String(body.projectId ?? "").trim();
  if (!projectId) throw new Error("Missing projectId");

  const registry = await loadProjectRegistry(registryOptions);
  if (registry.activeProjectId !== projectId) {
    throw new Error(`Entry actions are limited to the active project: ${projectId}`);
  }
  const project = registry.projects.find((candidate) => candidate.id === projectId);
  if (!project) throw new Error(`Unknown project: ${projectId}`);

  const projectContext = createProjectContext({
    projectRoot: project.root,
    adapterId: project.adapter,
    dataSources: project.dataSources,
    filePolicy: project.filePolicy,
  });
  const profile = await loadAutomationProfile(projectContext);
  const bindings = await loadAutomationBindings(projectContext);
  const action = findAutomationEntryAction(profile, body.actionId);
  const binding = resolveAutomationEntryActionBinding(bindings, action.id);
  const bindingStatus = await resolveCodexBindingStatus(binding, { projectRoot: projectContext.projectRoot });
  if (bindingStatus.status !== "ready") {
    sendJson(res, { error: bindingStatus.message ?? "当前设备绑定不可用。" }, 400);
    return;
  }
  const sourcePath = normalizeEntryActionPath(body.sourcePath, "sourcePath");
  const collectionPath = normalizeEntryActionPath(body.collectionPath, "collectionPath");
  const rowId = normalizeEntryActionRowId(body.rowId);
  const sourceRowIndex = normalizeEntryActionSourceRowIndex(body.sourceRowIndex);
  if (rowId == null && sourceRowIndex == null) {
    throw new Error("Entry action requires rowId or sourceRowIndex");
  }
  if (sourceRowIndex == null) {
    throw new Error("Entry action MVP requires sourceRowIndex");
  }

  validateEntryActionTarget(action, sourcePath, collectionPath);
  const text = await readTextFile(projectContext, sourcePath);
  const ext = path.extname(sourcePath).toLowerCase();
  const parsed = ext === ".csv" ? { data: parseCsv(text), format: "csv" } : parseJson(text);
  const model = buildDocumentModel(parsed.data, parsed.format, sourcePath);
  const { row, previousRow, nextRow, rowCount, sourceRowIndex: resolvedSourceRowIndex } = resolveEntryActionRow(model, collectionPath, sourceRowIndex, rowId);
  const executionConfig = resolveAutomationExecutionConfig({
    rule: action,
    binding,
    defaults: bindings.defaults,
  });
  const runId = createEntryActionRunId();
  const handoff = buildEntryActionHandoff({
    runId,
    project,
    action,
    binding,
    runtime: executionConfig.runtime,
    sourcePath,
    collectionPath,
    rowId,
    sourceRowIndex: resolvedSourceRowIndex,
    row,
    previousRow,
    nextRow,
    rowCount,
  });
  const handoffPath = await writeEntryActionHandoff(projectContext, runId, handoff);

  spawn(process.execPath, [path.resolve(toolRoot, "scripts", "run-entry-action.mjs"), "--handoff", handoffPath], {
    cwd: toolRoot,
    shell: false,
    windowsHide: true,
    // On Windows the fire-and-forget child can die before startup if it stays attached.
    detached: true,
    stdio: "ignore",
  }).unref();

  sendJson(res, {
    ok: true,
    status: "started",
    runId,
    handoffPath: entryActionHandoffPath(projectContext, runId),
  });
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
    else if (argv[i] === "--adapter") result.adapter = argv[++i];
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
  return createProjectContext({
    projectRoot: project.root,
    adapterId: project.adapter,
    dataSources: project.dataSources,
    filePolicy: project.filePolicy,
  });
}

function runtimeTargetFromArgs() {
  return args.registryHome ? { projectRoot: path.resolve(args.registryHome), runtimeDir: "runtime", logsDir: "logs" } : createProjectContext({
    projectRoot,
    adapterId: args.adapter,
    runtimeDir: args.runtimeDir,
    logsDir: args.logsDir,
  });
}
