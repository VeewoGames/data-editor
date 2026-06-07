import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  clearRecoveryBridgeState,
  loadRecoveryBridgeState,
} from "./src/runtime-state.mjs";
import { inferDefaultProjectRoot } from "./src/default-project-root.mjs";
import { runtimeHome } from "./src/project-registry.mjs";
import { inspectProcess, matchesRecoveryBridgeIdentity } from "./stop.mjs";

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = await openService(options);
    process.stdout.write(`${result.message}\n`);
    process.exitCode = 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

export async function openService(options, deps = {}) {
  const {
    ensureRecoveryBridgeRunningImpl = ensureRecoveryBridgeRunning,
    postControllerJsonImpl = postControllerJson,
  } = deps;
  const requested = normalizeOptions(options);
  await ensureRecoveryBridgeRunningImpl(requested, deps);
  const result = await postControllerJsonImpl(requested.bridgePort, "/start", {});
  return { message: result.message ?? `Data Editor is running at http://127.0.0.1:${requested.port}/` };
}

export async function ensureRecoveryBridgeRunning(requested, deps = {}) {
  const {
    spawnImpl = spawn,
    isPortRespondingImpl = isPortResponding,
    waitForBridgeReadyImpl = waitForBridgeReady,
    loadRecoveryBridgeStateImpl = loadRecoveryBridgeState,
    clearRecoveryBridgeStateImpl = clearRecoveryBridgeState,
  } = deps;

  let stateTarget = requested.runtimeTarget;
  let state = await loadRecoveryBridgeStateImpl(stateTarget);
  if (!state) {
    stateTarget = requested.toolRoot;
    state = await loadRecoveryBridgeStateImpl(stateTarget);
  }
  if (state) {
    const pid = Number(state.pid);
    if (!Number.isInteger(pid) || pid <= 0) {
      await clearRecoveryBridgeStateImpl(stateTarget);
    } else {
      const processInfo = await inspectProcess(pid);
      if (!processInfo) {
        await clearRecoveryBridgeStateImpl(stateTarget);
      } else if (matchesRecoveryBridgeIdentity(processInfo, state)) {
        const sameConfig =
          Number(state.port) === requested.bridgePort &&
          Number(state.servicePort) === requested.port &&
          String(state.serviceMode ?? "static") === requested.mode &&
          String(state.adapterId ?? "nocturnel") === requested.adapterId &&
          path.resolve(String(state.registryHome ?? "")) === requested.registryHome;
        if (sameConfig) {
          await waitForBridgeReadyImpl(requested.bridgePort);
          return { message: `Recovery bridge is running at http://127.0.0.1:${requested.bridgePort}/` };
        }
        throw new Error(`Recovery bridge port ${requested.bridgePort} is already in use by another data-editor instance.`);
      } else {
        throw new Error(`Recovery bridge port ${requested.bridgePort} is already in use by another service.`);
      }
    }
  }

  if (await isPortRespondingImpl(requested.bridgePort, "/health")) {
    throw new Error(`Recovery bridge port ${requested.bridgePort} is already in use by another service.`);
  }

  const child = spawnImpl(
    process.execPath,
    [
      "recovery-bridge.mjs",
      "--tool-root",
      requested.toolRoot,
      "--project",
      requested.projectRoot,
      "--port",
      String(requested.bridgePort),
      "--service-port",
      String(requested.port),
      "--service-mode",
      requested.mode,
      "--adapter",
      requested.adapterId,
      "--registry-home",
      requested.registryHome,
      "--runtime-dir",
      requested.runtimeDir,
      "--logs-dir",
      requested.logsDir,
    ],
    {
      cwd: scriptRoot,
      detached: true,
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    },
  );
  child.unref();
  await waitForBridgeReadyImpl(requested.bridgePort);
  return { message: `Recovery bridge is running at http://127.0.0.1:${requested.bridgePort}/` };
}

export async function postControllerJson(port, requestPath, body, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: requestPath,
        method: "POST",
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-length": Buffer.byteLength(payload),
        },
        timeout: timeoutMs,
      },
      (response) => {
        let responseBody = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          responseBody += chunk;
        });
        response.on("end", () => {
          const parsed = responseBody ? JSON.parse(responseBody) : {};
          if ((response.statusCode ?? 0) >= 400) {
            reject(new Error(parsed.error ?? `HTTP ${response.statusCode}`));
            return;
          }
          resolve(parsed);
        });
      },
    );
    request.on("timeout", () => request.destroy(new Error("timeout")));
    request.on("error", reject);
    request.end(payload);
  });
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

async function waitForBridgeReady(port, timeoutMs = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isPortResponding(port, "/health")) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for recovery bridge to start on port ${port}.`);
}

function normalizeOptions(options) {
  const projectRoot = path.resolve(options.projectRoot);
  const registryHome = options.registryHome ? path.resolve(options.registryHome) : undefined;
  return {
    toolRoot: path.resolve(options.toolRoot),
    projectRoot,
    runtimeDir: options.runtimeDir ?? ".data-editor/runtime",
    logsDir: options.logsDir ?? ".data-editor/logs",
    registryHome: registryHome ?? runtimeHome().projectRoot,
    runtimeTarget: options.runtimeTarget ?? runtimeHome({ home: registryHome }),
    adapterId: options.adapterId ?? "nocturnel",
    port: Number(options.port ?? 8787),
    mode: options.mode === "dev" ? "dev" : "static",
    bridgePort: Number(options.bridgePort ?? 8791),
  };
}

function parseArgs(argv) {
  const explicitMode = readOption(argv, "--mode");
  const toolRoot = readOption(argv, "--tool-root") ?? scriptRoot;
  const registryHome = readOption(argv, "--registry-home") ?? undefined;
  const projectRoot = readOption(argv, "--project")
    ?? readOption(argv, "--root")
    ?? inferDefaultProjectRoot({ toolRoot, cwd: process.cwd(), registryHome });
  const portValue = readOption(argv, "--port");
  const port = Number.isInteger(Number(portValue)) && Number(portValue) > 0 ? Number(portValue) : 8787;
  const selectedMode = explicitMode === "dev" || explicitMode === "static" ? explicitMode : inferMode();
  return {
    toolRoot,
    projectRoot,
    adapterId: readOption(argv, "--adapter") ?? "nocturnel",
    port,
    bridgePort: Number(readOption(argv, "--bridge-port") ?? 8791),
    mode: selectedMode,
    registryHome,
    runtimeDir: readOption(argv, "--runtime-dir") ?? undefined,
    logsDir: readOption(argv, "--logs-dir") ?? undefined,
  };
}

function inferMode() {
  const distIndex = path.resolve(scriptRoot, "dist/index.html");
  if (existsSync(distIndex)) return "static";
  return "dev";
}

function readOption(argv, name) {
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === name) return argv[index + 1] ?? "";
    if (token.startsWith(`${name}=`)) return token.slice(name.length + 1);
  }
  return null;
}
