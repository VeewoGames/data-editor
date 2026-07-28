import crypto from "node:crypto";
import path from "node:path";
import { open, rename, rm } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

export const defaultAtomicReplaceOptions = Object.freeze({
  maxRetries: 20,
  retryDelayMs: 10,
});

const defaultOps = {
  open,
  rename,
  rm,
  delay,
  randomUUID: () => crypto.randomUUID(),
};

export async function exclusiveCreateLock(lockPath, payload, options = {}) {
  const ops = resolveOps(options);
  let handle;
  let created = false;
  let closeAttempted = false;
  let closed = false;
  try {
    handle = await ops.open(lockPath, "wx");
    created = true;
    if (payload !== undefined) {
      await handle.writeFile(serializePayload(payload), payloadEncoding(payload));
    }
    await handle.sync();
    closeAttempted = true;
    await handle.close();
    closed = true;
  } catch (primaryError) {
    const cleanupErrors = [];
    if (handle && !closed && !closeAttempted) {
      try {
        await handle.close();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (created) {
      try {
        await ops.rm(lockPath, { force: true });
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    throw combineOperationAndCleanupErrors("exclusiveCreateLock", primaryError, cleanupErrors);
  }
}

export async function atomicReplace(sourcePath, targetPath, options = {}) {
  assertSameDirectoryAndVolume(sourcePath, targetPath);
  const ops = resolveOps(options);
  const maxRetries = readNonNegativeInteger(options.maxRetries, defaultAtomicReplaceOptions.maxRetries, "maxRetries");
  const retryDelayMs = readNonNegativeNumber(options.retryDelayMs, defaultAtomicReplaceOptions.retryDelayMs, "retryDelayMs");
  let firstRetryableError;
  for (let attempt = 0; ; attempt += 1) {
    try {
      await ops.rename(sourcePath, targetPath);
      return;
    } catch (error) {
      if (!isRetryableReplaceError(error)) throw error;
      firstRetryableError ??= error;
      if (attempt >= maxRetries) throw firstRetryableError;
      await ops.delay(retryDelayMs);
    }
  }
}

export async function atomicWrite(targetPath, data, options = {}) {
  const ops = resolveOps(options);
  const resolvedTarget = path.resolve(targetPath);
  const tempPath = path.join(
    path.dirname(resolvedTarget),
    `.data-editor-atomic-${ops.randomUUID()}.tmp`,
  );
  let handle;
  let created = false;
  let closeAttempted = false;
  let closed = false;
  try {
    handle = await ops.open(tempPath, "wx");
    created = true;
    await handle.writeFile(data, options.encoding ?? "utf8");
    await handle.sync();
    closeAttempted = true;
    await handle.close();
    closed = true;
    await atomicReplace(tempPath, resolvedTarget, { ...options, ops });
  } catch (primaryError) {
    const cleanupErrors = [];
    if (handle && !closed && !closeAttempted) {
      try {
        await handle.close();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (created) {
      try {
        await ops.rm(tempPath, { force: true });
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    throw combineOperationAndCleanupErrors("atomicWrite", primaryError, cleanupErrors);
  }
}

function resolveOps(options) {
  return { ...defaultOps, ...options.ops };
}

function serializePayload(payload) {
  if (typeof payload === "string" || Buffer.isBuffer(payload) || ArrayBuffer.isView(payload)) return payload;
  return `${JSON.stringify(payload, null, 2)}\n`;
}

function payloadEncoding(payload) {
  return typeof payload === "string" || (!Buffer.isBuffer(payload) && !ArrayBuffer.isView(payload))
    ? "utf8"
    : undefined;
}

function assertSameDirectoryAndVolume(sourcePath, targetPath) {
  const source = path.resolve(sourcePath);
  const target = path.resolve(targetPath);
  const sourceDirectory = normalizePathComparison(path.dirname(source));
  const targetDirectory = normalizePathComparison(path.dirname(target));
  const sourceRoot = normalizePathComparison(path.parse(source).root);
  const targetRoot = normalizePathComparison(path.parse(target).root);
  if (sourceDirectory !== targetDirectory || sourceRoot !== targetRoot) {
    throw new Error("Atomic replace requires source and target to be in the same directory and volume.");
  }
}

function normalizePathComparison(value) {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function isRetryableReplaceError(error) {
  return error?.code === "EPERM" || error?.code === "EBUSY";
}

function readNonNegativeInteger(value, fallback, label) {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 0) {
    throw new TypeError(`${label} must be a non-negative integer.`);
  }
  return resolved;
}

function readNonNegativeNumber(value, fallback, label) {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved < 0) {
    throw new TypeError(`${label} must be a non-negative number.`);
  }
  return resolved;
}

function combineOperationAndCleanupErrors(operation, primaryError, cleanupErrors) {
  if (cleanupErrors.length === 0) return primaryError;
  const error = new AggregateError(
    [primaryError, ...cleanupErrors],
    `${operation} failed and cleanup also failed.`,
    { cause: primaryError },
  );
  error.primaryError = primaryError;
  error.cleanupErrors = cleanupErrors;
  return error;
}
