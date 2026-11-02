import {createConfigurationSaveService} from "./src/configuration-save-service.mjs";
import { serviceProcessIsAlive } from './src/service-process-identity.mjs';
import {createDeploymentRuntime} from './src/deployment-runtime.mjs';
import { findFencingLeaseByRunId, readCurrentFencingAdmission } from './src/fencing-lock.mjs';
import { findExistingRecoveryClaim } from './src/entry-action-recovery.mjs';
import { createReadExecutor, checkReadRequest, withoutReadRequest } from './src/read-request-context.mjs';
import { migrateLegacyEntryActionStateRecord } from './src/entry-action-state.mjs';
import { createProjectReadiness } from './src/project-readiness.mjs';
import { stat } from 'node:fs/promises';
import { publicationObserve, publicationConfigWrite } from './src/publication-window-runtime.mjs';
import { inspectPublicationWindow } from './src/publication-window-state.mjs';
import { readGeneratedFields, assertNoGeneratedFieldInjection } from "./src/generated-fields-service.mjs";
import { loadFieldWritePolicy, assertOrdinarySaveFieldPolicy, ordinarySaveBlockingRuns } from "./src/field-write-policy.mjs";
import { readInlineTemplateDefinitions } from "./src/inline-template-context.mjs";
import { recoverProjectCommandRun } from "./src/project-command-recovery.mjs";
import { createProjectProcessService } from "./src/project-process-service.mjs";
import { assertProjectProcessHttpSource } from "./src/project-process-http.mjs";
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
import { loadAutomationBindings, saveAutomationBindings, validateAutomationBindings } from "./src/automation-bindings.mjs";
import { loadAutomationSkillCatalog } from "./src/automation-skill-catalog.mjs";
import { resolveCodexBindingStatus } from "./src/codex-runtime.mjs";
import { loadAutomationProfile, patchAutomationProfileRule, saveAutomationProfile, validateAutomationProfile } from "./src/automation-profile.mjs";
import { listDataFiles, normalizeDataFileVirtualPath, readTextFile, resolveInsideRoot, writeTextFile } from "./src/file-service.mjs";
import { listViewProfiles, loadViewProfile, saveViewProfile } from "./src/view-profile.mjs";
import { loadUserProfileNames, mergeUserProfileNames, registerUserProfileName } from "./src/user-profile-registry.mjs";
import { assertValidFieldPresentations, loadViewConfig, saveViewConfig } from "./src/view-config.mjs";
import { loadSharedViews, saveSharedViews } from "./src/shared-views.mjs";
import { clearServiceStateIfOwned } from "./src/runtime-state.mjs";
import { createProjectContext } from "./src/project-context.mjs";
import {withHistoricalAuthorSave,projectHistoricalRunActivity} from './src/historical-disposition.mjs';
import { addOrActivateProject, loadProjectRegistry, updateProjectDefinition, removeProject, activateProject, reorderProjects, withProjectRegistryLock } from "./src/project-registry.mjs";
import { inferDefaultProjectRoot } from "./src/default-project-root.mjs";
import { createProjectCapabilityRegistry, findCapabilityBindings } from "./src/project-capability-registry.mjs";
import { loadDocumentContract, DocumentContractError } from "./src/document-contract-service.mjs";
import {
  documentContractAdmissionSnapshot,
  documentContractTokens,
  validateDocumentContractCandidate,
  validateDocumentContractTokenSet,
  verifyDocumentContractPostReplace,
} from "./src/document-contract-compiler.mjs";
import { createConnectionShutdown } from "./src/server-shutdown.mjs";
import {createCurrentConfigurationStore} from './src/current-configuration-store.mjs';
import { createJobSupervisor } from "./src/job-supervisor.mjs";
import { createDocumentCommitCoordinator } from "./src/document-commit-coordinator.mjs";
import { createEntryActionRunRoute } from "./src/entry-action-route.mjs";
import { startProjectSkillEntryAction } from "./src/project-skill-action-service.mjs";
import { submitFreshEntryActionProposal } from "./src/entry-action-service.mjs";
import { submitExactArtifact } from "./src/entry-action-exact-artifact.mjs";
import { publishExactArtifact, readExactArtifact } from "./src/entry-action-exact-artifact-store.mjs";
import { entryActionHttpStatus } from "./src/entry-action-http-error.mjs";
import { createEntryActionCreateAdapterRegistry } from "./src/entry-action-create-adapter-registry.mjs";
import { createCandidateCreateAdmission } from "./src/entry-action-create-admission.mjs";
import { promoteEmbeddedIdentity, recoverPendingEmbeddedIdentityPromotions } from "./src/durable-identity-coordinator.mjs";
import { createPendingEntryActionStore } from "./src/pending-entry-action.mjs";
import { createFencingAllocator } from "./src/fencing-lock.mjs";
import { createCommitJournal } from "./src/commit-journal.mjs";
import { executeJournaledDocumentCommit } from "./src/document-commit-executor.mjs";
import { classifyCommitJournalRecovery } from "./src/commit-journal-recovery.mjs";
import { listSharedViewIconManifestEntries } from "./src/shared-view-icon-manifest.mjs";

const args = parseArgs(process.argv.slice(2));
const registryOptions = args.registryHome ? { home: path.resolve(args.registryHome) } : {};
const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const toolRoot = args.toolRoot ? path.resolve(args.toolRoot) : scriptRoot;
const requestedProjectRoot = args.project ?? args.root;
const projectRoot = path.resolve(requestedProjectRoot ?? inferDefaultProjectRoot({
  toolRoot,
  cwd: process.cwd(),
  registryHome: args.registryHome,
}));
const port = Number(args.port ?? 8787);
const bridgePort = Number(args.bridgePort ?? 8791);
const staticRoot = args.static ? path.resolve(scriptRoot, args.static) : null;
const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const deploymentRuntime=isMainModule?await createDeploymentRuntime('main',scriptRoot):{maintenance:false,refresh:async()=>false};
const execFileAsync = promisify(execFile);
let shuttingDown = false;
const currentConfigurationStore=isMainModule?createCurrentConfigurationStore({registryOptions,contextForProject,getRuntimeState:()=>({maintenance:deploymentRuntime.maintenance,readySelections:deploymentRuntime.readySelections,shuttingDown})}):null;
const configurationSaves=createConfigurationSaveService({currentConfigurationStore,contextForId:projectContextForId,registryOptions,isWritable:()=>!deploymentRuntime.maintenance&&!shuttingDown,validateViewConfig:assertValidFieldPresentations});
let initialProjectPromise = null;
const recoverySignatures = new Map();
const observedProjects=new Map();
const commandRecoveryErrors=new Map();
const closedRecoveryRuns=new Set();
let recoveryPollRunning = false;
let recoveryTimer=null;
let recoveryDiscovery=Promise.resolve();
const projectReadiness = createProjectReadiness({ prepare: prepareProject });
const connectionShutdown = createConnectionShutdown();
const jobSupervisor = createJobSupervisor({ toolRoot });
const documentCommitCoordinator = createDocumentCommitCoordinator();
const createAdapterRegistry = createEntryActionCreateAdapterRegistry();
const submitCandidateCreate = createCandidateCreateAdmission({ adapterRegistry: createAdapterRegistry });
const projectCapabilityRegistry = createProjectCapabilityRegistry(registryOptions);
const projectProcessService = createProjectProcessService(registryOptions);
const activeEntryActionCompletions = new Map();
const runEntryAction = createEntryActionRunRoute({
  capabilityRegistryOptions: registryOptions,
  loadRegistry: async () => {
    await ensureInitialRegistry();
    return loadProjectRegistry(registryOptions);
  },
  toolRoot,
  jobSupervisor,
  documentCommitCoordinator,
  startProjectSkill: startProjectSkillEntryAction,
  projectSkillArtifactPublicationUrl: `http://127.0.0.1:${port}/api/entry-actions/publish-exact-artifact`,
  submitProjectSkillResult: async ({ projectContext, project, request, runId, result, documentCommitCoordinator: coordinator }) => {
    if (result?.kind === "entry-action-proposal") {
      return submitFreshEntryActionProposal({
        projectContext,
        project,
        request,
        result,
        documentCommitCoordinator: coordinator,
        // A project skill already owns this lifecycle; do not create a
        // second invisible child run merely to commit its proposal.
        dependencies: { runId },
      });
    }
    if (result?.kind === "candidate-create") {
      return submitCandidateCreate({ projectContext, project, request, manifest: candidateManifest(result), evidence: result.evidence, humanNotes: request.humanNotes ?? null, documentCommitCoordinator: coordinator });
    }
    throw Object.assign(new Error("Project-skill result kind is unsupported."), { code: "PROJECT_SKILL_RESULT_INVALID", status: 400 });
  },
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
      validateDocumentContractSave({ documentContracts: documentContractTokens(contracts) }, contracts);
      validateDocumentContractCandidateSave(contracts, root);
      await assertDocumentContractsUnchanged(input.projectContext, sourcePath, root, format, contracts);
      return documentContractAdmissionSnapshot(contracts);
    },
    verifyPostReplaceCandidate: async ({ sourcePath, root, format, admissionSnapshot }) => {
      const contracts = await resolveApplicableDocumentContracts(input.projectContext, sourcePath, root, format);
      if (contracts.error) throw contracts.error;
      assertDocumentContractPostReplace(admissionSnapshot, contracts, root);
    },
  }),
  resolveCapabilityState: (project) => projectCapabilityRegistry.resolve(project),
  onCompletion(started) {
    activeEntryActionCompletions.set(started.runId, started.completion);
    void started.completion.finally(() => { activeEntryActionCompletions.delete(started.runId); projectReadiness.invalidateAll(); }).catch(() => {});
  },
});

const readExecutor=createReadExecutor();
const server=http.createServer((req,res)=>{
  if(req.method!=='GET'||req.url?.startsWith('/api/health')){void handleHttp(req,res);return;}
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(Object.assign(new Error('服务端读取超时。'),{code:'READ_TIMEOUT',status:503})),30000);
  res.once('close',()=>{clearTimeout(timer);if(!res.writableEnded)controller.abort();});
  void readExecutor.run(()=>handleHttp(req,res),{signal:controller.signal,priority:req.headers['x-data-editor-read-priority']==='background'?'background':'foreground'}).catch(error=>withoutReadRequest(()=>sendJson(res,{error:error.message,code:error.code},error.status??503))).finally(()=>clearTimeout(timer));
});
async function handleHttp(req, res) {
  res.requestStartedAt=performance.now();
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const profileConfigurationRoute=url.pathname.startsWith('/api/configuration-')||url.pathname.startsWith('/api/view-profile');
    if(!profileConfigurationRoute&&deploymentRuntime.maintenance&&await deploymentRuntime.refresh())startNormalPreparation();
    if(url.pathname==='/api/deployment-attestation'&&req.method==='GET')return sendJson(res,deploymentRuntime.attest(url.searchParams.get('challenge')));
    if(deploymentRuntime.maintenance){
      const pureReads=new Set(['/api/health','/api/configuration-snapshot','/api/projects','/api/files','/api/document','/api/document-metadata','/api/document-index','/api/document-content','/api/document-contracts','/api/field-write-policy','/api/inline-template-definitions','/api/project-capabilities','/api/nested-schema-capabilities','/api/generated-fields','/api/view-config','/api/shared-views','/api/view-profiles','/api/view-profile']);
      if(!(req.method==='GET'&&(!url.pathname.startsWith('/api/')||pureReads.has(url.pathname)))&&!(req.method==='POST'&&url.pathname==='/api/shutdown'))return sendJson(res,{code:'HISTORY_DEPLOYMENT_MAINTENANCE',error:'升级正在进行只读验收。'},503);
    }
    if (url.pathname === '/api/publication-window' && req.method === 'GET') return sendJson(res, await inspectPublicationWindow(contextForProject(await projectForId(url.searchParams.get('projectId')))));
    if (url.pathname === "/api/entry-actions/run" && req.method === "POST") {
      return await handleRunEntryAction(req, res);
    }
    if (url.pathname === "/api/entry-actions/ack-start" && req.method === "POST") {
      return await handleAckStartEntryAction(req, res);
    }
    if (url.pathname === "/api/entry-actions/submit-exact-artifact" && req.method === "POST") return await handleSubmitExactArtifact(req, res);
    if (url.pathname === "/api/entry-actions/publish-exact-artifact" && req.method === "POST") return await handlePublishExactArtifact(req, res);
    if (url.pathname === "/api/health" && req.method === "GET") return sendJson(res, { ok: true, bridgePort });
    if (!url.pathname.startsWith('/api/')) return await serveStatic(url.pathname,res);
    if (url.pathname.startsWith('/api/shared-view-icon-pack') && req.method === 'GET') return url.pathname.endsWith('manifest') ? await handleSharedViewIconPackManifest(url,res) : await handleSharedViewIconPack(url,res);
    await ensureInitialRegistry();
    if (url.pathname === '/api/project-readiness' && req.method === 'GET') {
      const project=await projectForId(url.searchParams.get('projectId'));
      return sendJson(res,projectReadiness.inspect(project),200,{'cache-control':'no-store'});
    }
    if (url.pathname === '/api/project-retry' && req.method === 'POST') {
      const body=await readJsonBody(req);const project=await projectForId(body.projectId);
      await projectReadiness.ensure(project,{retry:true});return sendJson(res,projectReadiness.inspect(project));
    }
    if (url.pathname === "/api/projects" && req.method === "GET") return sendJson(res, await loadProjectRegistry(registryOptions));
    if (url.pathname === "/api/field-write-policy" && req.method === "GET") return sendJson(res, await loadFieldWritePolicy(await projectContextForUrl(url)), 200, { "cache-control": "no-store" });
    if (url.pathname === "/api/inline-template-definitions" && req.method === "GET") return sendJson(res, await readInlineTemplateDefinitions(await projectContextForUrl(url)), 200, { "cache-control": "no-store" });
    if (url.pathname === "/api/project-capabilities" && req.method === "GET") return await handleProjectCapabilities(url, res);
    if (url.pathname === "/api/project-processes" && req.method === "GET") {await projectContextForUrl(url);return sendJson(res, await projectProcessService.list(url.searchParams.get("projectId")), 200, { "cache-control": "no-store" });}
    if (["/api/project-processes/control", "/api/project-processes/authorize"].includes(url.pathname) && req.method === "POST") {
      assertProjectProcessHttpSource(req, Number(args.frontendPort ?? port));
      const body = await readJsonBody(req);
      const result = await projectProcessService[url.pathname.endsWith("/authorize") ? "authorize" : "control"](body);
      return sendJson(res, result, 200, { "cache-control": "no-store" });
    }
    if (url.pathname === "/api/nested-schema-capabilities" && req.method === "GET") return await handleNestedSchemaCapabilities(url, res);
    if (url.pathname === "/api/projects" && req.method === "POST") return await handleCreateProject(req, res);
    if (url.pathname === "/api/projects/reorder" && req.method === "POST") {
      const body = await readJsonBody(req);
      return sendJson(res, { ok: true, registry: await reorderProjects(body.projectIds, registryOptions) });
    }
    if (url.pathname === "/api/project-update" && req.method === "POST") return await handleUpdateProject(req, res);
    if (url.pathname === "/api/project-delete" && req.method === "POST") return await handleDeleteProject(req, res);
    if (url.pathname === "/api/project-activate" && req.method === "POST") return await handleActivateProject(req, res);
    if (url.pathname === "/api/files") return sendJson(res, await listDataFiles(await projectContextForUrl(url)));
    if (url.pathname === "/api/generated-fields" && req.method === "GET") return await handleGeneratedFields(url, res);
    if (url.pathname === "/api/document" || url.pathname === "/api/document-metadata") return await handleDocument(url, res);
    if (url.pathname === "/api/document-index") return await handleDocumentIndex(url, res);
    if (url.pathname === "/api/document-content") return await handleDocumentContent(url, res);
    if (url.pathname === "/api/document-contracts" && req.method === "GET") return await handleDocumentContracts(url, res);
    if (url.pathname === "/api/save" && req.method === "POST") return await handleSave(req, res);
    if (url.pathname === '/api/configuration-snapshot' && req.method === 'GET') return sendJson(res,await configurationSaves.snapshot({kind:url.searchParams.get('kind'),projectId:url.searchParams.get('projectId'),name:url.searchParams.get('name')}),200,{'cache-control':'no-store'});
    if (url.pathname === '/api/configuration-preview' && req.method === 'POST') return sendJson(res,await configurationSaves.preview(await readJsonBody(req)));
    if (url.pathname === '/api/configuration-begin' && req.method === 'POST') return sendJson(res,await configurationSaves.begin(await readJsonBody(req),{isCurrent:()=>!res.destroyed}));
    if (url.pathname === '/api/configuration-save' && req.method === 'POST') return sendJson(res,await configurationSaves.save(await readJsonBody(req)));
    if (url.pathname === '/api/configuration-reconcile' && req.method === 'POST') return sendJson(res,await configurationSaves.reconcile(await readJsonBody(req)));
    if (url.pathname === '/api/configuration-finish' && req.method === 'POST') return sendJson(res,await configurationSaves.finish(await readJsonBody(req)));
    if (url.pathname === "/api/view-config" && req.method === "GET") return sendJson(res, await loadViewConfig(await projectContextForUrl(url)));
    if (url.pathname === "/api/view-config" && req.method === "POST") return await handleSaveViewConfig(req, res);
    if (url.pathname === "/api/shared-views" && req.method === "GET") return sendJson(res, await loadSharedViews(await projectContextForUrl(url)));
    if (url.pathname === "/api/shared-views" && req.method === "POST") return await handleSaveSharedViews(req, res);
    if (url.pathname === "/api/view-profiles") return sendJson(res, mergeUserProfileNames(
      await loadUserProfileNames(registryOptions),
      await listViewProfiles(await projectContextForUrl(url)),
    ));
    if (url.pathname === "/api/view-profile" && req.method === "GET") return await handleLoadViewProfile(url, res);
    if (url.pathname === "/api/view-profile" && req.method === "POST") return await handleSaveViewProfile(req, res);
    if (url.pathname === "/api/automation-profile" && req.method === "GET") return await handleLoadAutomationProfile(url, res);
    if (url.pathname === "/api/automation-profile" && req.method === "POST") return await handleSaveAutomationProfile(req, res);
    if (url.pathname === "/api/automation-settings" && req.method === "POST") return await handleSaveAutomationSettings(req, res);
    if (url.pathname.startsWith("/api/automation-profile/rules/") && req.method === "PATCH") return await handlePatchAutomationProfileRule(url, req, res);
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
    }, entryActionHttpStatus(error), { "cache-control": "no-store" });
  }
}
connectionShutdown.attach(server);

if (isMainModule) {
  assertImplicitStartupDoesNotUseToolRoot(projectRoot, requestedProjectRoot, toolRoot);
  assertTestProjectRegistryIsolation(projectRoot, args.registryHome);
  registerRuntimeStateCleanup();
  if(!deploymentRuntime.maintenance){await ensureInitialRegistry();startNormalPreparation();}
  server.listen(port, "127.0.0.1", () => {
    console.log(`Data Editor running at http://127.0.0.1:${port}`);
    console.log(`Project root: ${projectRoot}`);
  });
}

export function assertImplicitStartupDoesNotUseToolRoot(candidateProjectRoot, requestedProjectRoot, candidateToolRoot) {
  if (requestedProjectRoot) return;
  if (!samePath(candidateProjectRoot, candidateToolRoot)) return;
  throw Object.assign(
    new Error("PROJECT_ROOT_REQUIRED: Start Data Editor with --project or select an existing active project before starting the service."),
    { code: "PROJECT_ROOT_REQUIRED" },
  );
}

export function assertTestProjectRegistryIsolation(candidateProjectRoot, registryHome, repositoryRoot = scriptRoot) {
  if (registryHome) return;
  const project = path.resolve(candidateProjectRoot);
  const isolatedRoots = [
    path.join(repositoryRoot, "tests", "fixtures"),
    path.join(repositoryRoot, "tests", ".scratch"),
  ];
  if (!isolatedRoots.some((root) => isPathInside(root, project))) return;
  throw Object.assign(
    new Error("TEST_PROJECT_REGISTRY_HOME_REQUIRED: Test fixture projects require an explicit --registry-home."),
    { code: "TEST_PROJECT_REGISTRY_HOME_REQUIRED" },
  );
}

function isPathInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function samePath(left, right) {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

async function ensureInitialRegistry() {
  if(deploymentRuntime.maintenance){await loadProjectRegistry(registryOptions);return;}
  initialProjectPromise ??= addOrActivateProject({ root: projectRoot }, registryOptions).catch(error=>{initialProjectPromise=null;throw error;});
  await initialProjectPromise;
}
function startNormalPreparation(){
  if(recoveryTimer)return;
  void ensureInitialProject().catch(error=>console.error('Project preparation:',error.code??error.message));
  recoveryTimer=setInterval(()=>{recoveryDiscovery=discoverRecoveryWork().catch(error=>console.error('Project recovery:',error.code??error.message));},5000);recoveryTimer.unref();
}
async function projectForId(projectId) {
  const registry=await loadProjectRegistry(registryOptions);
  const id=typeof projectId==='string'&&projectId.trim()?projectId.trim():registry.activeProjectId;
  const project=registry.projects.find(item=>item.id===id);
  if(!project)throw Object.assign(new Error('Unknown project: '+id),{status:404});
  observedProjects.set(project.id,project);
  return project;
}
function contextForProject(project) {
  return createProjectContext({projectRoot:project.root,projectId:project.id,capabilityRegistryOptions:registryOptions,dataSources:project.dataSources,filePolicy:project.filePolicy});
}
async function ensureInitialProject() {
  await ensureInitialRegistry();
  const registry=await loadProjectRegistry(registryOptions);
  const project=registry.projects.find(item=>item.id===registry.activeProjectId);
  await Promise.allSettled(registry.projects.map(item=>projectReadiness.ensure(item)));
  return registry;
}
function scheduleProjectPreparation(project){
  if(!project)return;
  projectReadiness.invalidate(project.id);
  void projectReadiness.ensure(project,{retry:true}).catch(error=>console.error('Project preparation:',project.id,error.code??error.message));
}
async function prepareProject(project) {
  const context=contextForProject(project);
  const observedSignature=await recoverySignature(context);
  if(!await hasPreparationWork(project,context)){recoverySignatures.set(project.id,observedSignature);return;}
  const result=await publicationObserve(context,`identity-recovery:${project.id}`,async()=>{
    const capabilityState = await projectCapabilityRegistry.resolve(project);
    const recoveredIdentities=await recoverPendingEmbeddedIdentityPromotions({
      projectContext: context,
      capabilityState,
      verifyPostReplaceCandidate: async ({ sourcePath, root, format, admissionSnapshot }) => {
        const contracts = await resolveApplicableDocumentContracts(context, sourcePath, root, format);
        if (contracts.error) throw contracts.error;
        assertDocumentContractPostReplace(admissionSnapshot, contracts, root);
      },
    });
    if(recoveredIdentities.pending?.length)throw Object.assign(new Error('身份升级恢复尚不能确认，原内容已保留。'),{code:'IDENTITY_PROMOTION_NEEDS_RECOVERY',status:503});
    const pendingStore = createPendingEntryActionStore({ projectContext: context });
    const allocator = createFencingAllocator({ stateRoot: resolveInsideRoot(context.projectRoot, path.join(context.runtimeDir, "entry-action-fencing")) });
    for (const pending of await pendingStore.list()) {
      if (pending?.state !== "pending" || !pendingStore.isExpired(pending)) continue;
      await allocator.cancelPromotion(pending.lease).then(() => pendingStore.write({ ...pending, state: "expired", expiredAt: new Date().toISOString() }));
    }

    await migrateLegacyEntryActionStateArtifacts(context);
  });
  recoverySignatures.set(project.id,observedSignature);
  return result;
}
async function hasPreparationWork(project,context) {
  const projection=await projectCapabilityRegistry.read(project);
  if(projection.error?.code==='CAPABILITY_REFRESH_REQUIRED')return true;
  const base=path.join(context.projectRoot,context.runtimeDir);
  for(const dir of ['identity-promotion-journal','pending-entry-actions','entry-actions']){
    const names=await readdir(path.join(base,dir)).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
    for(const name of names){
      if(!name.endsWith('.json'))continue;
      let value;try{value=JSON.parse(await readFile(path.join(base,dir,name),'utf8'));}catch(error){if(error.code==='ENOENT'||error instanceof SyntaxError)continue;throw error;}
      if(dir==='identity-promotion-journal'&&value.kind==='identity_promotion'&&value.stage==='intent')return true;
      if(dir==='pending-entry-actions'&&value.state==='pending'&&createPendingEntryActionStore({projectContext:context}).isExpired(value))return true;
      const kind=name.endsWith('.started.json')?'started':name.endsWith('.result.json')?'result':null;
      if(dir==='entry-actions'&&kind&&migrateLegacyEntryActionStateRecord(value,kind))return true;
    }
  }
  return false;
}
async function recoverySignature(context) {
  const base=path.join(context.projectRoot,context.runtimeDir);
  const rows=[];
  for(const dir of ['identity-promotion-journal','pending-entry-actions','entry-actions']) {
    const directory=path.join(base,dir);
    const names=await readdir(directory).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
    for(const name of names.sort()){
      const info=await stat(path.join(directory,name)).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
      if(info?.isFile())rows.push([dir,name,info.size,info.mtimeMs]);
    }
  }
  for(const file of ['project.json','enrollment.json']){
    const text=await readFile(path.join(context.projectRoot,'.data-editor',file)).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
    rows.push([file,text===null?null:crypto.createHash('sha256').update(text).digest('hex')]);
  }
  return JSON.stringify(rows);
}
async function discoverRecoveryWork() {
  if(recoveryPollRunning||shuttingDown)return;recoveryPollRunning=true;
  try {
    const registry=await loadProjectRegistry(registryOptions);
    for(const project of registry.projects.filter(item=>observedProjects.has(item.id)||item.id===registry.activeProjectId)){
      const context=contextForProject(project);
      try{
        const signature=await recoverySignature(context);
        if(signature!==recoverySignatures.get(project.id)||projectReadiness.inspect(project).state==='initializing'){
          projectReadiness.invalidate(project.id);
          await projectReadiness.ensure(project,{retry:true});
        }
        await recoverObservedCommands(project,context);
      }catch(error){console.error('Project recovery:',project.id,error.code??error.message);}
    }
  }finally{recoveryPollRunning=false;}
}
async function recoverObservedCommands(project,context){
  const directory=path.join(context.projectRoot,context.runtimeDir,'entry-actions');
  const names=await readdir(directory).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
  for(const name of names){
    if(!name.endsWith('.json')||name.endsWith('.started.json')||name.endsWith('.result.json')||name.endsWith('.followup.json'))continue;
    let handoff;try{handoff=JSON.parse(await readFile(path.join(directory,name),'utf8'));}catch(error){if(error.code==='ENOENT'||error instanceof SyntaxError)continue;throw error;}
    if(handoff?.action?.execution?.kind!=='project-command'||typeof handoff.runId!=='string')continue;
    const key=project.id+':'+handoff.runId;
    if(closedRecoveryRuns.has(key))continue;
    try{
      const terminal=await readEntryActionResult(context,handoff.runId).catch(()=>null);
      if(terminal?.phase==='terminal'){
        const stateRoot=path.join(context.projectRoot,context.runtimeDir,'entry-action-fencing');
        const lease=await findFencingLeaseByRunId(stateRoot,handoff.runId);
        if(!lease){commandRecoveryErrors.delete(key);continue;}
        const current=await readCurrentFencingAdmission(stateRoot,lease.canonicalFileKey);
        if((!current||current.runId!==handoff.runId)&&!await findExistingRecoveryClaim(stateRoot,lease)){commandRecoveryErrors.delete(key);continue;}
      }
      // This predicate only avoids no-op work. Any recovery effect still enters
      // the original full authority, fencing and publication owners below.
      if(await serviceProcessIsAlive(handoff.projectCommand?.writer)===true)continue;
      await recoverProjectCommandRun(context,handoff.runId,documentCommitCoordinator,{observer:true});
      commandRecoveryErrors.delete(key);
    }catch(error){
      if(error.code==='HISTORY_RUN_CLOSED'){closedRecoveryRuns.add(key);if(closedRecoveryRuns.size>1024)closedRecoveryRuns.delete(closedRecoveryRuns.values().next().value);}
      else {commandRecoveryErrors.set(key,error);if(commandRecoveryErrors.size>128)commandRecoveryErrors.delete(commandRecoveryErrors.keys().next().value);}
    }
  }
}

async function handleGeneratedFields(url, res) {
  const context = await projectContextForUrl(url);
  const registry = await loadProjectRegistry(registryOptions);
  const project = registry.projects.find((item) => item.id === context.projectId);
  const sourcePath = url.searchParams.get("path"); const collection = url.searchParams.get("collection");
  if (!sourcePath || !collection || !url.searchParams.get("projectId")) throw Object.assign(new Error("Missing generated field scope"), { status: 400 });
  const state = await projectCapabilityRegistry.read(project);
  sendJson(res, await readGeneratedFields({ project, context, state, sourcePath, collection }), 200, { "cache-control": "no-store" });
}

async function handleDocument(url, res) {
  const relativePath = url.searchParams.get("path");
  if (!relativePath) throw new Error("Missing document path");
  const projectContext = await projectContextForUrl(url);
  const text = await readTextFile(projectContext, relativePath);
  const ext = path.extname(relativePath).toLowerCase();
  const parsed = ext === ".csv" ? { data: parseCsv(text), format: "csv" } : parseJson(text);
  const model=buildDocumentModel(parsed.data,parsed.format,relativePath);
  if(url.pathname==='/api/document-metadata')return sendJson(res,{format:model.format,sourcePath:relativePath,collections:model.collections,documentEtag:documentEtag(text)});
  sendJson(res, {
    ...model,
    documentEtag: documentEtag(text),
  });
}

async function handleProjectCapabilities(url, res) {
  await projectContextForUrl(url);
  const registry = await loadProjectRegistry(registryOptions);
  const requestedProjectId = typeof url.searchParams.get("projectId") === "string" ? url.searchParams.get("projectId").trim() : "";
  const projectId = requestedProjectId || registry.activeProjectId;
  const project = registry.projects.find((candidate) => candidate.id === projectId);
  if (!project) throw new Error(projectId ? `Unknown project: ${projectId}` : "No active project is configured.");
  sendJson(res, await projectCapabilityRegistry.read(project), 200, { "cache-control": "no-cache" });
}

async function handleNestedSchemaCapabilities(url, res) {
  await projectContextForUrl(url);
  const registry = await loadProjectRegistry(registryOptions);
  const projectId = String(url.searchParams.get("projectId") ?? "").trim() || registry.activeProjectId;
  const project = registry.projects.find((candidate) => candidate.id === projectId);
  if (!project) throw new Error(projectId ? `Unknown project: ${projectId}` : "No active project is configured.");
  const state = await projectCapabilityRegistry.read(project);
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
  const capabilityState = await (projectContext.capabilityRegistryOptions?.readOnly ? projectCapabilityRegistry.read(project) : projectCapabilityRegistry.resolve(project));
  if (capabilityState.status === "generic_absent") return { state: capabilityState, contracts: [] };
  if (capabilityState.status !== "active") {
    return { state: capabilityState, contracts: [], error: new DocumentSaveError("DOCUMENT_CONTRACT_CAPABILITY_UNAVAILABLE", "项目 capability 状态不可用于安全保存。", "path", { status: 409, details: capabilityState.error ?? null }) };
  }
  const virtualPath = normalizeDataFileVirtualPath(projectContext, documentPath);
  const separator = virtualPath.indexOf("/");
  const dataSourceId = virtualPath.slice(0, separator);
  const innerPath = virtualPath.slice(separator + 1);
  const bindings = findCapabilityBindings(capabilityState, { engine: "document-contract-v1", dataSourceId, path: innerPath })
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
  const contracts = await Promise.all(bindings.map(async (binding) => ({ binding, loaded: await loadDocumentContract(projectContext.projectRoot, binding) })));
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
    documentContracts: documentContractTokens(resolution),
  }, 200, { "cache-control": "no-cache" });
}

async function handleSave(req, res) {
  try {
    const body = await readJsonBody(req);
    if (!body.path) throw new Error("Missing save path");
    const projectContext = await projectContextForId(body.projectId);
    const ext = path.extname(body.path).toLowerCase();
    if (![".json", ".csv"].includes(ext)) throw new Error(`Unsupported save extension: ${ext}`);
    const text = ext === ".csv" ? serializeCsv(body.root) : serializeJson(body.root);
    const requestDigest = sha256(JSON.stringify({ path: body.path, documentEtag: body.documentEtag, text }));
    const idempotencyKey = resolveDocumentSaveIdempotencyKey(body.idempotencyKey, requestDigest);
    await documentCommitCoordinator.withCommit({ projectContext, sourcePath: body.path }, async (identity) => {
      const active = await findActiveEntryActionRuns(projectContext, body.path);
      const blockingRuns = await ordinarySaveBlockingRuns(projectContext, active.runs);
      if (blockingRuns.length > 0) {
        throw new DocumentSaveError(
          "DOCUMENT_SAVE_ENTRY_ACTION_ACTIVE",
          "当前文件存在正在执行的条目自动化，已暂缓普通保存。",
          "path",
          { status: 409, details: { runs: active.runs } },
        );
      }
      const journal = createCommitJournal({ directory: commitJournalDirectory(projectContext) });
      const existing = await readJournalIfPresent(journal, idempotencyKey);
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
      await assertOrdinarySaveFieldPolicy({ context: projectContext, sourcePath: body.path, beforeRoot: ext === ".csv" ? parseCsv(currentText) : parseJson(currentText).data, afterRoot: body.root });
      const documentContracts = await resolveApplicableDocumentContracts(projectContext, body.path, body.root, ext.slice(1));
      if (documentContracts.error) throw documentContracts.error;
      validateDocumentContractSave(body, documentContracts);
      assertNoGeneratedFieldInjection({ context: projectContext, state: documentContracts.state, sourcePath: body.path, root: body.root });
      validateDocumentContractCandidateSave(documentContracts, body.root);
      await assertDocumentContractsUnchanged(projectContext, body.path, body.root, ext.slice(1), documentContracts);
      // An existing intent owns the snapshot captured by its original request.
      // Verify it before recovery-stage inference or any replacement attempt.
      if (existing?.stage === "commit_intent") {
        assertDocumentContractPostReplace(existing.contractAdmission, documentContracts, body.root);
      }
      await withHistoricalAuthorSave(projectContext,{sourceFile:identity.resolvedPath??identity.canonicalPath,journalFile:path.join(commitJournalDirectory(projectContext),idempotencyKey+'.json')},async()=>{
      if (existing) await resumeDocumentSaveJournal({ journal, entry: existing, currentText });
      else assertDocumentEtagUnchanged(body.documentEtag, currentText);
      const entry = existing ?? createDocumentSaveJournalEntry({ body: { ...body, idempotencyKey }, identity, currentText, text, requestDigest, documentContracts });
      await executeJournaledDocumentCommit({
        journal,
        entry,
        admit: () => assertDocumentContractPostReplace(entry.contractAdmission, documentContracts, body.root),
        replace: () => writeTextFile(projectContext, body.path, text),
        verify: async () => {
          const persisted = await readTextFile(projectContext, body.path);
          if (documentEtag(persisted) !== entry.newEtag || sha256(persisted) !== entry.afterDigest) {
            throw new DocumentSaveError("DOCUMENT_SAVE_VERIFY_FAILED", "保存后的文件未通过完整性校验。", "path", { status: 503 });
          }
          const canonicalRoot = ext === ".csv" ? parseCsv(persisted) : parseJson(persisted).data;
          const currentContracts = await resolveApplicableDocumentContracts(projectContext, body.path, canonicalRoot, ext.slice(1));
          if (currentContracts.error) throw currentContracts.error;
          assertDocumentContractPostReplace(entry.contractAdmission, currentContracts, canonicalRoot);
        },
      });
      });
      sendJson(res, { ok: true, documentEtag: documentEtag(text) });
    });
  } catch (error) {
    if (!(error instanceof DocumentSaveError) && !(error instanceof DocumentContractError) && !error?.code?.startsWith("FIELD_WRITE_POLICY_")) throw error;
    sendJson(res, {
      error: error.message,
      code: error.code,
      field: error.field ?? "contract",
      ...(error.details == null ? {} : { details: error.details }),
    }, error.status, { "cache-control": "no-cache" });
  }
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
  const body=await readJsonBody(req);
  sendJson(res,await configurationSaves.save({...body,descriptor:{kind:'view-config',projectId:body.projectId,},value:body.config}));
}

async function handleSaveSharedViews(req, res) {
  const body=await readJsonBody(req);
  sendJson(res,await configurationSaves.save({...body,descriptor:{kind:'shared-views',projectId:body.projectId,},value:body.config}));
}

async function handleLoadViewProfile(url, res) {
  const name = url.searchParams.get("name");
  if (!name) throw new Error("Missing view profile name");
  sendJson(res, await loadViewProfile(await projectContextForUrl(url), name));
}

async function handleSaveViewProfile(req, res) {
  const body=await readJsonBody(req);
  sendJson(res,await configurationSaves.save({...body,descriptor:{kind:'view-profile',projectId:body.projectId,name:body.name},value:body.profile}));
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

async function handleSaveAutomationSettings(req, res) {
  const body = await readJsonBody(req);
  const projectContext = await projectContextForId(body.projectId);
  const profile = validateAutomationProfile(body?.profile);
  const bindings = validateAutomationBindings(body?.bindings);
  const referencedPreflights = new Set(profile?.rules?.flatMap((rule) => {
    const preflightId = rule?.execution?.advancedExecution?.projectInput?.preflightId;
    return typeof preflightId === "string" && preflightId.trim() ? [preflightId.trim()] : [];
  }) ?? []);
  for (const preflightId of referencedPreflights) {
    if (!bindings.preflights?.[preflightId]) {
      return sendJson(res, { error: `Selected preflight is unavailable: ${preflightId}`, code: "AUTOMATION_PREFLIGHT_REFERENCE_INVALID" }, 400);
    }
  }
  return publicationConfigWrite(projectContext,async () => {
  const previousBindings = await loadAutomationBindings(projectContext);
  try {
    const savedBindings = await saveAutomationBindings(projectContext, bindings, { expectedRevision: body?.bindingsRevision ?? null });
    try {
      const savedProfile = await saveAutomationProfile(projectContext, profile, body?.profileEtag ?? null);
      sendJson(res, { ok: true, profile: savedProfile, bindings: savedBindings });
    } catch (error) {
      try {
        await saveAutomationBindings(projectContext, previousBindings, { expectedRevision: savedBindings.revision });
      } catch (rollbackError) {
        throw new Error(`规则配置保存失败，且本机绑定恢复失败：${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
      }
      throw error;
    }
  } catch (error) {
    if (["AUTOMATION_PROFILE_ETAG_STALE", "AUTOMATION_BINDINGS_REVISION_STALE"].includes(error?.code)) {
      return sendJson(res, { error: error.message, code: error.code }, 409);
    }
    throw error;
  }
  });
}

async function handlePatchAutomationProfileRule(url, req, res) {
  const ruleId = decodeURIComponent(url.pathname.slice("/api/automation-profile/rules/".length));
  const body = await readJsonBody(req);
  const projectContext = await projectContextForId(body.projectId);
  try {
    const result = await patchAutomationProfileRule(projectContext, ruleId, body.rule, body.etag, body.ruleDigest);
    sendJson(res, { ok: true, ...result });
  } catch (error) {
    if (["AUTOMATION_PROFILE_ETAG_STALE", "AUTOMATION_PROFILE_RULE_STALE"].includes(error?.code)) return sendJson(res, { error: error.message, code: error.code, field: "etag" }, 409);
    if (error?.code === "AUTOMATION_PROFILE_RULE_NOT_FOUND") return sendJson(res, { error: error.message, code: error.code, field: "ruleId" }, 404);
    throw error;
  }
}

function validateDocumentContractSave(body, resolution) {
  const tokens = body.documentContracts;
  const check = validateDocumentContractTokenSet(tokens, resolution);
  if (check.ok) return;
  const status = check.code === "DOCUMENT_CONTRACT_TOKEN_STALE" ? 409 : 400;
  const message = check.code === "DOCUMENT_CONTRACT_TOKEN_UNEXPECTED"
    ? "未命中文档合同的保存请求不得携带 documentContracts token。"
    : check.code === "DOCUMENT_CONTRACT_TOKEN_MISSING"
      ? "命中文档合同的保存请求必须携带 documentContracts token。"
      : "documentContracts token 与当前 capability 或合同不一致。";
  throw new DocumentSaveError(check.code, message, "documentContracts", { status, ...(check.expected ? { details: { expected: check.expected } } : {}) });
}

function validateDocumentContractCandidateSave(resolution, root) {
  const candidate = validateDocumentContractCandidate(resolution, root);
  if (candidate.ok) return;
  throw new DocumentSaveError(
    "DOCUMENT_CONTRACT_CANDIDATE_INVALID",
    "文档候选内容不满足已声明的 document contract。",
    "documentContracts",
    { status: 422, details: { issues: candidate.issues } },
  );
}

async function assertDocumentContractsUnchanged(projectContext, documentPath, root, format, previous) {
  const current = await resolveApplicableDocumentContracts(projectContext, documentPath, root, format);
  if (current.error) throw current.error;
  assertDocumentContractPostReplace(documentContractAdmissionSnapshot(previous), current, root);
}

function assertDocumentContractPostReplace(admissionSnapshot, resolution, root) {
  const check = verifyDocumentContractPostReplace({ admissionSnapshot, resolution, root });
  if (check.ok) return;
  if (check.code === "DOCUMENT_CONTRACT_CANDIDATE_INVALID") {
    throw new DocumentSaveError(check.code, "文档候选内容不满足已声明的 document contract。", "documentContracts", { status: 422, details: { issues: check.issues } });
  }
  throw new DocumentSaveError(check.code, "保存期间 capability 或文档合同发生变化。", "documentContracts", { status: 409, details: { expected: check.expected, actual: check.actual } });
}

function commitJournalDirectory(projectContext) {
  return resolveInsideRoot(projectContext.projectRoot, path.join(projectContext.runtimeDir, "commit-journal"));
}

async function readJournalIfPresent(journal, idempotencyKey) {
  try { return await journal.read(idempotencyKey); }
  catch (error) { if (error?.code === "COMMIT_JOURNAL_MISSING") return null; throw error; }
}

function createDocumentSaveJournalEntry({ body, identity, currentText, text, requestDigest, documentContracts }) {
  return {
    idempotencyKey: body.idempotencyKey,
    saveType: "document_save",
    canonicalFileKey: identity.canonicalFileKey,
    baseEtag: documentEtag(currentText), newEtag: documentEtag(text),
    beforeDigest: sha256(currentText), afterDigest: sha256(text), requestDigest,
    // Before result publication, this flag means post-replace recovery must revalidate the canonical candidate and current contracts.
    recovery_pending: true,
    contractAdmission: documentContractAdmissionSnapshot(documentContracts),
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

function resolveDocumentSaveIdempotencyKey(value, requestDigest) {
  if (value == null || value === "") return `legacy_${requestDigest}`;
  assertDocumentSaveIdempotencyKey(value);
  return value;
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
  const result = await saveAutomationBindings(projectContext, bindings);
  sendJson(res, { ok: true, ...result });
}

async function handleCreateProject(req, res) {
  const body = await readJsonBody(req);
  const result = await addOrActivateProject(body, registryOptions);
  scheduleProjectPreparation(result.project);
  sendJson(res, { ok: true, activeProjectId: result.registry.activeProjectId, project: result.project, registry: result.registry });
}

async function handleUpdateProject(req, res) {
  const body = await readJsonBody(req);
  const saved = await updateProjectDefinition(body, registryOptions);
  scheduleProjectPreparation(saved.projects.find(item=>item.id===body.id));
  sendJson(res, { ok: true, registry: saved });
}

async function handleDeleteProject(req, res) {
  const body = await readJsonBody(req);
  if (!body.projectId) throw new Error("Missing project id");
  const saved = await removeProject(body.projectId, { ...registryOptions, beforeRemove: async project => {
    const context = createProjectContext({ projectRoot: project.root, projectId: project.id,
      capabilityRegistryOptions: registryOptions, dataSources: project.dataSources, filePolicy: project.filePolicy });
    const active = await findActiveEntryActionRuns(context);
    if (active.runs.length) throw Object.assign(new Error("项目有未完成的自动化任务，请完成任务后再移除。"), { status: 409 });
  } });
  sendJson(res, { ok: true, registry: saved });
}

async function handleActivateProject(req, res) {
  const body = await readJsonBody(req);
  const projectId = body.projectId;
  if (!projectId) throw new Error("Missing project id");
  const saved = await activateProject(projectId, registryOptions);
  scheduleProjectPreparation(saved.projects.find(item=>item.id===projectId));
  sendJson(res, { ok: true, activeProjectId: saved.activeProjectId, registry: saved });
}

async function handleRunEntryAction(req, res) {
  const body = await readJsonBody(req);
  await ensureInitialRegistry();
  sendJson(res, await withProjectRegistryLock(() => runEntryAction.run(body), registryOptions));
}

async function handleAckStartEntryAction(req, res) {
  const body = await readJsonBody(req);
  await ensureInitialRegistry();
  sendJson(res, await withProjectRegistryLock(() => runEntryAction.ackStart(body), registryOptions));
}

async function handleSubmitExactArtifact(req, res) {
  const body = await readJsonBody(req);
  const registry = await loadProjectRegistry(registryOptions);
  const project = registry.projects.find((candidate) => candidate.id === body.projectId);
  if (!project) throw Object.assign(new Error("Unknown project."), { code: "ENTRY_ACTION_PROJECT_UNKNOWN", status: 404 });
  const projectContext = await projectContextForId(project.id);
  const submitted = await submitExactArtifact(body, {
    readArtifact: ({ artifactId }) => readExactArtifact({ projectContext, artifactId }),
    submitFreshArtifact: async ({ runId, artifact, target, actionId }) => {
      let envelope;
      try { envelope = JSON.parse(artifact.content); }
      catch (cause) { throw Object.assign(new Error("Exact artifact envelope is invalid."), { code: "EXACT_ARTIFACT_CONTENT_INVALID", cause }); }
      if (!envelope || typeof envelope !== "object" || Array.isArray(envelope) || Object.keys(envelope).sort().join(",") !== "result,target,version" || envelope.version !== 1) throw Object.assign(new Error("Exact artifact envelope is invalid."), { code: "EXACT_ARTIFACT_CONTENT_INVALID", status: 400 });
      if (!envelope.target || envelope.target.sourcePath !== target.sourcePath || envelope.target.collectionPath !== target.collectionPath) throw Object.assign(new Error("Exact artifact target does not match submission."), { code: "EXACT_ARTIFACT_TARGET_MISMATCH", status: 409 });
      const request = { projectId: project.id, actionId, sourcePath: target.sourcePath, collectionPath: target.collectionPath, rowId: envelope.target.rowId ?? null, expectedRowDigest: envelope.target.expectedRowDigest ?? null };
      if (envelope.result?.kind === "entry-action-proposal") return submitFreshEntryActionProposal({ projectContext, project, request, result: envelope.result, documentCommitCoordinator, dependencies: { runId } });
      if (envelope.result?.kind === "candidate-create") {
        if (Object.hasOwn(envelope.result, "humanNotes")) throw Object.assign(new Error("Model artifact may not contain humanNotes."), { code: "EXACT_ARTIFACT_CONTENT_INVALID", status: 400 });
        return submitCandidateCreate({ projectContext, project, request, manifest: candidateManifest(envelope.result), evidence: envelope.result.evidence ?? [], humanNotes: artifact.humanNotes, documentCommitCoordinator, dependencies: { runId } });
      }
      throw Object.assign(new Error("Exact artifact result is invalid."), { code: "EXACT_ARTIFACT_CONTENT_INVALID", status: 400 });
    },
  });
  sendJson(res, { ok: true, ...submitted });
}

function candidateManifest(result) {
  if (result?.manifest) return result.manifest;
  const { evidence: _evidence, ...manifest } = result;
  return manifest;
}

async function handlePublishExactArtifact(req, res) {
  const body = await readJsonBody(req);
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).sort().join(",") !== "artifactId,content,humanNotes,projectId") throw Object.assign(new Error("Exact artifact publication request is invalid."), { code: "EXACT_ARTIFACT_PUBLICATION_REQUEST_INVALID" });
  const registry = await loadProjectRegistry(registryOptions);
  const project = registry.projects.find((candidate) => candidate.id === body.projectId);
  if (!project) throw Object.assign(new Error("Unknown project."), { code: "ENTRY_ACTION_PROJECT_UNKNOWN" });
  const projectContext = await projectContextForId(project.id);
  const published = await publishExactArtifact({ projectContext, artifactId: body.artifactId, content: body.content, humanNotes: body.humanNotes });
  sendJson(res, { ok: true, receiptVersion: 1, ...published });
}

async function handleLoadEntryActionResult(url, res) {
  const runId = String(url.searchParams.get("runId") ?? "").trim();
  if (!runId) throw new Error("Missing runId");
  const projectContext = contextForProject(await projectForId(url.searchParams.get('projectId')));
  const recoveryError=commandRecoveryErrors.get(projectContext.projectId+':'+runId);
  if(recoveryError)throw recoveryError;
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
  const projectContext = contextForProject(await projectForId(url.searchParams.get('projectId')));
  let run = await findLatestEntryActionRun(projectContext, {
    actionId,
    sourcePath,
    collectionPath,
    rowId,
    sourceRowIndex,
  });
  if (run?.runId) {
    const historical=await projectHistoricalRunActivity(projectContext,[run]);
    if(historical.historicalRuns.length){sendJson(res,{run:null,historicalRun:historical.historicalRuns[0]});return;}
    run = await findLatestEntryActionRun(projectContext, { actionId, sourcePath, collectionPath, rowId, sourceRowIndex });
  }
  sendJson(res, { run });
}

async function handleLoadActiveEntryActionRuns(url, res) {
  const sourcePath = normalizeEntryActionPath(url.searchParams.get("sourcePath"), "sourcePath");
  const projectContext = contextForProject(await projectForId(url.searchParams.get('projectId')));
  const active = await findActiveEntryActionRuns(projectContext, sourcePath);
  sendJson(res, active);
}

async function handleLoadEntryActionOutput(url, res) {
  const runId = String(url.searchParams.get("runId") ?? "").trim();
  if (!runId) throw new Error("Missing runId");
  const projectContext = contextForProject(await projectForId(url.searchParams.get('projectId')));
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
  if(res.destroyed||res.writableEnded)return;
  if(status<400)checkReadRequest();
  const text=JSON.stringify(data);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "server-timing":`total;dur=${(performance.now()-(res.requestStartedAt??performance.now())).toFixed(2)}`, "cache-control":"no-store", ...headers });
  res.end(text);
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
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch (cause) { throw Object.assign(new Error("Request body must be valid JSON."), { code: "HTTP_REQUEST_JSON_INVALID", cause }); }
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
    checkReadRequest();
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
    else if (argv[i] === "--frontend-port") result.frontendPort = argv[++i];
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
  clearInterval(recoveryTimer);
  await recoveryDiscovery;
  await projectReadiness.settled();
  process.exitCode = exitCode;
  await configurationSaves.close().catch(()=>{});
  await jobSupervisor.shutdown().catch((error) => console.error(error));
  await Promise.allSettled([...activeEntryActionCompletions.values()]);
  await clearServiceStateIfOwned(runtimeTargetFromArgs(), process.pid).catch(() => {});
  await connectionShutdown.close(server);
  process.exit(exitCode);
}

async function projectContextForUrl(url) {
  const project=await projectForId(url.searchParams.get("projectId"));
  // Read the requested inputs directly. Lifecycle recovery has its own status
  // endpoint; it is neither a prerequisite nor an authority permit for a GET.
  checkReadRequest();
  const context=contextForProject(project);
  return {...context,capabilityRegistryOptions:{...registryOptions,readOnly:true}};
}

async function projectContextForId(projectId) {
  const project=await projectForId(projectId);
  return contextForProject(project);
}

function runtimeTargetFromArgs() {
  return args.registryHome ? { projectRoot: path.resolve(args.registryHome), runtimeDir: "runtime", logsDir: "logs" } : createProjectContext({
    projectRoot,
    runtimeDir: args.runtimeDir,
    logsDir: args.logsDir,
  });
}
