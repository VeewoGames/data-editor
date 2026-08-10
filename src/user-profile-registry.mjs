import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { atomicWrite } from "./atomic-file.mjs";
import { dataEditorHome } from "./project-registry.mjs";

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

export async function registerUserProfileName(name, options = {}) {
  const task = profileRegistryWriteQueue.catch(() => {}).then(async () => {
    const names = normalizeNames([...(await loadUserProfileNames(options)), name]);
    const target = userProfileRegistryPath(options);
    await mkdir(path.dirname(target), { recursive: true });
    await atomicWrite(target, `${JSON.stringify({ version: registryVersion, names }, null, 2)}\n`);
    return names;
  });
  profileRegistryWriteQueue = task;
  return task;
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
