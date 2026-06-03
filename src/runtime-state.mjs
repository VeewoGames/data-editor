import os from "node:os";
import path from "node:path";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createProjectContext, resolveInsideRoot } from "./project-context.mjs";

export function runtimeDir(target) {
  if (typeof target === "string") return path.resolve(target, ".runtime");
  const context = createProjectContext(target);
  return resolveInsideRoot(context.projectRoot, context.runtimeDir);
}

export function runtimeStatePath(target) {
  return path.join(runtimeDir(target), "service.json");
}

export function recoveryBridgeStatePath(target) {
  return path.join(runtimeDir(target), "recovery-bridge.json");
}

export function controllerStatePath(target) {
  return path.join(runtimeDir(target), "controller.json");
}

export function runtimeLogsDir(target) {
  if (typeof target === "string") return path.join(runtimeDir(target), "logs");
  const context = createProjectContext(target);
  return resolveInsideRoot(context.projectRoot, context.logsDir);
}

export async function ensureRuntimeDir(target) {
  await mkdir(runtimeDir(target), { recursive: true });
}

export async function loadServiceState(target) {
  return loadRuntimeState(runtimeStatePath(target));
}

export async function loadRecoveryBridgeState(target) {
  return loadRuntimeState(recoveryBridgeStatePath(target));
}

export async function loadControllerState(target) {
  return loadRuntimeState(controllerStatePath(target));
}

async function loadRuntimeState(targetPath) {
  try {
    const parsed = JSON.parse(await readFile(targetPath, "utf8"));
    if (isRuntimeStateStaleAfterSystemRestart(parsed)) {
      await rm(targetPath, { force: true });
      return null;
    }
    return parsed;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    if (error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
}

export function getSystemBootTimeMs(nowMs = Date.now(), uptimeSeconds = os.uptime()) {
  if (!Number.isFinite(nowMs) || !Number.isFinite(uptimeSeconds) || uptimeSeconds < 0) {
    return null;
  }
  return nowMs - uptimeSeconds * 1000;
}

export function isRuntimeStateStaleAfterSystemRestart(state, nowMs = Date.now(), uptimeSeconds = os.uptime()) {
  if (!state || typeof state !== "object") return false;
  const bootTimeMs = getSystemBootTimeMs(nowMs, uptimeSeconds);
  if (bootTimeMs == null) return false;
  const stateTimeMs = readRuntimeStateTimestampMs(state);
  if (stateTimeMs == null) return false;
  return stateTimeMs < bootTimeMs;
}

function readRuntimeStateTimestampMs(state) {
  const candidates = [state.updatedAt, state.startedAt];
  for (const candidate of candidates) {
    if (typeof candidate !== "string" || !candidate) continue;
    const value = Date.parse(candidate);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

export async function saveServiceState(target, state) {
  await saveRuntimeState(target, runtimeStatePath(target), state);
}

export async function saveRecoveryBridgeState(target, state) {
  await saveRuntimeState(target, recoveryBridgeStatePath(target), state);
}

export async function saveControllerState(target, state) {
  await saveRuntimeState(target, controllerStatePath(target), {
    controllerPid: Number(state.controllerPid ?? 0),
    servicePid: state.servicePid == null ? null : Number(state.servicePid),
    servicePort: Number(state.servicePort ?? 8787),
    mode: state.mode === "dev" ? "dev" : "static",
    generation: Number(state.generation ?? 0),
    operation: typeof state.operation === "string" ? state.operation : "idle",
    lastExit: state.lastExit ?? null,
    updatedAt: typeof state.updatedAt === "string" ? state.updatedAt : new Date().toISOString(),
  });
}

async function saveRuntimeState(target, targetPath, state) {
  await ensureRuntimeDir(target);
  const tempPath = `${targetPath}.tmp`;
  await writeFile(tempPath, JSON.stringify(state, null, 2) + "\n", "utf8");
  await rename(tempPath, targetPath);
}

export async function clearServiceState(target) {
  await rm(runtimeStatePath(target), { force: true });
}

export async function clearRecoveryBridgeState(target) {
  await rm(recoveryBridgeStatePath(target), { force: true });
}

export async function clearControllerState(target) {
  await rm(controllerStatePath(target), { force: true });
}

export async function clearServiceStateIfOwned(target, pid) {
  const state = await loadServiceState(target);
  if (!state) return false;
  if (Number(state.pid) !== Number(pid)) return false;
  await clearServiceState(target);
  return true;
}

export async function clearRecoveryBridgeStateIfOwned(target, pid) {
  const state = await loadRecoveryBridgeState(target);
  if (!state) return false;
  if (Number(state.pid) !== Number(pid)) return false;
  await clearRecoveryBridgeState(target);
  return true;
}

export async function clearControllerStateIfOwned(target, pid) {
  const state = await loadControllerState(target);
  if (!state) return false;
  if (Number(state.controllerPid) !== Number(pid)) return false;
  await clearControllerState(target);
  return true;
}
