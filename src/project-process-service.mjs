import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { atomicWrite } from "./atomic-file.mjs";
import { loadProjectRegistry, runtimeHome } from "./project-registry.mjs";
import { resolveProjectCapabilityState } from "./project-capability-registry.mjs";
import { spawnPersistentProcess } from "./persistent-process.mjs";
import { withProjectProcessLock } from "./project-process-lock.mjs";
import { observeProjectProcess, sameProcessPath, validateProjectProcessEntry } from "./project-process-instance.mjs";

const exec = promisify(execFile);
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const pathKey = value => process.platform === "win32" ? value.toLowerCase() : value;
const actionKeys = new Set(["projectId", "processId", "action", "expectedGeneration", "declarationDigest", "expectedIntentVersion"]);
const operations = new Map();

export function processError(code, message, status = 409) { return Object.assign(new Error(message), { code, status }); }

export function projectProcessDeclarationDigest(root, binding) {
  return hash({ root: pathKey(root), id: binding.id, engine: binding.engine, entry: binding.entry, instanceResource: binding.instanceResource,
    start: ["--watch", "--project-root", "--nonce"], status: ["--status", "--project-root", "--json"], stop: ["--stop", "--project-root"] });
}

export function createProjectProcessService(options = {}, dependencies = {}) {
  const home = runtimeHome(options).projectRoot;
  const loadRegistry = dependencies.loadRegistry ?? (() => loadProjectRegistry(options));
  const resolveCapabilities = dependencies.resolveCapabilities ?? (project => resolveProjectCapabilityState(project, options));
  const run = dependencies.execFile ?? exec;
  const spawn = dependencies.spawnPersistentProcess ?? spawnPersistentProcess;
  const lock = dependencies.withLock ?? withProjectProcessLock;
  const operationTimeoutMs = dependencies.operationTimeoutMs ?? 12000;
  const stopTimeoutMs = dependencies.stopTimeoutMs ?? 20000;
  const runStatus = async (target, remainingTimeoutMs = 5000) => {
    const { stdout } = await run(process.execPath, [target.entry, "--status", "--project-root", target.root, "--json"],
      { cwd: target.root, windowsHide: true, shell: false, timeout: Math.min(5000, remainingTimeoutMs), maxBuffer: 1024 * 1024 });
    return JSON.parse(stdout.trim());
  };

  async function projectForId(projectId) {
    if (typeof projectId !== "string" || !projectId) throw processError("PROCESS_PROJECT_REQUIRED", "必须明确指定项目。", 400);
    const registry = await loadRegistry();
    const project = registry.projects.find(candidate => candidate.id === projectId);
    if (!project) throw processError("PROCESS_PROJECT_UNKNOWN", "项目未注册到当前 Data Editor home。", 404);
    const root = await realpath(project.root);
    return { project, root, home: await realpath(home), state: await resolveCapabilities(project) };
  }

  function targetFor(projectInfo, binding) {
    const { project, root, state, home: realHome } = projectInfo;
    const digest = projectProcessDeclarationDigest(root, binding);
    const key = `${pathKey(realHome)}\0${project.id}\0${pathKey(root)}\0${binding.id}`;
    return { projectId: project.id, root, binding, generation: state.generation, declarationDigest: digest,
      key, file: path.join(realHome, "runtime", "project-processes", project.id, `${hash(pathKey(root)).slice(0, 24)}-${binding.id}.json`) };
  }

  async function resolveTarget(request) {
    validateRequest(request);
    const info = await projectForId(request.projectId);
    if (info.state.status !== "active") throw processError("PROCESS_CAPABILITY_UNAVAILABLE", "当前项目声明不可用于进程控制。");
    const binding = info.state.bindings.projectProcesses?.find(candidate => candidate.id === request.processId);
    if (!binding) throw processError("PROCESS_BINDING_UNKNOWN", "当前项目未声明此后台计算。", 404);
    const target = targetFor(info, binding);
    if (target.generation !== request.expectedGeneration || target.declarationDigest !== request.declarationDigest) throw processError("PROCESS_DECLARATION_STALE", "项目声明已变化，请刷新状态后重试。");
    return target;
  }

  function defaults(target) {
    return { version: 1, projectId: target.projectId, processId: target.binding.id, root: target.root,
      desiredEnabled: false, intentVersion: 0, permission: null, pendingAuthorization: null };
  }

  async function settings(target) {
    try {
      const value = JSON.parse(await readFile(target.file, "utf8"));
      if (value.version !== 1 || value.projectId !== target.projectId || value.processId !== target.binding.id
        || typeof value.root !== "string" || !sameProcessPath(value.root, target.root) || typeof value.desiredEnabled !== "boolean" || !Number.isSafeInteger(value.intentVersion) || value.intentVersion < 0) throw Error("PROCESS_SETTINGS_INVALID");
      return value;
    } catch (error) {
      if (error.code === "ENOENT") return defaults(target);
      throw processError("PROCESS_SETTINGS_INVALID", "本机进程设置不可读取；已禁止自动启动。");
    }
  }

  async function save(target, value) {
    await mkdir(path.dirname(target.file), { recursive: true });
    await atomicWrite(target.file, `${JSON.stringify(value, null, 2)}\n`);
  }

  const authorized = (target, value) => value.permission?.declarationDigest === target.declarationDigest
    && typeof value.permission?.root === "string" && sameProcessPath(value.permission.root, target.root) && value.permission?.entry === target.binding.entry;

  async function observation(target, value) {
    const pending = operations.get(target.key);
    if (pending) return { state: pending.action === "start" ? "starting" : "stopping", error: null };
    await validateProjectProcessEntry(target);
    return observeProjectProcess(target, { authorized: authorized(target, value), inspect: dependencies.inspect, runStatus });
  }

  function response(target, value, actual) {
    return { projectId: target.projectId, processId: target.binding.id, displayName: target.binding.displayName,
      root: target.root, entry: target.binding.entry, state: actual.state,
      desiredEnabled: value.desiredEnabled, intentVersion: value.intentVersion, authorized: authorized(target, value),
      generation: target.generation, declarationDigest: target.declarationDigest,
      error: actual.error ?? null, canStart: ["stopped", "failed"].includes(actual.state),
      canStop: actual.state === "running" || (actual.state === "starting" && !!actual.instance) };
  }

  async function readTarget(target) {
    let value = defaults(target);
    try {
      value = await settings(target);
      const actual = await observation(target, value);
      if (actual.state === "stopped" && value.desiredEnabled && authorized(target, value)) {
        actual.state = "failed"; actual.error = "已允许启动，但未发现对应的运行实例。";
      }
      return response(target, value, actual);
    } catch (error) { return response(target, value, { state: "unknown", error: error.message }); }
  }

  async function list(projectId) {
    const info = await projectForId(projectId);
    // Never expose last-known-good executable bindings when declaration is invalid.
    const bindings = info.state.status === "active" ? info.state.bindings.projectProcesses ?? [] : [];
    return { projectId, generation: info.state.generation, processes: await Promise.all(bindings.map(binding => readTarget(targetFor(info, binding)))),
      ...(info.state.status !== "active" && info.state.status !== "generic_absent" ? { error: info.state.error?.message ?? "项目能力声明不可用。" } : {}) };
  }

  function assertVersion(request, value) {
    if (request.expectedIntentVersion !== value.intentVersion) throw processError("PROCESS_INTENT_STALE", "开关意图已由另一页面或命令改变，请刷新后重试。");
  }

  async function execute(target, value, action) {
    await validateProjectProcessEntry(target);
    let actual = await observeProjectProcess(target, { authorized: true, inspect: dependencies.inspect, runStatus });
    if (actual.state === "unknown" || (action === "start" && actual.state === "starting")) return response(target, value, { ...actual, error: actual.error ?? "实例尚不能安全控制，请稍后刷新。" });
    if ((action === "start" && actual.state === "running") || (action === "stop" && actual.state === "stopped")) return response(target, value, actual);
    operations.set(target.key, { action });
    try {
      if (action === "start") {
        const nonce = randomUUID();
        const deadline = Date.now() + operationTimeoutMs;
        await spawn(process.execPath, [target.entry, "--watch", "--project-root", target.root, "--nonce", nonce],
          { cwd: target.root, env: process.env, timeoutMs: Math.max(1, Math.min(5000, deadline - Date.now())) });
        do {
          actual = await observeProjectProcess(target, { authorized: true, inspect: dependencies.inspect, runStatus, deadline });
          if (actual.state === "running") {
            if (actual.instance?.nonce !== nonce) return response(target, value, { state: "unknown", error: "启动后出现了另一个实例，未将其当作本次启动就绪。" });
            return response(target, value, actual);
          }
          await delay(Math.max(0, Math.min(100, deadline - Date.now())));
        } while (Date.now() < deadline);
        return response(target, value, { state: actual.state === "stopped" ? "failed" : "unknown", error: actual.error ?? "启动未能在期限内确认当前实例就绪。" });
      }
      await run(process.execPath, [target.entry, "--stop", "--project-root", target.root],
        { cwd: target.root, windowsHide: true, shell: false, timeout: stopTimeoutMs, maxBuffer: 1024 * 1024 });
      actual = await observeProjectProcess(target, { authorized: true, inspect: dependencies.inspect, runStatus });
      return response(target, value, { ...actual, ...(actual.state !== "stopped" ? { error: "已禁止下次自动启动，当前停止尚未完成。" } : {}) });
    } catch (error) {
      actual = await observeProjectProcess(target, { authorized: true, inspect: dependencies.inspect, runStatus });
      return response(target, value, { ...actual, state: action === "start" && actual.state === "stopped" ? "failed" : actual.state,
        error: action === "stop" ? `已禁止下次自动启动，当前停止尚未完成：${error.message}` : `启动失败：${error.message}` });
    } finally { operations.delete(target.key); }
  }

  async function control(request) {
    const preliminary = await resolveTarget(request);
    return lock(preliminary.key, async () => {
      const target = await resolveTarget(request);
      if (target.key !== preliminary.key) throw processError("PROCESS_ROOT_STALE", "注册项目身份已变化。");
      const value = await settings(target); assertVersion(request, value);
      if (request.action === "stop") { value.desiredEnabled = false; value.intentVersion++; value.pendingAuthorization = null; await save(target, value); }
      if (!authorized(target, value)) {
        value.pendingAuthorization = { action: request.action, generation: target.generation, declarationDigest: target.declarationDigest, intentVersion: value.intentVersion };
        await save(target, value);
        return { ...await readTarget(target), code: "AUTH_REQUIRED", authorizationRequest: { ...request, expectedIntentVersion: value.intentVersion } };
      }
      if (request.action === "start") { value.desiredEnabled = true; value.intentVersion++; value.pendingAuthorization = null; await save(target, value); }
      return execute(target, value, request.action);
    });
  }

  async function authorize(request) {
    const preliminary = await resolveTarget(request);
    return lock(preliminary.key, async () => {
      const target = await resolveTarget(request);
      if (target.key !== preliminary.key) throw processError("PROCESS_ROOT_STALE", "注册项目身份已变化。");
      const value = await settings(target); assertVersion(request, value);
      const pending = value.pendingAuthorization;
      if (!pending || pending.action !== request.action || pending.intentVersion !== value.intentVersion
        || pending.generation !== target.generation || pending.declarationDigest !== target.declarationDigest) throw processError("PROCESS_AUTHORIZATION_STALE", "原许可请求已失效，请重新操作。");
      await validateProjectProcessEntry(target);
      value.permission = { root: target.root, entry: target.binding.entry, declarationDigest: target.declarationDigest };
      value.pendingAuthorization = null;
      if (request.action === "start") { value.desiredEnabled = true; value.intentVersion++; }
      await save(target, value);
      return execute(target, value, request.action);
    });
  }

  async function projectIdForRoot(root) {
    const realRoot = await realpath(root);
    const registry = await loadRegistry();
    for (const project of registry.projects) if (sameProcessPath(await realpath(project.root), realRoot)) return project.id;
    throw processError("PROCESS_PROJECT_UNKNOWN", "当前 home 未注册此项目；不会改用其他 home。", 404);
  }

  async function open(projectId, processId = null) {
    const info = await projectForId(projectId);
    if (info.state.status !== "active") return list(projectId);
    const bindings = (info.state.bindings.projectProcesses ?? []).filter(binding => processId === null || binding.id === processId);
    if (processId !== null && !bindings.length) throw processError("PROCESS_BINDING_UNKNOWN", "项目未声明此后台计算。", 404);
    const processes = [];
    for (const binding of bindings) {
      const preliminary = targetFor(info, binding);
      processes.push(await lock(preliminary.key, async () => {
        const current = await projectForId(projectId);
        const currentBinding = current.state.status === "active" && current.state.bindings.projectProcesses?.find(candidate => candidate.id === binding.id);
        if (!currentBinding) throw processError("PROCESS_DECLARATION_STALE", "项目进程声明已变化。");
        const target = targetFor(current, currentBinding);
        if (target.key !== preliminary.key) throw processError("PROCESS_ROOT_STALE", "注册项目身份已变化。");
        const value = await settings(target);
        if (!value.desiredEnabled || !authorized(target, value)) return readTarget(target);
        return execute(target, value, "start");
      }));
    }
    return { projectId, generation: info.state.generation, processes };
  }

  return { list, control, authorize, open, projectIdForRoot };
}

function validateRequest(request) {
  if (!request || typeof request !== "object" || Array.isArray(request) || Object.keys(request).some(key => !actionKeys.has(key))
    || typeof request.processId !== "string" || !/^[a-z0-9_-]+$/.test(request.processId)
    || !["start", "stop"].includes(request.action) || !Number.isSafeInteger(request.expectedGeneration) || request.expectedGeneration < 1
    || !Number.isSafeInteger(request.expectedIntentVersion) || request.expectedIntentVersion < 0
    || typeof request.declarationDigest !== "string" || !/^[a-f0-9]{64}$/.test(request.declarationDigest)) throw processError("PROCESS_REQUEST_INVALID", "进程控制请求字段无效。", 400);
}
