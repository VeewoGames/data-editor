import crypto from "node:crypto";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

export const JOB_HELPER_PROTOCOL_VERSION = 2;
export const PROCESS_OWNERSHIP_ERROR_CODE = "ENTRY_ACTION_PROCESS_OWNERSHIP_UNAVAILABLE";
const execFileAsync = promisify(execFile);
const FILETIME_RE = /^(?:0|[1-9][0-9]*)$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ProcessOwnershipError extends Error {
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = "ProcessOwnershipError";
    this.code = PROCESS_OWNERSHIP_ERROR_CODE;
    this.stage = options.stage ?? "supervisor";
    this.details = options.details;
  }
}

export function resolveJobHelperPaths(toolRoot) {
  const directory = path.resolve(toolRoot, "native", "job-helper", "bin", "win32-x64");
  return Object.freeze({
    directory,
    sourcePath: path.resolve(toolRoot, "native", "job-helper", "JobHelper.cs"),
    executablePath: path.join(directory, "data-editor-job-helper.exe"),
    manifestPath: path.join(directory, "job-helper.manifest.json"),
  });
}

export async function verifyJobHelper(paths, options = {}) {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  if (platform !== "win32" || arch !== "x64") {
    throw ownershipError("verify", `Windows x64 Job helper is unavailable on ${platform}/${arch}.`);
  }
  let manifest;
  let executable;
  let source;
  try {
    const [manifestText, executableBytes, sourceBytes] = await Promise.all([
      readFile(paths.manifestPath, "utf8"),
      readFile(paths.executablePath),
      readFile(paths.sourcePath),
    ]);
    manifest = JSON.parse(manifestText.replace(/^\uFEFF/, ""));
    executable = executableBytes;
    source = sourceBytes;
  } catch (cause) {
    throw ownershipError("verify", "Unable to load the fixed Job helper distribution.", { cause });
  }
  for (const [key, value] of Object.entries({
    protocolVersion: JOB_HELPER_PROTOCOL_VERSION,
    platform: "win32",
    arch: "x64",
  })) {
    if (manifest?.[key] !== value) {
      throw ownershipError("verify", `Job helper manifest ${key} mismatch.`, {
        details: { expected: value, actual: manifest?.[key] },
      });
    }
  }
  if (manifest.testFaults === true && options.allowTestFaults !== true) {
    throw ownershipError("verify", "A test-fault Job helper cannot be used by the production supervisor.");
  }
  const executableHash = crypto.createHash("sha256").update(executable).digest("hex");
  const sourceHash = crypto.createHash("sha256").update(source).digest("hex");
  if (!isSha256(manifest.executableSha256) || executableHash !== manifest.executableSha256.toLowerCase()) {
    throw ownershipError("verify", "Job helper executable SHA-256 mismatch.");
  }
  if (!isSha256(manifest.sourceSha256) || sourceHash !== manifest.sourceSha256.toLowerCase()) {
    throw ownershipError("verify", "Job helper source SHA-256 mismatch.");
  }
  return Object.freeze({ ...manifest, executableSha256: executableHash, sourceSha256: sourceHash });
}

export function createJobSupervisor(options = {}) {
  const toolRoot = path.resolve(options.toolRoot ?? process.cwd());
  const helperPaths = options.helperPaths ?? resolveJobHelperPaths(toolRoot);
  const spawnProcess = options.spawnProcess ?? spawn;
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const verify = options.verifyHelper ?? verifyJobHelper;
  const getProcessCreationFileTime = options.getProcessCreationFileTime ?? ((pid, child) =>
    child?.creationFileTime ?? queryWindowsProcessCreationFileTime(pid));
  const startupTimeoutMs = positiveInteger(options.startupTimeoutMs, 10_000, "startupTimeoutMs");
  const ownershipAckTimeoutMs = positiveInteger(options.ownershipAckTimeoutMs, 10_000, "ownershipAckTimeoutMs");
  const terminationTimeoutMs = positiveInteger(options.terminationTimeoutMs, 5_000, "terminationTimeoutMs");
  const shutdownTimeoutMs = positiveInteger(options.shutdownTimeoutMs, 5_000, "shutdownTimeoutMs");
  const hardKillTimeoutMs = positiveInteger(options.hardKillTimeoutMs, 2_000, "hardKillTimeoutMs");
  const commandWriteTimeoutMs = positiveInteger(options.commandWriteTimeoutMs, 1_000, "commandWriteTimeoutMs");
  const maxStderrBytes = positiveInteger(options.maxStderrBytes, 64 * 1024, "maxStderrBytes");

  let generationSequence = 0;
  let currentGeneration = null;
  let ensurePromise = null;
  let shuttingDown = false;
  let shutdownPromise = null;
  let lastStderr = "";
  const starts = new Map();
  const active = new Map();

  async function start(spec) {
    if (shuttingDown) throw ownershipError("shutdown", "Job supervisor is shutting down.");
    const normalized = normalizeStartSpec(spec);
    if (normalized.testFault && options.allowTestFaults !== true) {
      throw ownershipError("protocol", "testFault is unavailable in the production supervisor.");
    }
    const generation = await ensureHelper();
    if (shuttingDown || !isCurrent(generation)) {
      throw ownershipError("shutdown", "Job supervisor is shutting down.");
    }
    const id = normalized.id ?? crypto.randomUUID();
    if (starts.has(id) || active.has(id)) throw ownershipError("protocol", `Duplicate supervised job id: ${id}`);

    const jobInstanceId = normalized.jobInstanceId ?? crypto.randomUUID();
    const record = {
      id,
      jobInstanceId,
      generation,
      pid: null,
      state: "starting",
      timedOut: false,
      ackTimer: null,
      runTimer: null,
      terminatePromise: null,
      startDeferred: deferred(),
      completionDeferred: deferred(),
    };
    starts.set(id, record);
    record.ackTimer = setTimeout(() => {
      if (record.state !== "starting") return;
      const error = ownershipError("owned", "Timed out waiting for Job helper ownership acknowledgement.");
      failStart(record, error);
      void stopGeneration(generation, error);
    }, ownershipAckTimeoutMs);

    void writeCommand(generation, {
      type: "start",
      id,
      jobInstanceId,
      command: normalized.command,
      args: normalized.args,
      ...(normalized.cwd ? { cwd: normalized.cwd } : {}),
      ...(normalized.testFault ? { testFault: normalized.testFault } : {}),
      ...(normalized.testEvidencePath ? { testEvidencePath: normalized.testEvidencePath } : {}),
    }).catch((cause) => {
      if (record.state !== "starting") return;
      const error = ownershipError("protocol", "Unable to send start command to Job helper.", { cause });
      failStart(record, error);
      void stopGeneration(generation, error);
    });

    const owned = await record.startDeferred.promise;
    if (normalized.timeoutMs !== null) {
      record.runTimer = setTimeout(() => {
        record.timedOut = true;
        void terminateRecord(record, "timeout").catch(() => {});
      }, normalized.timeoutMs);
    }
    return owned;
  }

  async function ensureHelper() {
    if (isCurrent(currentGeneration) && currentGeneration.readySettled) return currentGeneration;
    if (ensurePromise) return ensurePromise;
    const attempt = (async () => {
      await verify(helperPaths, {
        platform,
        arch,
        allowTestFaults: options.allowTestFaults === true,
      });
      if (shuttingDown) throw ownershipError("shutdown", "Job supervisor is shutting down.");

      let child;
      try {
        child = spawnProcess(helperPaths.executablePath, [`--parent-pid=${process.pid}`], {
          cwd: toolRoot,
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch (cause) {
        throw ownershipError("spawn", "Unable to spawn Job helper.", { cause });
      }
      let helperCreationFileTime;
      try {
        helperCreationFileTime = await getProcessCreationFileTime(child.pid, child);
      } catch (cause) {
        try { child.kill(); } catch { /* Fail closed when the helper identity cannot be read. */ }
        throw ownershipError("identity", "Unable to query spawned Job helper creation FILETIME.", { cause });
      }
      if (!isFileTime(helperCreationFileTime)) {
        try { child.kill(); } catch { /* Fail closed when the helper identity cannot be read. */ }
        throw ownershipError("identity", "Spawned Job helper creation FILETIME is invalid.");
      }
      const generation = createGeneration(++generationSequence, child, helperCreationFileTime);
      currentGeneration = generation;
      attachGeneration(generation);
      const timeout = Symbol("startup-timeout");
      const outcome = await raceWithTimeout(generation.ready.promise, startupTimeoutMs, timeout);
      if (outcome === timeout) {
        const error = ownershipError("startup", "Timed out waiting for Job helper readiness.");
        await stopGeneration(generation, error);
        throw error;
      }
      return generation;
    })();
    ensurePromise = attempt;
    try {
      return await attempt;
    } catch (error) {
      throw asOwnershipError(error, "startup");
    } finally {
      if (ensurePromise === attempt) ensurePromise = null;
    }
  }

  function createGeneration(id, child, helperCreationFileTime) {
    return {
      id,
      child,
      helperCreationFileTime,
      valid: true,
      readySettled: false,
      expectedExit: false,
      exited: false,
      stdoutBuffer: "",
      stderrBuffer: "",
      ready: deferred(),
      exit: deferred(),
      stopPromise: null,
    };
  }

  function attachGeneration(generation) {
    const child = generation.child;
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      if (!isCurrent(generation)) return;
      generation.stdoutBuffer += chunk;
      for (;;) {
        const newline = generation.stdoutBuffer.indexOf("\n");
        if (newline < 0) break;
        const line = generation.stdoutBuffer.slice(0, newline).replace(/\r$/, "");
        generation.stdoutBuffer = generation.stdoutBuffer.slice(newline + 1);
        if (line) handleMessageLine(generation, line);
      }
    });
    child.stderr?.on("data", (chunk) => {
      if (!isCurrent(generation)) return;
      generation.stderrBuffer = keepUtf8Tail(generation.stderrBuffer + chunk, maxStderrBytes);
      lastStderr = generation.stderrBuffer;
    });
    child.once("error", (cause) => {
      if (!isCurrent(generation)) return;
      const error = ownershipError("helper", "Job helper process error.", { cause });
      failGeneration(generation, error);
      void stopGeneration(generation, error);
    });
    child.once("exit", (code, signal) => {
      generation.exited = true;
      generation.exit.resolve({ code, signal });
      if (!isCurrent(generation)) return;
      generation.valid = false;
      currentGeneration = null;
      const recordsRemain = recordsForGeneration(generation).length > 0;
      if (!generation.expectedExit || recordsRemain) {
        failGeneration(generation, ownershipError("helper", "Job helper exited before all owned jobs completed.", {
          details: { code, signal, stderr: generation.stderrBuffer },
        }));
      }
    });
  }

  function handleMessageLine(generation, line) {
    if (!isCurrent(generation)) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch (cause) {
      const error = ownershipError("protocol", "Job helper emitted invalid JSON.", {
        cause,
        details: { line: keepUtf8Tail(line, 4096), stderr: generation.stderrBuffer },
      });
      failGeneration(generation, error);
      void stopGeneration(generation, error);
      return;
    }
    if (message.type === "ready") {
      if (generation.readySettled) return;
      if (!isReadyMessage(message, generation)) {
        const error = ownershipError("protocol", "Job helper ready identity is invalid or does not match the spawned helper.");
        generation.ready.reject(error);
        void stopGeneration(generation, error);
      } else {
        generation.readySettled = true;
        generation.ready.resolve(generation);
      }
      return;
    }
    const record = starts.get(message.id) ?? active.get(message.id);
    if (!record || record.generation !== generation) return;
    if (message.type === "owned" && record.state === "starting") {
      if (!isOwnedMessage(message, record, generation)) {
        const error = ownershipError("protocol", "Job helper owned identity is invalid or does not match the launch.");
        failStart(record, error);
        void stopGeneration(generation, error);
        return;
      }
      clearTimeout(record.ackTimer);
      record.ackTimer = null;
      starts.delete(record.id);
      record.state = "owned";
      record.pid = message.pid;
      record.childCreationFileTime = message.creationFileTime;
      active.set(record.id, record);
      record.startDeferred.resolve(Object.freeze({
        id: record.id,
        pid: record.pid,
        jobInstanceId: record.jobInstanceId,
        helper: Object.freeze({ pid: message.helperPid, creationFileTime: message.helperCreationFileTime }),
        child: Object.freeze({ pid: record.pid, creationFileTime: record.childCreationFileTime }),
        completion: record.completionDeferred.promise,
        terminate: (reason = "terminated") => terminateRecord(record, reason === "timeout" ? "timeout" : "terminated"),
      }));
      return;
    }
    if (message.type === "error") {
      const error = ownershipError(message.stage ?? "helper", message.message || "Job helper rejected ownership.", {
        details: {
          win32Error: message.win32Error,
          pid: Number(message.pid) || null,
          stderr: generation.stderrBuffer,
        },
      });
      if (record.state === "starting") failStart(record, error);
      else finishRecord(record, null, error);
      return;
    }
    if (message.type === "completed" && record.state === "owned") {
      finishRecord(record, {
        id: record.id,
        pid: record.pid,
        exitCode: Number(message.exitCode),
        reason: message.reason ?? (record.timedOut ? "timeout" : "exit"),
        timedOut: record.timedOut,
      });
    }
  }

  function terminateRecord(record, reason) {
    if (reason === "timeout") record.timedOut = true;
    if (record.state === "completed") return record.completionDeferred.promise;
    if (record.terminatePromise) return record.terminatePromise;
    record.terminatePromise = (async () => {
      try {
        await writeCommand(record.generation, { type: "terminate", id: record.id, reason });
      } catch (cause) {
        const error = ownershipError("terminate", "Unable to send Job termination.", { cause });
        await stopGeneration(record.generation, error);
        return record.completionDeferred.promise;
      }
      const timeout = Symbol("termination-timeout");
      const outcome = await raceWithTimeout(record.completionDeferred.promise, terminationTimeoutMs, timeout);
      if (outcome !== timeout) return outcome;
      const error = ownershipError("terminate", "Job helper did not acknowledge termination within the bound.");
      await stopGeneration(record.generation, error);
      return record.completionDeferred.promise;
    })();
    return record.terminatePromise;
  }

  function failStart(record, error) {
    if (record.state !== "starting") return;
    record.state = "completed";
    starts.delete(record.id);
    if (record.ackTimer) clearTimeout(record.ackTimer);
    record.startDeferred.reject(error);
  }

  function finishRecord(record, outcome, error) {
    if (record.state === "completed") return;
    record.state = "completed";
    starts.delete(record.id);
    active.delete(record.id);
    if (record.ackTimer) clearTimeout(record.ackTimer);
    if (record.runTimer) clearTimeout(record.runTimer);
    if (error) record.completionDeferred.reject(error);
    else record.completionDeferred.resolve(outcome);
  }

  function failGeneration(generation, error) {
    for (const record of [...starts.values()]) {
      if (record.generation === generation) failStart(record, error);
    }
    for (const record of [...active.values()]) {
      if (record.generation === generation) finishRecord(record, null, error);
    }
    if (!generation.readySettled) {
      generation.readySettled = true;
      generation.ready.reject(error);
    }
  }

  function stopGeneration(generation, error) {
    if (generation.stopPromise) return generation.stopPromise;
    generation.stopPromise = (async () => {
      failGeneration(generation, error);
      generation.valid = false;
      if (currentGeneration === generation) currentGeneration = null;
      let killResult = false;
      try {
        killResult = generation.child.kill() !== false;
      } catch {
        killResult = false;
      }
      if (!generation.exited) {
        const timeout = Symbol("hard-kill-timeout");
        await raceWithTimeout(generation.exit.promise, hardKillTimeoutMs, timeout);
      }
      if (!generation.exited) detachGeneration(generation);
      return killResult;
    })();
    return generation.stopPromise;
  }

  function detachGeneration(generation) {
    generation.valid = false;
    if (currentGeneration === generation) currentGeneration = null;
    for (const stream of [generation.child.stdin, generation.child.stdout, generation.child.stderr]) {
      try {
        stream?.destroy?.();
      } catch {
        // The hard bound takes precedence over a broken stream cleanup.
      }
    }
    try {
      generation.child.unref?.();
    } catch {
      // A failed helper is detached only after kill and the second hard bound.
    }
  }

  function writeCommand(generation, command) {
    if (!isCurrent(generation) || !generation.child.stdin?.writable) {
      return Promise.reject(ownershipError("protocol", "Job helper stdin is unavailable."));
    }
    const write = new Promise((resolve, reject) => {
      generation.child.stdin.write(`${JSON.stringify(command)}\n`, "utf8", (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    const timeout = Symbol("write-timeout");
    return raceWithTimeout(write, commandWriteTimeoutMs, timeout).then((outcome) => {
      if (outcome === timeout) throw ownershipError("protocol", "Timed out writing to Job helper.");
    });
  }

  async function shutdown() {
    if (shutdownPromise) return shutdownPromise;
    shuttingDown = true;
    shutdownPromise = (async () => {
      const generation = currentGeneration;
      for (const record of [...starts.values()]) {
        if (record.generation !== generation) continue;
        failStart(record, ownershipError("shutdown", "Supervisor shut down before ownership acknowledgement."));
        void writeCommand(generation, { type: "terminate", id: record.id, reason: "shutdown" }).catch(() => {});
      }
      await Promise.allSettled(
        [...active.values()]
          .filter((record) => record.generation === generation)
          .map((record) => terminateRecord(record, "shutdown")),
      );
      if (!generation || !isCurrent(generation)) return;
      generation.expectedExit = true;
      try {
        await writeCommand(generation, { type: "shutdown" });
      } catch {
        // The bounded hard-stop path below owns failed writes.
      }
      const timeout = Symbol("shutdown-timeout");
      const outcome = await raceWithTimeout(generation.exit.promise, shutdownTimeoutMs, timeout);
      if (outcome === timeout) {
        await stopGeneration(generation, ownershipError("shutdown", "Job helper did not exit within the shutdown bound."));
      }
    })();
    return shutdownPromise;
  }

  return Object.freeze({
    start,
    shutdown,
    get activeCount() {
      return starts.size + active.size;
    },
    get stderr() {
      return currentGeneration?.stderrBuffer ?? lastStderr;
    },
    get helperPid() {
      return currentGeneration?.child?.pid ?? null;
    },
  });

  function isCurrent(generation) {
    return generation?.valid === true && currentGeneration === generation;
  }

  function recordsForGeneration(generation) {
    return [...starts.values(), ...active.values()].filter((record) => record.generation === generation);
  }
}

function isReadyMessage(message, generation) {
  return hasExactKeys(message, ["type", "protocolVersion", "pid", "creationFileTime"]) &&
    message.type === "ready" &&
    message.protocolVersion === JOB_HELPER_PROTOCOL_VERSION &&
    message.pid === generation.child.pid &&
    isProcessId(message.pid) &&
    isFileTime(message.creationFileTime) &&
    message.creationFileTime === generation.helperCreationFileTime;
}

function isOwnedMessage(message, record, generation) {
  return hasExactKeys(message, ["type", "id", "jobInstanceId", "helperPid", "helperCreationFileTime", "pid", "creationFileTime"]) &&
    message.type === "owned" &&
    message.id === record.id &&
    message.jobInstanceId === record.jobInstanceId &&
    isUuid(message.jobInstanceId) &&
    message.helperPid === generation.child.pid &&
    isProcessId(message.helperPid) &&
    message.helperCreationFileTime === generation.helperCreationFileTime &&
    isFileTime(message.helperCreationFileTime) &&
    isProcessId(message.pid) &&
    isFileTime(message.creationFileTime);
}

function hasExactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isProcessId(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function isFileTime(value) {
  return typeof value === "string" && FILETIME_RE.test(value);
}

function isUuid(value) {
  return typeof value === "string" && UUID_RE.test(value);
}

async function queryWindowsProcessCreationFileTime(pid) {
  if (!isProcessId(pid)) throw new TypeError("pid must be a positive safe integer.");
  const script = `$p=[Diagnostics.Process]::GetProcessById(${pid}); [Console]::Out.Write($p.StartTime.ToUniversalTime().ToFileTimeUtc().ToString([Globalization.CultureInfo]::InvariantCulture))`;
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    windowsHide: true,
    timeout: 5_000,
    maxBuffer: 1024,
  });
  const creationFileTime = stdout.trim();
  if (!isFileTime(creationFileTime)) throw new Error("Windows did not return an unsigned decimal creation FILETIME.");
  return creationFileTime;
}

function normalizeStartSpec(spec) {
  if (!spec || typeof spec !== "object") throw new TypeError("Job start spec is required.");
  if (typeof spec.command !== "string" || !spec.command.trim()) throw new TypeError("Job command is required.");
  if (spec.args !== undefined && (!Array.isArray(spec.args) || spec.args.some((value) => typeof value !== "string"))) {
    throw new TypeError("Job args must be an array of strings.");
  }
  if (spec.cwd !== undefined && (typeof spec.cwd !== "string" || !path.isAbsolute(spec.cwd))) {
    throw new TypeError("Job cwd must be an absolute path.");
  }
  if (spec.testEvidencePath !== undefined &&
      (typeof spec.testEvidencePath !== "string" || !path.isAbsolute(spec.testEvidencePath))) {
    throw new TypeError("testEvidencePath must be an absolute path.");
  }
  if (spec.jobInstanceId !== undefined && !isUuid(spec.jobInstanceId)) throw new TypeError("jobInstanceId must be a UUID.");
  return {
    id: typeof spec.id === "string" && spec.id.trim() ? spec.id.trim() : null,
    jobInstanceId: spec.jobInstanceId === undefined ? null : String(spec.jobInstanceId),
    command: path.resolve(spec.command),
    args: spec.args ?? [],
    cwd: spec.cwd ? path.resolve(spec.cwd) : null,
    timeoutMs: spec.timeoutMs === undefined || spec.timeoutMs === null
      ? null
      : positiveInteger(spec.timeoutMs, null, "timeoutMs"),
    testFault: typeof spec.testFault === "string" ? spec.testFault : null,
    testEvidencePath: spec.testEvidencePath ? path.resolve(spec.testEvidencePath) : null,
  };
}

function ownershipError(stage, message, options = {}) {
  return new ProcessOwnershipError(message, { ...options, stage });
}

function asOwnershipError(error, stage) {
  return error instanceof ProcessOwnershipError
    ? error
    : ownershipError(stage, error?.message ?? String(error), { cause: error });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function raceWithTimeout(promise, milliseconds, timeoutValue) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(timeoutValue), milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function positiveInteger(value, fallback, label) {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved <= 0) throw new TypeError(`${label} must be a positive integer.`);
  return resolved;
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function keepUtf8Tail(value, maxBytes) {
  const bytes = Buffer.from(value, "utf8");
  return bytes.length <= maxBytes ? value : bytes.subarray(bytes.length - maxBytes).toString("utf8");
}
