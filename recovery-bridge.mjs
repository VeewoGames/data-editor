import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inferDefaultProjectRoot } from "./src/default-project-root.mjs";
import {
  clearServiceState,
  clearControllerStateIfOwned,
  clearRecoveryBridgeStateIfOwned,
  loadControllerState,
  saveControllerState,
  saveRecoveryBridgeState,
} from "./src/runtime-state.mjs";
import { getMainServiceStatus, startMainService, stopMainService } from "./service-lifecycle.mjs";
import { runtimeHome } from "./src/project-registry.mjs";

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const options = parseArgs(process.argv.slice(2));
let shuttingDown = false;
let operationPromise = null;
let currentServiceChild = null;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === "OPTIONS") {
      return sendNoContent(res);
    }
    if (url.pathname === "/health" && req.method === "GET") {
      return sendJson(res, { ok: true });
    }
    if (url.pathname === "/status" && req.method === "GET") {
      return handleStatus(res);
    }
    if (url.pathname === "/start" && req.method === "POST") {
      return handleStart(res);
    }
    if (url.pathname === "/reopen" && req.method === "POST") {
      return handleReopen(res);
    }
    if (url.pathname === "/stop-service" && req.method === "POST") {
      return handleStopService(res);
    }
    sendJson(res, { error: "Not found" }, 404);
  } catch (error) {
    sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

if (isMainModule) {
  registerCleanup();
  server.listen(options.port, "127.0.0.1", async () => {
    await saveRecoveryBridgeState(options.runtimeTarget, {
      pid: process.pid,
      toolRoot: options.toolRoot,
      registryHome: options.registryHome,
      projectRoot: options.projectRoot,
      port: options.port,
      servicePort: options.servicePort,
      serviceMode: options.serviceMode,
      adapterId: options.adapterId,
      command: [
        process.execPath,
        fileURLToPath(import.meta.url),
        "--tool-root",
        options.toolRoot,
        "--project",
        options.projectRoot,
        "--registry-home",
        options.registryHome,
        "--port",
        String(options.port),
        "--service-port",
        String(options.servicePort),
        "--service-mode",
        options.serviceMode,
        "--adapter",
        options.adapterId,
      ],
      startedAt: new Date().toISOString(),
    });
    const current = await loadControllerState(options.runtimeTarget);
    await saveControllerState(options.runtimeTarget, {
      ...current,
      controllerPid: process.pid,
      servicePid: current?.servicePid ?? null,
      servicePort: options.servicePort,
      mode: options.serviceMode,
      generation: Number(current?.generation ?? 0),
      operation: "idle",
      lastExit: current?.lastExit ?? null,
    });
    console.log(`Recovery bridge running at http://127.0.0.1:${options.port}`);
  });
}

async function handleStatus(res) {
  const status = await getMainServiceStatus(options.runtimeTarget);
  const controllerState = await loadControllerState(options.runtimeTarget);
  sendJson(res, {
    ok: true,
    controllerPid: process.pid,
    serviceRunning: status.running,
    servicePid: status.pid,
    servicePort: options.servicePort,
    serviceMode: options.serviceMode,
    generation: Number(controllerState?.generation ?? status.generation ?? 0),
  });
}

async function handleStart(res) {
  try {
    const result = await runExclusive(() => startServiceThroughController());
    sendJson(res, { ok: true, message: result.message, pid: result.pid });
  } catch (error) {
    sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 500);
  }
}

async function handleReopen(res) {
  try {
    const result = await runExclusive(() => startServiceThroughController());
    sendJson(res, { ok: true, message: result.message, pid: result.pid });
  } catch (error) {
    sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 500);
  }
}

async function handleStopService(res) {
  try {
    const result = await runExclusive(() => stopServiceThroughController());
    sendJson(res, { ok: true, ...result });
  } catch (error) {
    sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 500);
  }
}

async function startServiceThroughController() {
  await updateControllerOperation("starting");
  const result = await startMainService(
    {
      toolRoot: options.toolRoot,
      projectRoot: options.projectRoot,
      registryHome: options.registryHome,
      runtimeTarget: options.runtimeTarget,
      runtimeDir: options.runtimeDir,
      logsDir: options.logsDir,
      port: options.servicePort,
      mode: options.serviceMode,
      adapterId: options.adapterId,
      bridgePort: options.port,
    },
    {
      attach: true,
      onExit: (code, signal) => {
        currentServiceChild = null;
        void recordMainServiceExit({ code, signal });
      },
    },
  );
  currentServiceChild = result.child ?? currentServiceChild;
  const current = await loadControllerState(options.runtimeTarget);
  await saveControllerState(options.runtimeTarget, {
    ...current,
    controllerPid: process.pid,
    servicePid: result.pid ?? current?.servicePid ?? null,
    servicePort: options.servicePort,
    mode: options.serviceMode,
    generation: Number(current?.generation ?? 0),
    operation: "idle",
    lastExit: current?.lastExit ?? null,
  });
  return result;
}

async function stopServiceThroughController() {
  await updateControllerOperation("stopping");
  const result = await stopMainService(options.runtimeTarget);
  currentServiceChild = null;
  const current = await loadControllerState(options.runtimeTarget);
  await saveControllerState(options.runtimeTarget, {
    ...current,
    controllerPid: process.pid,
    servicePid: null,
    servicePort: options.servicePort,
    mode: options.serviceMode,
    generation: Number(current?.generation ?? 0),
    operation: "idle",
    lastExit: current?.lastExit ?? null,
  });
  return result;
}

async function runExclusive(operation) {
  while (operationPromise) {
    await operationPromise.catch(() => {});
  }
  operationPromise = Promise.resolve().then(operation);
  try {
    return await operationPromise;
  } finally {
    operationPromise = null;
  }
}

async function updateControllerOperation(operation) {
  const current = await loadControllerState(options.runtimeTarget);
  await saveControllerState(options.runtimeTarget, {
    ...current,
    controllerPid: process.pid,
    servicePid: current?.servicePid ?? null,
    servicePort: options.servicePort,
    mode: options.serviceMode,
    generation: Number(current?.generation ?? 0),
    operation,
    lastExit: current?.lastExit ?? null,
  });
}

async function recordMainServiceExit({ code, signal }) {
  await clearServiceState(options.runtimeTarget).catch(() => {});
  const current = await loadControllerState(options.runtimeTarget);
  await saveControllerState(options.runtimeTarget, {
    ...current,
    controllerPid: process.pid,
    servicePid: null,
    servicePort: options.servicePort,
    mode: options.serviceMode,
    generation: Number(current?.generation ?? 0) + 1,
    operation: "idle",
    lastExit: { code, signal, at: new Date().toISOString() },
  });
}

function sendJson(res, data, status = 200) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    ...buildCorsHeaders(),
  });
  res.end(JSON.stringify(data));
}

function sendNoContent(res) {
  res.writeHead(204, buildCorsHeaders());
  res.end();
}

function buildCorsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "600",
  };
}

function parseArgs(argv) {
  const parsed = {
    toolRoot: scriptRoot,
    projectRoot: null,
    registryHome: runtimeHome().projectRoot,
    port: 8791,
    servicePort: 8787,
    serviceMode: "static",
    adapterId: "nocturnel",
    runtimeDir: ".data-editor/runtime",
    logsDir: ".data-editor/logs",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--tool-root") parsed.toolRoot = path.resolve(argv[++index]);
    else if (token === "--project") parsed.projectRoot = path.resolve(argv[++index]);
    else if (token === "--root") parsed.projectRoot = path.resolve(argv[++index]);
    else if (token === "--registry-home") parsed.registryHome = path.resolve(argv[++index]);
    else if (token === "--port") parsed.port = Number(argv[++index]);
    else if (token === "--service-port") parsed.servicePort = Number(argv[++index]);
    else if (token === "--service-mode") parsed.serviceMode = argv[++index] === "dev" ? "dev" : "static";
    else if (token === "--adapter") parsed.adapterId = argv[++index] || "nocturnel";
    else if (token === "--runtime-dir") parsed.runtimeDir = argv[++index];
    else if (token === "--logs-dir") parsed.logsDir = argv[++index];
  }
  parsed.projectRoot ??= inferDefaultProjectRoot({
    toolRoot: parsed.toolRoot,
    cwd: process.cwd(),
    registryHome: parsed.registryHome,
  });
  parsed.runtimeTarget = runtimeHome({ home: parsed.registryHome });
  return parsed;
}

function registerCleanup() {
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      void shutdown(0);
    });
  }
  process.on("uncaughtException", (error) => {
    console.error(error);
    void shutdown(1);
  });
  process.on("unhandledRejection", (reason) => {
    console.error(reason);
    void shutdown(1);
  });
}

async function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;
  process.exitCode = exitCode;
  await clearRecoveryBridgeStateIfOwned(options.runtimeTarget, process.pid).catch(() => {});
  await clearControllerStateIfOwned(options.runtimeTarget, process.pid).catch(() => {});
  await new Promise((resolve) => server.close(() => resolve()));
  process.exit(exitCode);
}
