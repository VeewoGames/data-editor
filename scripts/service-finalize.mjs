import { execFile } from "node:child_process";
import { readdir, readFile, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  buildCleanupStatus,
  buildProtectedPids,
  checkServiceHealth,
  decideRecovery,
  formatFinalizeSummary,
  getListeningPids,
  planProcessCleanup,
  planTempDirectoryCleanup,
} from "../src/service-finalizer.mjs";
import { runtimeHome } from "../src/project-registry.mjs";
import {
  controllerStatePath,
  recoveryBridgeStatePath,
  runtimeStatePath,
} from "../src/runtime-state.mjs";
import { inspectProcess } from "../stop.mjs";

const execFileAsync = promisify(execFile);
const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = await finalizeService(options);
    if (options.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      process.stdout.write(`${formatFinalizeSummary(result)}\n`);
      for (const warning of result.warnings) process.stdout.write(`Warning: ${warning}\n`);
    }
    process.exitCode = result.main.status === "unavailable" && result.bridge.status !== "healthy" ? 1 : 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

export async function finalizeService(options, deps = {}) {
  const {
    readJsonFileImpl = readJsonFile,
    requestJsonImpl = requestJson,
    inspectProcessImpl = inspectProcess,
    execFileImpl = execFileAsync,
    listNodeProcessesImpl = listNodeProcesses,
    listTempStopDirectoriesImpl = listTempStopDirectories,
    removeDirectoryImpl = removeDirectory,
    stopProcessImpl = stopProcess,
    delayImpl = delay,
  } = deps;

  const runtimeTarget = runtimeHome({ home: options.registryHome });
  let [serviceState, controllerState, recoveryBridgeState] = await Promise.all([
    readJsonFileImpl(runtimeStatePath(runtimeTarget)),
    readJsonFileImpl(controllerStatePath(runtimeTarget)),
    readJsonFileImpl(recoveryBridgeStatePath(runtimeTarget)),
  ]);

  const health = await checkServiceHealth({
    mainPort: options.mainPort,
    bridgePort: options.bridgePort,
    requestJson: requestJsonImpl,
  });

  let [mainListening, bridgeListening] = await Promise.all([
    getListeningPids(options.mainPort, { execFileImpl }),
    getListeningPids(options.bridgePort, { execFileImpl }),
  ]);
  let listeningPidsAvailable = mainListening.ok && bridgeListening.ok;
  let protectedPids = buildProtectedPids({
    serviceState,
    controllerState,
    recoveryBridgeState,
    listeningPids: { main: mainListening, bridge: bridgeListening },
  });

  let recovered = false;
  let recovery = { action: "skip", reason: "not-requested" };
  if (options.recover) {
    const bridgeProcessInfo = recoveryBridgeState?.pid ? await inspectProcessImpl(Number(recoveryBridgeState.pid)) : null;
    recovery = await decideRecovery({
      mainHealth: health.main,
      bridgeHealth: health.bridge,
      recover: true,
      bridgePort: options.bridgePort,
      servicePort: options.mainPort,
      serviceMode: options.mode,
      bridgeState: recoveryBridgeState,
      bridgeProcessInfo,
      requestJson: requestJsonImpl,
    });
    if (recovery.action === "recover") {
      await requestJsonImpl(recovery.url, { method: "POST", body: {} });
      [serviceState, controllerState, recoveryBridgeState] = await Promise.all([
        readJsonFileImpl(runtimeStatePath(runtimeTarget)),
        readJsonFileImpl(controllerStatePath(runtimeTarget)),
        readJsonFileImpl(recoveryBridgeStatePath(runtimeTarget)),
      ]);
      [mainListening, bridgeListening] = await Promise.all([
        getListeningPids(options.mainPort, { execFileImpl }),
        getListeningPids(options.bridgePort, { execFileImpl }),
      ]);
      listeningPidsAvailable = mainListening.ok && bridgeListening.ok;
      protectedPids = buildProtectedPids({
        serviceState,
        controllerState,
        recoveryBridgeState,
        listeningPids: { main: mainListening, bridge: bridgeListening },
      });
      recovered = true;
    }
  }

  const finalHealth = recovered
    ? await waitForServiceHealth({
        mainPort: options.mainPort,
        bridgePort: options.bridgePort,
        requestJson: requestJsonImpl,
        delayImpl,
      })
    : health;

  let processPlan = {
    skipped: !options.cleanup,
    reason: options.cleanup ? null : "cleanup-disabled",
    processesToStop: [],
    protectedProcesses: [],
    ignoredProcesses: [],
    warnings: [],
  };
  const stoppedProcesses = [];
  let deletedDirectories = [];
  let skippedDirectories = [];
  if (options.cleanup) {
    const processes = await listNodeProcessesImpl();
    processPlan = planProcessCleanup({
      processes,
      protectedPids,
      listeningPidsAvailable,
      tempRoot: options.tempRoot,
    });
    for (const processInfo of processPlan.processesToStop) {
      await stopProcessImpl(processInfo.pid);
      stoppedProcesses.push(processInfo);
    }

    const directories = await listTempStopDirectoriesImpl(options.tempRoot);
    const directoryPlan = planTempDirectoryCleanup({ directories, processes, tempRoot: options.tempRoot });
    for (const directory of directoryPlan.directoriesToDelete) {
      await removeDirectoryImpl(directory);
      deletedDirectories.push(directory);
    }
    skippedDirectories = directoryPlan.skippedDirectories;
  }

  const cleanupStatus = buildCleanupStatus({ processPlan, deletedDirectories });
  const warnings = [
    ...processPlan.warnings ?? [],
    ...(mainListening.ok ? [] : [`Main port PID lookup failed: ${mainListening.reason}`]),
    ...(bridgeListening.ok ? [] : [`Bridge port PID lookup failed: ${bridgeListening.reason}`]),
  ];
  const mainPid = firstListeningPid(mainListening) ?? serviceState?.pid ?? controllerState?.servicePid ?? null;
  const bridgePid = firstListeningPid(bridgeListening) ?? recoveryBridgeState?.pid ?? controllerState?.controllerPid ?? null;

  return {
    expectedUrl: options.expectedUrl,
    main: {
      status: finalHealth.main.ok ? (recovered ? "recovered" : "healthy") : "unavailable",
      pid: mainPid,
      health: finalHealth.main,
    },
    bridge: {
      status: finalHealth.bridge.ok ? "healthy" : "bridgeUnavailable",
      pid: bridgePid,
      health: finalHealth.bridge,
    },
    cleanup: {
      status: cleanupStatus,
      stoppedProcesses,
      deletedDirectories,
      skippedDirectories,
      processPlan,
    },
    recovery,
    warnings,
  };
}

function firstListeningPid(result) {
  if (!result?.ok) return null;
  return result.pids?.[0] ?? null;
}

async function waitForServiceHealth({ mainPort, bridgePort, requestJson, delayImpl, attempts = 20, intervalMs = 100 }) {
  let lastHealth = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    lastHealth = await checkServiceHealth({ mainPort, bridgePort, requestJson });
    if (lastHealth.main.ok) return lastHealth;
    await delayImpl(intervalMs);
  }
  return lastHealth ?? checkServiceHealth({ mainPort, bridgePort, requestJson });
}

export function parseArgs(argv) {
  const registryHome = readOption(argv, "--registry-home") ?? process.env.DATA_EDITOR_HOME ?? runtimeHome().projectRoot;
  const mainPort = Number(readOption(argv, "--main-port") ?? readOption(argv, "--port") ?? 8787);
  const bridgePort = Number(readOption(argv, "--bridge-port") ?? 8791);
  const status = argv.includes("--status");
  return {
    status,
    cleanup: argv.includes("--cleanup") && !status,
    recover: argv.includes("--recover") && !status,
    json: argv.includes("--json"),
    registryHome: path.resolve(registryHome),
    mainPort,
    bridgePort,
    mode: readOption(argv, "--mode") === "dev" ? "dev" : "static",
    expectedUrl: readOption(argv, "--expected-url") ?? `http://127.0.0.1:${mainPort}/`,
    tempRoot: path.resolve(readOption(argv, "--temp-root") ?? os.tmpdir()),
    toolRoot: path.resolve(readOption(argv, "--tool-root") ?? scriptRoot),
  };
}

async function readJsonFile(targetPath) {
  try {
    return JSON.parse(await readFile(targetPath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

function requestJson(url, options = {}) {
  const parsed = new URL(url);
  const payload = options.body == null ? "" : JSON.stringify(options.body);
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: `${parsed.pathname}${parsed.search}`,
        method: options.method ?? "GET",
        timeout: 5000,
        headers: payload ? {
          "content-type": "application/json; charset=utf-8",
          "content-length": Buffer.byteLength(payload),
        } : undefined,
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          let parsedBody = null;
          try {
            parsedBody = body ? JSON.parse(body) : null;
          } catch (error) {
            reject(error);
            return;
          }
          if ((response.statusCode ?? 500) >= 400) {
            reject(new Error(parsedBody?.error ?? `HTTP ${response.statusCode}`));
            return;
          }
          resolve(parsedBody);
        });
      },
    );
    request.on("timeout", () => request.destroy(new Error("timeout")));
    request.on("error", reject);
    request.end(payload);
  });
}

async function listNodeProcesses() {
  if (process.platform !== "win32") return [];
  const command = [
    "Get-CimInstance Win32_Process",
    "| Where-Object { $_.Name -eq 'node.exe' }",
    "| Select-Object ProcessId,ParentProcessId,Name,CommandLine",
    "| ConvertTo-Json -Compress",
  ].join(" ");
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed);
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows.map((row) => ({
    pid: Number(row.ProcessId),
    parentPid: row.ParentProcessId == null ? null : Number(row.ParentProcessId),
    name: row.Name ?? "",
    commandLine: row.CommandLine ?? "",
  }));
}

async function listTempStopDirectories(tempRoot) {
  const entries = await readdir(tempRoot, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("data-editor-stop-"))
    .map((entry) => path.join(tempRoot, entry.name));
}

async function removeDirectory(targetPath) {
  await rm(targetPath, { recursive: true, force: true });
}

async function stopProcess(pid) {
  if (process.platform === "win32") {
    await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Stop-Process -Id ${Number(pid)} -Force`], {
      windowsHide: true,
    });
    return;
  }
  process.kill(Number(pid), "SIGTERM");
}

function readOption(argv, name) {
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === name) return argv[index + 1];
    if (token.startsWith(`${name}=`)) return token.slice(name.length + 1);
  }
  return null;
}
