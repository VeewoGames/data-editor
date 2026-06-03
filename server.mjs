import http from "node:http";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parseCsv, serializeCsv } from "./src/csv-codec.mjs";
import { parseJson, serializeJson } from "./src/json-codec.mjs";
import { buildDocumentModel } from "./src/document-model.mjs";
import { listDataFiles, readTextFile, resolveInsideRoot, writeTextFileWithBackup } from "./src/file-service.mjs";
import { listViewProfiles, loadViewProfile, saveViewProfile } from "./src/view-profile.mjs";
import { loadViewConfig, saveViewConfig } from "./src/view-config.mjs";
import { clearServiceStateIfOwned } from "./src/runtime-state.mjs";
import { createProjectContext } from "./src/project-context.mjs";

const args = parseArgs(process.argv.slice(2));
const projectRoot = path.resolve(args.project ?? args.root ?? process.cwd());
const projectContext = createProjectContext({
  projectRoot,
  adapterId: args.adapter,
  runtimeDir: args.runtimeDir,
  logsDir: args.logsDir,
});
const port = Number(args.port ?? 8787);
const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const toolRoot = args.toolRoot ? path.resolve(args.toolRoot) : scriptRoot;
const bridgePort = Number(args.bridgePort ?? 8791);
const staticRoot = args.static ? path.resolve(scriptRoot, args.static) : null;
const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const execFileAsync = promisify(execFile);
let shuttingDown = false;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/api/files") return sendJson(res, await listDataFiles(projectContext));
    if (url.pathname === "/api/document") return handleDocument(url, res);
    if (url.pathname === "/api/save" && req.method === "POST") return handleSave(req, res);
    if (url.pathname === "/api/view-config" && req.method === "GET") return sendJson(res, await loadViewConfig(projectContext));
    if (url.pathname === "/api/view-config" && req.method === "POST") return handleSaveViewConfig(req, res);
    if (url.pathname === "/api/view-profiles") return sendJson(res, await listViewProfiles(projectContext));
    if (url.pathname === "/api/view-profile" && req.method === "GET") return handleLoadViewProfile(url, res);
    if (url.pathname === "/api/view-profile" && req.method === "POST") return handleSaveViewProfile(req, res);
    if (url.pathname === "/api/health" && req.method === "GET") return sendJson(res, { ok: true, bridgePort });
    if (url.pathname === "/api/rebuild" && req.method === "POST") return handleRebuild(res);
    if (url.pathname === "/api/shutdown" && req.method === "POST") return handleShutdown(res);
    return serveStatic(url.pathname, res);
  } catch (error) {
    sendJson(res, { error: error.message }, 500);
  }
});

if (isMainModule) {
  registerRuntimeStateCleanup();
  server.listen(port, "127.0.0.1", () => {
    console.log(`Data Editor running at http://127.0.0.1:${port}`);
    console.log(`Project root: ${projectRoot}`);
  });
}

async function handleDocument(url, res) {
  const relativePath = url.searchParams.get("path");
  if (!relativePath) throw new Error("Missing document path");
  const text = await readTextFile(projectContext, relativePath);
  const ext = path.extname(relativePath).toLowerCase();
  const parsed = ext === ".csv" ? { data: parseCsv(text), format: "csv" } : parseJson(text);
  sendJson(res, buildDocumentModel(parsed.data, parsed.format, relativePath));
}

async function handleSave(req, res) {
  const body = await readJsonBody(req);
  if (!body.path) throw new Error("Missing save path");
  const ext = path.extname(body.path).toLowerCase();
  if (![".json", ".csv"].includes(ext)) throw new Error(`Unsupported save extension: ${ext}`);
  const text = ext === ".csv" ? serializeCsv(body.root) : serializeJson(body.root);
  const result = await writeTextFileWithBackup(projectContext, body.path, text);
  sendJson(res, { ok: true, ...result });
}

async function handleSaveViewConfig(req, res) {
  const body = await readJsonBody(req);
  const result = await saveViewConfig(projectContext, body);
  sendJson(res, { ok: true, ...result });
}

async function handleLoadViewProfile(url, res) {
  const name = url.searchParams.get("name");
  if (!name) throw new Error("Missing view profile name");
  sendJson(res, await loadViewProfile(projectContext, name));
}

async function handleSaveViewProfile(req, res) {
  const body = await readJsonBody(req);
  if (!body.name) throw new Error("Missing view profile name");
  const result = await saveViewProfile(projectContext, body.name, body.profile);
  sendJson(res, { ok: true, ...result });
}

function handleShutdown(res) {
  sendJson(res, { ok: true, stopping: true }, 202);
  scheduleControllerStop();
}

async function handleRebuild(res) {
  await runBuildCommand();
  sendJson(res, { ok: true });
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
  return "application/octet-stream";
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
  await clearServiceStateIfOwned(projectContext, process.pid).catch(() => {});
  await new Promise((resolve) => server.close(() => resolve()));
  process.exit(exitCode);
}
