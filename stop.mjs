import { execFile } from "node:child_process";
import http from "node:http";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createProjectContext } from "./src/project-context.mjs";
import { runtimeHome } from "./src/project-registry.mjs";
import {
  clearControllerState,
  clearRecoveryBridgeState,
  clearServiceState,
  loadRecoveryBridgeState,
  loadServiceState,
  saveServiceState,
} from "./src/runtime-state.mjs";

const execFileAsync = promisify(execFile);
const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  const options = parseArgs(process.argv.slice(2));
  try {
    const result = await stopService(options.runtimeTarget, {
      includeBridge: !options.serviceOnly,
      fallbackTarget: options.toolRoot,
    });
    if (result.message) {
      const stream = result.ok ? process.stdout : process.stderr;
      stream.write(`${result.message}\n`);
    }
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

export async function stopService(targetRuntime, { includeBridge = true, fallbackTarget = null } = {}) {
  const result = await stopServiceOnce(targetRuntime, { includeBridge });
  if (shouldTryFallback(result, fallbackTarget, targetRuntime)) {
    return stopServiceOnce(fallbackTarget, { includeBridge });
  }
  return result;
}

async function stopServiceOnce(targetRuntime, { includeBridge = true } = {}) {
  const bridgeState = await loadRecoveryBridgeState(targetRuntime);
  if (bridgeState) {
    const bridgePid = Number(bridgeState.pid);
    if (!Number.isInteger(bridgePid) || bridgePid <= 0) {
      await clearRecoveryBridgeState(targetRuntime);
      return stopServiceFromStateFile(targetRuntime, { includeBridge });
    }

    const bridgeInfo = await inspectProcess(bridgePid);
    if (!bridgeInfo) {
      await clearRecoveryBridgeState(targetRuntime);
      return stopServiceFromStateFile(targetRuntime, { includeBridge });
    }

    if (!matchesRecoveryBridgeIdentity(bridgeInfo, bridgeState)) {
      return {
        ok: false,
        message: `Refusing to stop recovery bridge pid ${bridgePid} because its identity does not match the recorded state.`,
      };
    }

    try {
      await postControllerJson(Number(bridgeState.port), "/stop-service", {});
    } catch (error) {
      const latestBridgeInfo = await inspectProcess(bridgePid);
      if (latestBridgeInfo && matchesRecoveryBridgeIdentity(latestBridgeInfo, bridgeState)) {
        return {
          ok: false,
          message: `Controller service is running but did not accept stop-service: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
      await clearRecoveryBridgeState(targetRuntime);
      return stopServiceFromStateFile(targetRuntime, { includeBridge });
    }

    if (includeBridge) {
      const bridgeResult = await stopRecoveryBridge(targetRuntime);
      if (!bridgeResult.ok) return bridgeResult;
      return {
        ok: true,
        message: `Stopped data-editor main service through controller. ${bridgeResult.message}`.trim(),
      };
    }
    return { ok: true, message: "Stopped data-editor main service through controller." };
  }

  return stopServiceFromStateFile(targetRuntime, { includeBridge });
}

async function stopServiceFromStateFile(targetRuntime, { includeBridge = true } = {}) {
  const state = await loadServiceState(targetRuntime);
  if (!state) {
    if (includeBridge) {
      const bridgeResult = await stopRecoveryBridge(targetRuntime);
      if (bridgeResult.message) return bridgeResult;
    }
    return { ok: true, message: "No running data-editor service state was found." };
  }

  const pid = Number(state.pid);
  if (!Number.isInteger(pid) || pid <= 0) {
    await clearServiceState(targetRuntime);
    return { ok: true, message: "Cleared stale data-editor service state with an invalid pid." };
  }

  const processInfo = await inspectProcess(pid);
  if (!processInfo) {
    await clearServiceState(targetRuntime);
    return { ok: true, message: `Cleared stale data-editor service state because pid ${pid} is not running.` };
  }

  if (!matchesServiceIdentity(processInfo, state)) {
    return {
      ok: false,
      message: `Refusing to stop pid ${pid} because its identity does not match the recorded data-editor service state.`,
    };
  }

  const clearStateBeforeTerminate = process.platform === "win32";
  if (clearStateBeforeTerminate) {
    await clearServiceState(targetRuntime);
  }

  try {
    await terminateProcess(pid);
  } catch (error) {
    if (isMissingProcessError(error)) {
        await clearServiceState(targetRuntime);
      return { ok: true, message: `Cleared stale data-editor service state because pid ${pid} already exited.` };
    }
    if (clearStateBeforeTerminate) {
      await saveServiceState(targetRuntime, state);
    }
    throw error;
  }

  if (!clearStateBeforeTerminate) {
    await clearServiceState(targetRuntime);
  }

  const stopped = await waitForProcessExit(pid);
  if (!stopped) {
    return { ok: false, message: `Timed out while waiting for data-editor pid ${pid} to exit.` };
  }
  if (includeBridge) {
    const bridgeResult = await stopRecoveryBridge(targetRuntime);
    if (!bridgeResult.ok) return bridgeResult;
    const bridgeMessage = bridgeResult.message ? ` ${bridgeResult.message}` : "";
    return { ok: true, message: `Stopped data-editor service pid ${pid}.${bridgeMessage}`.trim() };
  }
  return { ok: true, message: `Stopped data-editor service pid ${pid}.` };
}

export async function stopRecoveryBridge(targetRuntime) {
  const state = await loadRecoveryBridgeState(targetRuntime);
  if (!state) {
    await clearControllerState(targetRuntime).catch(() => {});
    return { ok: true, message: "No running recovery bridge state was found." };
  }

  const pid = Number(state.pid);
  if (!Number.isInteger(pid) || pid <= 0) {
    await clearRecoveryBridgeState(targetRuntime);
    await clearControllerState(targetRuntime);
    return { ok: true, message: "Cleared stale recovery bridge state with an invalid pid." };
  }

  const processInfo = await inspectProcess(pid);
  if (!processInfo) {
    await clearRecoveryBridgeState(targetRuntime);
    await clearControllerState(targetRuntime);
    return { ok: true, message: `Cleared stale recovery bridge state because pid ${pid} is not running.` };
  }

  if (!matchesRecoveryBridgeIdentity(processInfo, state)) {
    return {
      ok: false,
      message: `Refusing to stop recovery bridge pid ${pid} because its identity does not match the recorded state.`,
    };
  }

  try {
    await terminateProcess(pid);
  } catch (error) {
    if (isMissingProcessError(error)) {
      await clearRecoveryBridgeState(targetRuntime);
      await clearControllerState(targetRuntime);
      return { ok: true, message: `Cleared stale recovery bridge state because pid ${pid} already exited.` };
    }
    throw error;
  }

  const stopped = await waitForProcessExit(pid);
  if (!stopped) {
    return { ok: false, message: `Timed out while waiting for recovery bridge pid ${pid} to exit.` };
  }
  await clearRecoveryBridgeState(targetRuntime);
  await clearControllerState(targetRuntime);
  return { ok: true, message: `Stopped recovery bridge pid ${pid}.` };
}

async function postControllerJson(port, requestPath, body) {
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

export function matchesServiceIdentity(processInfo, state) {
  const identity = buildExpectedIdentity(state);
  if (!identity.scriptName) return false;
  const parsed = parseCommandLine(processInfo.commandLine ?? "");
  if (!parsed.scriptPath) return false;
  if (path.basename(parsed.scriptPath) !== identity.scriptName) return false;
  if (identity.registryHome) {
    if (parsed.registryHomeValue !== identity.registryHome) return false;
  } else {
    if (!identity.projectRoot || parsed.rootValue !== identity.projectRoot) return false;
  }
  if (identity.port !== null && parsed.portValue !== String(identity.port)) return false;
  return true;
}

export function buildExpectedIdentity(state) {
  const mode = normalizeMode(state.mode);
  const scriptName = mode === "dev" ? "dev.mjs" : "server.mjs";
  const projectRoot = state.projectRoot ? normalizeText(path.resolve(String(state.projectRoot))) : "";
  const registryHome = state.registryHome ? normalizeText(path.resolve(String(state.registryHome))) : "";
  const port = Number.isInteger(Number(state.port)) && Number(state.port) > 0 ? Number(state.port) : null;
  return registryHome
    ? { mode, scriptName, projectRoot, registryHome, port }
    : { mode, scriptName, projectRoot, port };
}

export function buildExpectedRecoveryBridgeIdentity(state) {
  const projectRoot = state.projectRoot ? normalizeText(path.resolve(String(state.projectRoot))) : "";
  const registryHome = state.registryHome ? normalizeText(path.resolve(String(state.registryHome))) : "";
  const toolRoot = state.toolRoot ? normalizeText(path.resolve(String(state.toolRoot))) : "";
  const port = Number.isInteger(Number(state.port)) && Number(state.port) > 0 ? Number(state.port) : null;
  const servicePort =
    Number.isInteger(Number(state.servicePort)) && Number(state.servicePort) > 0 ? Number(state.servicePort) : null;
  const serviceMode = normalizeMode(state.serviceMode);
  return {
    scriptName: "recovery-bridge.mjs",
    projectRoot,
    registryHome,
    toolRoot,
    port,
    servicePort,
    serviceMode,
  };
}

export async function inspectProcess(pid) {
  if (process.platform === "win32") return inspectWindowsProcess(pid);
  return inspectPosixProcess(pid);
}

export function matchesRecoveryBridgeIdentity(processInfo, state) {
  const identity = buildExpectedRecoveryBridgeIdentity(state);
  if (!identity.scriptName) return false;
  const parsed = parseCommandLine(processInfo.commandLine ?? "");
  if (!parsed.scriptPath) return false;
  if (path.basename(parsed.scriptPath) !== identity.scriptName) return false;
  if (identity.registryHome) {
    if (parsed.registryHomeValue !== identity.registryHome) return false;
  } else {
    if (!identity.projectRoot || parsed.rootValue !== identity.projectRoot) return false;
  }
  if (!identity.toolRoot || parsed.toolRootValue !== identity.toolRoot) return false;
  if (identity.port !== null && parsed.portValue !== String(identity.port)) return false;
  if (identity.servicePort !== null && parsed.servicePortValue !== String(identity.servicePort)) return false;
  if (parsed.serviceModeValue !== identity.serviceMode) return false;
  return true;
}

export async function inspectWindowsProcess(pid, { execFileImpl = execFileAsync } = {}) {
  const psCommand = [
    `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}"`,
    "if (-not $p) { exit 0 }",
    "$p | Select-Object ProcessId, Name, ExecutablePath, CommandLine | ConvertTo-Json -Compress",
  ].join("; ");

  const { stdout } = await execFileImpl(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", psCommand],
    { windowsHide: true },
  );
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  const data = JSON.parse(trimmed);
  return {
    pid: Number(data.ProcessId),
    name: data.Name ?? "",
    executablePath: data.ExecutablePath ?? "",
    commandLine: data.CommandLine ?? "",
  };
}

async function inspectPosixProcess(pid) {
  try {
    const { stdout } = await execFileAsync("ps", ["-p", String(pid), "-o", "command="]);
    const commandLine = stdout.trim();
    if (!commandLine) return null;
    return { pid, name: "", executablePath: "", commandLine };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === 1) {
      return null;
    }
    throw error;
  }
}

async function terminateProcess(pid) {
  if (process.platform === "win32") {
    return terminateWindowsProcess(pid);
  }
  process.kill(pid, "SIGTERM");
}

export async function terminateWindowsProcess(
  pid,
  { execFileImpl = execFileAsync, inspectProcessImpl = inspectProcess } = {},
) {
  try {
    await execFileImpl("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
  } catch (error) {
    if (!(await inspectProcessImpl(pid))) {
      return;
    }
    throw error;
  }
}

async function waitForProcessExit(pid, timeoutMs = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!(await inspectProcess(pid))) return true;
    await delay(100);
  }
  return !(await inspectProcess(pid));
}

function resolveToolRoot(argv) {
  const toolRootArgIndex = argv.indexOf("--tool-root");
  if (toolRootArgIndex >= 0 && argv[toolRootArgIndex + 1]) {
    return path.resolve(argv[toolRootArgIndex + 1]);
  }
  return path.dirname(fileURLToPath(import.meta.url));
}

function resolveProjectRoot(argv) {
  const projectArgIndex = argv.indexOf("--project");
  if (projectArgIndex >= 0 && argv[projectArgIndex + 1]) return path.resolve(argv[projectArgIndex + 1]);
  const rootArgIndex = argv.indexOf("--root");
  if (rootArgIndex >= 0 && argv[rootArgIndex + 1]) return path.resolve(argv[rootArgIndex + 1]);
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
}

function shouldTryFallback(result, fallbackTarget, targetRuntime) {
  if (!fallbackTarget || fallbackTarget === targetRuntime) return false;
  if (!result?.ok) return false;
  return typeof result.message === "string" && result.message.includes("No running");
}

function normalizeText(value) {
  return String(value).replace(/\\/g, "/").toLowerCase();
}

function isMissingProcessError(error) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ESRCH");
}

function normalizeMode(mode) {
  return mode === "dev" ? "dev" : "static";
}

function parseCommandLine(commandLine) {
  const tokens = tokenizeCommandLine(commandLine);
  const normalizedTokens = tokens.map(normalizeText);
  const scriptPath = normalizedTokens.find((token) => token.endsWith(".mjs")) ?? "";
  return {
    scriptPath,
    rootValue: readOptionValue(normalizedTokens, "--project") || readOptionValue(normalizedTokens, "--root"),
    registryHomeValue: readOptionValue(normalizedTokens, "--registry-home"),
    portValue: readOptionValue(normalizedTokens, "--port"),
    toolRootValue: readOptionValue(normalizedTokens, "--tool-root"),
    servicePortValue: readOptionValue(normalizedTokens, "--service-port"),
    serviceModeValue: readOptionValue(normalizedTokens, "--service-mode"),
  };
}

function tokenizeCommandLine(commandLine) {
  const tokens = [];
  const pattern = /"([^"]*)"|[^\s"]+/g;
  let match = pattern.exec(commandLine);
  while (match) {
    tokens.push(match[1] ?? match[0]);
    match = pattern.exec(commandLine);
  }
  return tokens;
}

function readOptionValue(tokens, optionName) {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === optionName) {
      return tokens[index + 1] ?? "";
    }
    if (token.startsWith(`${optionName}=`)) {
      return token.slice(optionName.length + 1);
    }
  }
  return "";
}

function parseArgs(argv) {
  const projectRoot = resolveProjectRoot(argv);
  const runtimeDir = readRawOptionValue(argv, "--runtime-dir") || undefined;
  const logsDir = readRawOptionValue(argv, "--logs-dir") || undefined;
  const registryHome = readRawOptionValue(argv, "--registry-home") || undefined;
  return {
    toolRoot: resolveToolRoot(argv),
    projectRoot,
    runtimeTarget: registryHome ? runtimeHome({ home: registryHome }) : createProjectContext({ projectRoot, runtimeDir, logsDir }),
    serviceOnly: argv.includes("--service-only"),
  };
}

function readRawOptionValue(tokens, optionName) {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === optionName) return tokens[index + 1] ?? "";
    if (token.startsWith(`${optionName}=`)) return token.slice(optionName.length + 1);
  }
  return "";
}
