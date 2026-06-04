import path from "node:path";
import { matchesRecoveryBridgeIdentity } from "../stop.mjs";

const cleanableScripts = new Set(["recovery-bridge.mjs", "server.mjs", "dev.mjs", "vite.js"]);

export function buildProtectedPids({
  serviceState = null,
  controllerState = null,
  recoveryBridgeState = null,
  listeningPids = {},
} = {}) {
  const protectedPids = new Set();
  addPid(protectedPids, serviceState?.pid);
  addPid(protectedPids, controllerState?.controllerPid);
  addPid(protectedPids, controllerState?.servicePid);
  addPid(protectedPids, recoveryBridgeState?.pid);
  for (const group of [listeningPids.main, listeningPids.bridge]) {
    if (!group?.ok) continue;
    for (const pid of group.pids ?? []) addPid(protectedPids, pid);
  }
  return protectedPids;
}

export function parseListeningPidsFromPowerShell(stdout) {
  const trimmed = String(stdout ?? "").trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed);
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return [...new Set(rows.map((row) => Number(row.OwningProcess)).filter((pid) => Number.isInteger(pid) && pid > 0))];
}

export async function getListeningPids(port, { platform = process.platform, execFileImpl } = {}) {
  if (platform !== "win32") {
    return { ok: false, pids: [], reason: "unsupported-platform" };
  }
  if (!execFileImpl) {
    return { ok: false, pids: [], reason: "missing-execFile" };
  }
  const command = [
    `$items = Get-NetTCPConnection -LocalPort ${Number(port)} -State Listen -ErrorAction SilentlyContinue`,
    "$items | Select-Object OwningProcess | ConvertTo-Json -Compress",
  ].join("; ");
  try {
    const { stdout } = await execFileImpl("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
      windowsHide: true,
    });
    return { ok: true, pids: parseListeningPidsFromPowerShell(stdout) };
  } catch (error) {
    return { ok: false, pids: [], reason: error instanceof Error ? error.message : String(error) };
  }
}

export function planProcessCleanup({
  processes = [],
  protectedPids = new Set(),
  listeningPidsAvailable = true,
  tempRoot = defaultTempRoot(),
  allowTreeKill = false,
} = {}) {
  if (!listeningPidsAvailable) {
    return {
      skipped: true,
      reason: "listening-pids-unavailable",
      processesToStop: [],
      protectedProcesses: [],
      ignoredProcesses: processes.map((process) => ({ ...process, reason: "cleanup-skipped" })),
      treeKillAllowed: false,
      warnings: ["Listening PID lookup failed; process cleanup skipped."],
    };
  }

  const protectedProcesses = [];
  const ignoredProcesses = [];
  const processesToStop = [];

  for (const process of processes) {
    const pid = Number(process.pid ?? process.ProcessId);
    const normalized = normalizeProcess(process);
    if (protectedPids.has(pid)) {
      protectedProcesses.push({ ...normalized, reason: "protected" });
      continue;
    }
    if (isCleanableTempProcess(normalized, tempRoot)) {
      processesToStop.push({ ...normalized, reason: "data-editor-temp-process" });
    } else {
      ignoredProcesses.push({ ...normalized, reason: "not-cleanable" });
    }
  }

  const treeKillAllowed = allowTreeKill && canTreeKill(processesToStop, processes, protectedPids, tempRoot);
  const warnings = [];
  if (allowTreeKill && !treeKillAllowed) {
    warnings.push("Tree kill skipped because at least one descendant is not cleanable.");
  }

  return {
    skipped: false,
    reason: null,
    processesToStop,
    protectedProcesses,
    ignoredProcesses,
    treeKillAllowed,
    warnings,
  };
}

export function planTempDirectoryCleanup({ directories = [], processes = [], tempRoot = defaultTempRoot() } = {}) {
  const normalizedTempRoot = normalizePathForCompare(path.resolve(tempRoot));
  const directoriesToDelete = [];
  const skippedDirectories = [];
  const processCommandLines = processes.map((process) => normalizePathForCompare(process.commandLine ?? ""));

  for (const directory of directories) {
    const fullPath = path.resolve(String(directory));
    const comparable = normalizePathForCompare(fullPath);
    if (path.basename(fullPath).startsWith("data-editor-stop-") !== true) {
      skippedDirectories.push({ path: fullPath, reason: "name-mismatch" });
      continue;
    }
    if (!isInsidePath(comparable, normalizedTempRoot)) {
      skippedDirectories.push({ path: fullPath, reason: "outside-temp-root" });
      continue;
    }
    if (processCommandLines.some((line) => line.includes(comparable))) {
      skippedDirectories.push({ path: fullPath, reason: "in-use" });
      continue;
    }
    directoriesToDelete.push(fullPath);
  }

  return { directoriesToDelete, skippedDirectories };
}

export async function checkServiceHealth({ mainPort = 8787, bridgePort = 8791, requestJson }) {
  const [main, bridge] = await Promise.all([
    readHealth(`http://127.0.0.1:${mainPort}/api/health`, requestJson, (body) => {
      return body?.ok === true && Number(body.bridgePort) === Number(bridgePort);
    }),
    readHealth(`http://127.0.0.1:${bridgePort}/health`, requestJson, (body) => body?.ok === true),
  ]);
  return { main, bridge };
}

export async function decideRecovery({
  mainHealth,
  bridgeHealth,
  recover = false,
  bridgePort = 8791,
  servicePort = 8787,
  serviceMode = "static",
  bridgeState,
  bridgeProcessInfo,
  requestJson,
}) {
  if (mainHealth?.ok) return { action: "skip", reason: "main-healthy" };
  if (!recover) return { action: "skip", reason: "recover-disabled" };
  if (!bridgeHealth?.ok) return { action: "skip", reason: "bridge-unhealthy" };

  let status;
  try {
    status = await requestJson(`http://127.0.0.1:${bridgePort}/status`);
  } catch {
    return { action: "skip", reason: "bridge-status-unavailable" };
  }
  if (status?.ok !== true || Number(status.servicePort) !== Number(servicePort) || (status.serviceMode ?? "static") !== serviceMode) {
    return { action: "skip", reason: "bridge-status-mismatch" };
  }
  if (!bridgeState || !bridgeProcessInfo || !matchesRecoveryBridgeIdentity(bridgeProcessInfo, bridgeState)) {
    return { action: "skip", reason: "bridge-identity-mismatch" };
  }
  return { action: "recover", url: `http://127.0.0.1:${bridgePort}/start` };
}

export function formatFinalizeSummary({ expectedUrl, main, bridge, cleanup }) {
  return [
    `Main service: ${main.status}${main.pid ? ` pid ${main.pid}` : ""} ${expectedUrl ?? ""}`.trim(),
    `Recovery bridge: ${bridge.status}${bridge.pid ? ` pid ${bridge.pid}` : ""}`,
    `Cleanup: ${cleanup.status} (${cleanup.stoppedProcesses?.length ?? 0} processes, ${cleanup.deletedDirectories?.length ?? 0} directories)`,
  ].join("\n");
}

export function buildCleanupStatus({ processPlan, deletedDirectories = [] }) {
  if (processPlan?.skipped) return "cleanupSkipped";
  if ((processPlan?.processesToStop?.length ?? 0) > 0 || deletedDirectories.length > 0) return "cleanupPerformed";
  return "cleanupSkipped";
}

function addPid(target, value) {
  const pid = Number(value);
  if (Number.isInteger(pid) && pid > 0) target.add(pid);
}

function normalizeProcess(process) {
  return {
    pid: Number(process.pid ?? process.ProcessId),
    parentPid: process.parentPid == null ? null : Number(process.parentPid),
    name: process.name ?? process.Name ?? "",
    commandLine: process.commandLine ?? process.CommandLine ?? "",
  };
}

function isCleanableTempProcess(process, tempRoot) {
  if (!String(process.name).toLowerCase().includes("node")) return false;
  const commandLine = normalizePathForCompare(process.commandLine);
  const normalizedTempRoot = normalizePathForCompare(path.resolve(tempRoot));
  if (!commandLine.includes(`${normalizedTempRoot}/data-editor-stop-`)) return false;
  const script = extractScriptName(commandLine);
  return cleanableScripts.has(script);
}

function extractScriptName(commandLine) {
  if (commandLine.includes("node_modules/vite/bin/vite.js")) return "vite.js";
  const match = commandLine.match(/([^/\\\s"]+\.mjs)/i);
  return match ? match[1].toLowerCase() : "";
}

function canTreeKill(processesToStop, allProcesses, protectedPids, tempRoot) {
  const cleanable = new Set(processesToStop.map((process) => Number(process.pid)));
  const childrenByParent = new Map();
  for (const process of allProcesses.map(normalizeProcess)) {
    if (!Number.isInteger(process.parentPid)) continue;
    const children = childrenByParent.get(process.parentPid) ?? [];
    children.push(process);
    childrenByParent.set(process.parentPid, children);
  }
  for (const root of processesToStop) {
    const stack = [...(childrenByParent.get(Number(root.pid)) ?? [])];
    while (stack.length) {
      const child = stack.pop();
      if (protectedPids.has(child.pid)) return false;
      if (!cleanable.has(child.pid) && !isCleanableTempProcess(child, tempRoot)) return false;
      stack.push(...(childrenByParent.get(child.pid) ?? []));
    }
  }
  return true;
}

async function readHealth(url, requestJson, validate) {
  try {
    const body = await requestJson(url);
    return validate(body) ? { ok: true, body } : { ok: false, body, reason: "unexpected-response" };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

function normalizePathForCompare(value) {
  return String(value).replace(/\\/g, "/").toLowerCase();
}

function isInsidePath(candidate, root) {
  return candidate === root || candidate.startsWith(`${root}/`);
}

function defaultTempRoot() {
  return process.env.TEMP || process.env.TMP || ".";
}
