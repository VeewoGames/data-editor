import { spawn } from "node:child_process";
import { mkdir, open } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  clearServiceState,
  ensureRuntimeDir,
  loadServiceState,
  runtimeLogsDir,
  saveServiceState,
} from "./src/runtime-state.mjs";
import { createProjectContext } from "./src/project-context.mjs";
import { inspectProcess, matchesServiceIdentity, terminateWindowsProcess } from "./stop.mjs";

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));

export async function startMainService(options, deps = {}) {
  const {
    attach = false,
    onExit = null,
    spawnImpl = spawn,
    saveServiceStateImpl = saveServiceState,
    isPortRespondingImpl = isPortResponding,
    inspectProcessImpl = inspectProcess,
    waitForServiceReadyImpl = waitForServiceReady,
  } = deps;
  const requested = normalizeMainServiceOptions(options);
  const existing = await getMainServiceStatus(requested.runtimeTarget, { inspectProcessImpl });
  if (existing.running) {
    if (existing.port === requested.port && existing.mode === requested.mode) {
      return { message: `Data Editor is already running at http://127.0.0.1:${requested.port}/`, pid: existing.pid, child: null };
    }
    throw new Error("A different data-editor service is already running. Stop it before opening another instance.");
  }
  if (await isPortRespondingImpl(requested.port)) {
    throw new Error(`Port ${requested.port} is already in use by another service.`);
  }
  if (requested.mode === "dev") {
    const apiPort = requested.port + 1;
    if (await isPortRespondingImpl(apiPort)) {
      throw new Error(`Port ${apiPort} is already in use by another service.`);
    }
  }
  return spawnMainService(requested, {
    attach,
    onExit,
    spawnImpl,
    saveServiceStateImpl,
    waitForServiceReadyImpl,
  });
}

export async function getMainServiceStatus(runtimeTarget, deps = {}) {
  const {
    loadServiceStateImpl = loadServiceState,
    clearServiceStateImpl = clearServiceState,
    inspectProcessImpl = inspectProcess,
  } = deps;
  const state = await loadServiceStateImpl(runtimeTarget);
  if (!state) return { running: false, pid: null, port: null, mode: null, generation: 0 };

  const pid = Number(state.pid);
  const generation = Number(state.generation ?? 0);
  if (!Number.isInteger(pid) || pid <= 0) {
    await clearServiceStateImpl(runtimeTarget);
    return { running: false, pid: null, port: null, mode: null, generation };
  }

  const processInfo = await inspectProcessImpl(pid);
  if (!processInfo || !matchesServiceIdentity(processInfo, state)) {
    await clearServiceStateImpl(runtimeTarget);
    return { running: false, pid: null, port: null, mode: null, generation };
  }

  return {
    running: true,
    pid,
    port: Number(state.port),
    mode: state.mode === "dev" ? "dev" : "static",
    generation,
  };
}

export async function stopMainService(runtimeTarget, options = {}) {
  const {
    timeoutMs = 5000,
    loadServiceStateImpl = loadServiceState,
    clearServiceStateImpl = clearServiceState,
    inspectProcessImpl = inspectProcess,
    terminateWindowsProcessImpl = terminateWindowsProcess,
  } = options;
  const state = await loadServiceStateImpl(runtimeTarget);
  if (!state) {
    return { ok: true, message: "No running data-editor service state was found." };
  }

  const pid = Number(state.pid);
  if (!Number.isInteger(pid) || pid <= 0) {
    await clearServiceStateImpl(runtimeTarget);
    return { ok: true, message: "Cleared stale data-editor service state with an invalid pid." };
  }

  const processInfo = await inspectProcessImpl(pid);
  if (!processInfo) {
    await clearServiceStateImpl(runtimeTarget);
    return { ok: true, message: `Cleared stale data-editor service state because pid ${pid} is not running.` };
  }
  if (!matchesServiceIdentity(processInfo, state)) {
    return {
      ok: false,
      message: `Refusing to stop pid ${pid} because its identity does not match the recorded data-editor service state.`,
    };
  }

  try {
    if (process.platform === "win32") {
      await terminateWindowsProcessImpl(pid);
    } else {
      process.kill(pid, "SIGTERM");
    }
  } catch (error) {
    if (!isMissingProcessError(error)) throw error;
  }

  const stopped = await waitForMainServiceDown(Number(state.port), pid, timeoutMs, { inspectProcessImpl });
  if (!stopped) {
    return { ok: false, message: `Timed out while waiting for data-editor pid ${pid} to exit.` };
  }

  await clearServiceStateImpl(runtimeTarget);
  return { ok: true, message: `Stopped data-editor service pid ${pid}.` };
}

export async function waitForMainServiceDown(port, pid, timeoutMs = 5000, deps = {}) {
  const {
    inspectProcessImpl = inspectProcess,
    isPortRespondingImpl = isPortResponding,
  } = deps;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const [processInfo, portResponding] = await Promise.all([
      inspectProcessImpl(pid),
      isPortRespondingImpl(port),
    ]);
    if (!processInfo && !portResponding) return true;
    await delay(100);
  }
  const [processInfo, portResponding] = await Promise.all([
    inspectProcessImpl(pid),
    isPortRespondingImpl(port),
  ]);
  return !processInfo && !portResponding;
}

async function spawnMainService(requested, deps) {
  const {
    attach,
    onExit,
    spawnImpl,
    saveServiceStateImpl,
    waitForServiceReadyImpl,
  } = deps;
  const spawnArgs =
    requested.mode === "dev"
      ? [
          "dev.mjs",
          "--project",
          requested.projectRoot,
          "--port",
          String(requested.port),
          "--tool-root",
          requested.toolRoot,
          "--bridge-port",
          String(requested.bridgePort),
          "--adapter",
          requested.adapterId,
          "--runtime-dir",
          requested.runtimeDir,
          "--logs-dir",
          requested.logsDir,
        ]
      : [
          "server.mjs",
          "--project",
          requested.projectRoot,
          "--port",
          String(requested.port),
          "--static",
          "dist",
          "--tool-root",
          requested.toolRoot,
          "--bridge-port",
          String(requested.bridgePort),
          "--adapter",
          requested.adapterId,
          "--runtime-dir",
          requested.runtimeDir,
          "--logs-dir",
          requested.logsDir,
        ];

  await ensureRuntimeDir(requested.runtimeTarget);
  await mkdir(runtimeLogsDir(requested.runtimeTarget), { recursive: true });
  const logPath = path.join(runtimeLogsDir(requested.runtimeTarget), `service-${Date.now()}.log`);
  const log = await open(logPath, "a");
  const child = spawnImpl(process.execPath, spawnArgs, {
    cwd: scriptRoot,
    detached: !attach,
    env: requested.mode === "dev" ? { ...process.env, DATA_EDITOR_BACKGROUND: "1" } : process.env,
    shell: false,
    stdio: ["ignore", log.fd, log.fd],
    windowsHide: true,
  });
  await log.close();
  if (attach && onExit) {
    child.once("exit", (code, signal) => {
      onExit(code, signal);
    });
  }

  try {
    const expectedState = {
      pid: child.pid,
      port: requested.port,
      apiPort: requested.mode === "dev" ? requested.port + 1 : null,
      mode: requested.mode,
      projectRoot: requested.projectRoot,
      adapterId: requested.adapterId,
    };
    await waitForServiceReadyImpl(child, expectedState);
    await saveServiceStateImpl(requested.runtimeTarget, {
      pid: child.pid,
      port: requested.port,
      mode: requested.mode,
      projectRoot: requested.projectRoot,
      adapterId: requested.adapterId,
      command: [process.execPath, ...spawnArgs],
      startedAt: new Date().toISOString(),
    });
  } catch (error) {
    await cleanupSpawnedService(child.pid);
    throw error;
  }

  if (!attach) {
    child.unref();
  }
  return { message: `Data Editor is running at http://127.0.0.1:${requested.port}/`, pid: child.pid, child };
}

async function waitForServiceReady(child, expectedState, timeoutMs = 20000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`Data-editor service exited early with code ${child.exitCode}.`);
    }
    if (child.signalCode !== null) {
      throw new Error(`Data-editor service exited early with signal ${child.signalCode}.`);
    }
    const uiReady = await isPortResponding(expectedState.port);
    const apiReady = expectedState.apiPort == null ? true : await isPortResponding(expectedState.apiPort);
    if (uiReady && apiReady && (await childMatchesExpectedIdentity(expectedState))) {
      return;
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for data-editor to start on port ${expectedState.port}.`);
}

async function isPortResponding(port, requestPath = "/") {
  return new Promise((resolve) => {
    const request = http.get(
      {
        hostname: "127.0.0.1",
        port,
        path: requestPath,
        timeout: 1000,
      },
      (response) => {
        response.resume();
        resolve((response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 500);
      },
    );
    request.on("timeout", () => request.destroy());
    request.on("error", () => resolve(false));
  });
}

async function childMatchesExpectedIdentity(expectedState) {
  const processInfo = await inspectProcess(expectedState.pid);
  if (!processInfo) return false;
  return matchesServiceIdentity(processInfo, expectedState);
}

async function cleanupSpawnedService(pid) {
  if (!Number.isInteger(Number(pid)) || Number(pid) <= 0) return;
  try {
    if (process.platform === "win32") {
      await terminateWindowsProcess(Number(pid));
    } else {
      process.kill(Number(pid), "SIGTERM");
    }
  } catch (error) {
    if (!isMissingProcessError(error)) throw error;
  }
}

function normalizeMainServiceOptions(options) {
  const projectRoot = path.resolve(options.projectRoot);
  return {
    toolRoot: path.resolve(options.toolRoot),
    projectRoot,
    runtimeDir: options.runtimeDir ?? ".data-editor/runtime",
    logsDir: options.logsDir ?? ".data-editor/logs",
    runtimeTarget: options.runtimeTarget ?? createProjectContext({
      projectRoot,
      adapterId: options.adapterId,
      runtimeDir: options.runtimeDir,
      logsDir: options.logsDir,
    }),
    adapterId: options.adapterId ?? "nocturnel",
    port: Number(options.port ?? 8787),
    mode: options.mode === "dev" ? "dev" : "static",
    bridgePort: Number(options.bridgePort ?? 8791),
  };
}

function isMissingProcessError(error) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ESRCH");
}
