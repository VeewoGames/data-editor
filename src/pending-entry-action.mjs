import crypto from "node:crypto";
import path from "node:path";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { atomicWrite } from "./atomic-file.mjs";
import { resolveInsideRoot } from "./project-context.mjs";

export function createPendingEntryActionStore({ projectContext, now = () => Date.now() }) {
  const directory = resolveInsideRoot(projectContext.projectRoot, path.join(projectContext.runtimeDir, "pending-entry-actions"));
  return {
    projectRoot: projectContext.projectRoot,
    runtimeDir: projectContext.runtimeDir,
    async create(entry) {
      const token = crypto.randomUUID();
      const value = { version: 1, state: "pending", createdAt: new Date(now()).toISOString(), expiresAt: new Date(now() + 10 * 60 * 1000).toISOString(), token, ...entry };
      await mkdir(directory, { recursive: true });
      await atomicWrite(tokenPath(directory, token), `${JSON.stringify(value, null, 2)}\n`);
      return value;
    },
    async read(token) {
      try { return JSON.parse(await readFile(tokenPath(directory, token), "utf8")); }
      catch (error) { if (error?.code === "ENOENT") return null; throw error; }
    },
    async write(entry) { await mkdir(directory, { recursive: true }); await atomicWrite(tokenPath(directory, entry.token), `${JSON.stringify(entry, null, 2)}\n`); return entry; },
    async list() {
      try { return Promise.all((await readdir(directory)).filter((name) => name.endsWith(".json")).map(async (name) => JSON.parse(await readFile(path.join(directory, name), "utf8")))); }
      catch (error) { if (error?.code === "ENOENT") return []; throw error; }
    },
    isExpired(entry) { return !entry?.expiresAt || Date.parse(entry.expiresAt) <= now(); },
  };
}

function tokenPath(directory, token) {
  if (!/^[0-9a-f-]{36}$/i.test(String(token))) throw Object.assign(new Error("Invalid pending action token."), { code: "ENTRY_ACTION_PENDING_TOKEN_INVALID", status: 400 });
  return path.join(directory, `${token}.json`);
}
