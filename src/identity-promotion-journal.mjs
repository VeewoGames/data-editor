import path from "node:path";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { atomicWrite } from "./atomic-file.mjs";

export function createIdentityPromotionJournal({ directory }) {
  const root = path.resolve(directory);
  return {
    async read(idempotencyKey) {
      try { return JSON.parse(await readFile(entryPath(root, idempotencyKey), "utf8")); }
      catch (error) { if (error?.code === "ENOENT") return null; throw error; }
    },
    async write(entry) {
      if (!entry?.idempotencyKey) throw new Error("Identity promotion journal requires idempotencyKey.");
      await mkdir(root, { recursive: true });
      await atomicWrite(entryPath(root, entry.idempotencyKey), `${JSON.stringify(entry, null, 2)}\n`);
      return entry;
    },
    async list() {
      try {
        const names = await readdir(root);
        return Promise.all(names.filter((name) => name.endsWith(".json")).map(async (name) => JSON.parse(await readFile(path.join(root, name), "utf8"))));
      } catch (error) { if (error?.code === "ENOENT") return []; throw error; }
    },
  };
}

export function createIdentityPromotionIntent(input) {
  return { version: 1, kind: "identity_promotion", stage: "intent", recovery_pending: true, ...input };
}

export function completeIdentityPromotion(entry, receipt) {
  return { ...entry, stage: "receipt", recovery_pending: false, receipt };
}

function entryPath(root, key) {
  if (!/^[A-Za-z0-9_-]{8,}$/.test(String(key))) throw new Error("Invalid identity promotion idempotency key.");
  return path.join(root, `${key}.json`);
}
