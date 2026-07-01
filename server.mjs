import http from "node:http";
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
  buildEntryActionHandoff,
  createEntryActionRunId,
  entryActionHandoffPath,
  findEntryAction,
  normalizeEntryActionPath,
  normalizeEntryActionRowId,
  normalizeEntryActionSourceRowIndex,
  readEntryActionStarted,
  resolveEntryActionRow,
  validateEntryActionTarget,
  writeEntryActionHandoff,
} from "./src/entry-actions.mjs";
import { listDataFiles, readTextFile, resolveInsideRoot, writeTextFile } from "./src/file-service.mjs";
import { listViewProfiles, loadViewProfile, saveViewProfile } from "./src/view-profile.mjs";
import { loadViewConfig, saveViewConfig } from "./src/view-config.mjs";
import { loadSharedViews, saveSharedViews } from "./src/shared-views.mjs";
import { clearServiceStateIfOwned } from "./src/runtime-state.mjs";
import { createProjectContext } from "./src/project-context.mjs";
import { addOrActivateProject, loadProjectRegistry, saveProjectRegistry } from "./src/project-registry.mjs";
import { createConnectionShutdown } from "./src/server-shutdown.mjs";
import { listSharedViewIconManifestEntries } from "./src/shared-view-icon-manifest.mjs";

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

const server = http.createServer(async (req, res) => {
  try {
    await ensureInitialProject();
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/api/projects" && req.method === "GET") return sendJson(res, await loadProjectRegistry(registryOptions));
    if (url.pathname === "/api/projects" && req.method === "POST") return await handleCreateProject(req, res);
    if (url.pathname === "/api/project-update" && req.method === "POST") return await handleUpdateProject(req, res);
    if (url.pathname === "/api/project-delete" && req.method === "POST") return await handleDeleteProject(req, res);
    if (url.pathname === "/api/project-activate" && req.method === "POST") return await handleActivateProject(req, res);
    if (url.pathname === "/api/entry-actions/run" && req.method === "POST") return await handleRunEntryAction(req, res);
    if (url.pathname === "/api/files") return sendJson(res, await listDataFiles(await projectContextForUrl(url)));
    if (url.pathname === "/api/document") return await handleDocument(url, res);
    if (url.pathname === "/api/document-index") return await handleDocumentIndex(url, res);
    if (url.pathname === "/api/document-content") return await handleDocumentContent(url, res);
    if (url.pathname === "/api/save" && req.method === "POST") return await handleSave(req, res);
    if (url.pathname === "/api/view-config" && req.method === "GET") return sendJson(res, await loadViewConfig(await projectContextForUrl(url)));
    if (url.pathname === "/api/view-config" && req.method === "POST") return await handleSaveViewConfig(req, res);
    if (url.pathname === "/api/shared-views" && req.method === "GET") return sendJson(res, await loadSharedViews(await projectContextForUrl(url)));
    if (url.pathname === "/api/shared-views" && req.method === "POST") return await handleSaveSharedViews(req, res);
    if (url.pathname === "/api/view-profiles") return sendJson(res, await listViewProfiles(await projectContextForUrl(url)));
    if (url.pathname === "/api/view-profile" && req.method === "GET") return await handleLoadViewProfile(url, res);
    if (url.pathname === "/api/view-profile" && req.method === "POST") return await handleSaveViewProfile(req, res);
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
  sendJson(res, buildDocumentModel(parsed.data, parsed.format, relativePath));
}

async function handleSave(req, res) {
  const body = await readJsonBody(req);
  if (!body.path) throw new Error("Missing save path");
  const projectContext = await projectContextForId(body.projectId);
  const ext = path.extname(body.path).toLowerCase();
  if (![".json", ".csv"].includes(ext)) throw new Error(`Unsupported save extension: ${ext}`);
  const text = ext === ".csv" ? serializeCsv(body.root) : serializeJson(body.root);
  await writeTextFile(projectContext, body.path, text);
  sendJson(res, { ok: true });
}

async function handleDocumentIndex(url, res) {
  const relativePath = url.searchParams.get("path");
  if (!relativePath) throw new Error("Missing document path");
  const projectContext = await projectContextForUrl(url);
  const viewConfig = await loadViewConfig(projectContext);
  sendJson(res, await buildDocumentIndex(projectContext, viewConfig.documentFiles, relativePath));
}

async function handleDocumentContent(url, res) {
  const relativePath = url.searchParams.get("path");
  const documentId = url.searchParams.get("id");
  if (!relativePath) throw new Error("Missing document path");
  if (!documentId) throw new Error("Missing document id");
  const projectContext = await projectContextForUrl(url);
  const viewConfig = await loadViewConfig(projectContext);
  sendJson(res, await readResolvedDocument(projectContext, viewConfig.documentFiles, relativePath, documentId));
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
  const action = findEntryAction(project, body.actionId);
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
  const { row, previousRow, nextRow, rowCount } = resolveEntryActionRow(model, collectionPath, sourceRowIndex);
  const runId = createEntryActionRunId();
  const handoff = buildEntryActionHandoff({
    runId,
    project,
    action,
    sourcePath,
    collectionPath,
    rowId,
    sourceRowIndex,
    row,
    previousRow,
    nextRow,
    rowCount,
  });
  const handoffPath = await writeEntryActionHandoff(projectContext, runId, handoff);

  await execFileAsync(process.execPath, [path.resolve(toolRoot, "scripts", "run-entry-action.mjs"), "--handoff", handoffPath], {
    cwd: toolRoot,
    shell: false,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });

  const started = await readEntryActionStarted(projectContext, runId);
  sendJson(res, {
    ok: true,
    status: started.status,
    runId,
    handoffPath: entryActionHandoffPath(projectContext, runId),
  });
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

function sendJson(res, data, status = 200) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
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
