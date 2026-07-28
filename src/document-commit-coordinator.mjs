import { canonicalFileIdentity } from "./canonical-file-identity.mjs";

/** Serializes formal mutations of one physical document. */
export function createDocumentCommitCoordinator({ identify = canonicalFileIdentity } = {}) {
  const tails = new Map();
  return {
    async withCommit({ projectContext, sourcePath }, operation) {
      if (typeof operation !== "function") throw new TypeError("Document commit operation must be a function.");
      const identity = await identify(projectContext, sourcePath);
      const previous = tails.get(identity.canonicalFileKey) ?? Promise.resolve();
      let release;
      const gate = new Promise((resolve) => { release = resolve; });
      const tail = previous.catch(() => undefined).then(() => gate);
      tails.set(identity.canonicalFileKey, tail);
      await previous.catch(() => undefined);
      try {
        return await operation(identity);
      } finally {
        release();
        if (tails.get(identity.canonicalFileKey) === tail) tails.delete(identity.canonicalFileKey);
      }
    },
    get activeCount() { return tails.size; },
  };
}
