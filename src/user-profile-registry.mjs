import { mkdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { withStoreDeliveryLock } from "./deployment-authority-io.mjs";
import { atomicWrite } from "./atomic-file.mjs";
import { dataEditorHome } from "./project-registry.mjs";
import { withProjectProcessLock } from "./project-process-lock.mjs";

const registryVersion = 1;
let profileRegistryWriteQueue = Promise.resolve();

export function userProfileRegistryPath(options = {}) {
  return path.join(path.resolve(options.home ?? dataEditorHome(options.env)), "user-profiles.json");
}

export async function loadUserProfileNames(options = {}) {
  try {
    const parsed = JSON.parse(await readFile(userProfileRegistryPath(options), "utf8"));
    if (parsed?.version !== registryVersion) throw new Error(`User profile registry version ${parsed?.version ?? "missing"} requires migration.`);
    return normalizeNames(parsed.names);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

export function registerUserProfileName(name, options = {}) {
  // Acquire before entering the Promise queue: a predecessor must never wait
  // for store while a later profile holds store and waits for that predecessor.
  return withStoreDeliveryLock(() => enqueueProfileName(name, options));
}

function enqueueProfileName(name, options) {
  const task = profileRegistryWriteQueue.catch(() => {}).then(async () => {
    const target = userProfileRegistryPath(options);
    // Recheck the physical identity after acquiring the shared lock: an alias
    // may have changed while another process owned the registry.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const identity = await registryIdentity(target);
      const result = await withProjectProcessLock(`user-profiles:${identity}`, async () => {
        if (await registryIdentity(target) !== identity) return null;
        await options.validateAttempt?.();
        const current = await loadUserProfileNames(options);
        const names = normalizeNames([...current, name]);
        if (names.length === current.length && names.every((value, index) => value === current[index])) return names;
        await options.validateWrite?.(target);
        await mkdir(path.dirname(target), { recursive: true });
        await (options.writeAtomic ?? atomicWrite)(target, `${JSON.stringify({ version: registryVersion, names }, null, 2)}\n`);
        return names;
      });
      if (result !== null) return result;
    }
    throw Object.assign(new Error("User profile registry identity changed during save."), { code: "PROFILE_REGISTRY_IDENTITY_CHANGED" });
  });
  profileRegistryWriteQueue = task;
  return task;
}

async function registryIdentity(file) {
  let physical;
  try { physical = await realpath(file); }
  catch (error) {
    if (error?.code !== "ENOENT" || path.dirname(file) === file) throw error;
    physical = path.join(await registryIdentity(path.dirname(file)), path.basename(file));
  }
  return process.platform === "win32" ? physical.toLowerCase() : physical;
}

export function mergeUserProfileNames(...groups) {
  return normalizeNames(groups.flat());
}

function normalizeNames(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .filter((value) => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value && !/[<>:"/\\|?*]/.test(value)))]
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}
