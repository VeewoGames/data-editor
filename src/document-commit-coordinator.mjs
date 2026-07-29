import { canonicalFileIdentity } from "./canonical-file-identity.mjs";

/** Serializes formal mutations of one physical document. */
export function createDocumentCommitCoordinator({ identify = canonicalFileIdentity } = {}) {
  const tails = new Map();
  async function withIdentities(identities, operation) {
    if (typeof operation !== "function") throw new TypeError("Document commit operation must be a function.");
    const ordered = uniqueSortedIdentities(identities);
    const releases = [];
    try {
      for (const identity of ordered) {
        releases.push(await acquire(identity.canonicalFileKey));
      }
      return await operation(ordered);
    } finally {
      for (const release of releases.reverse()) release();
    }
  }

  async function acquire(canonicalFileKey) {
    const previous = tails.get(canonicalFileKey) ?? Promise.resolve();
    let releaseGate;
    const gate = new Promise((resolve) => { releaseGate = resolve; });
    const tail = previous.catch(() => undefined).then(() => gate);
    tails.set(canonicalFileKey, tail);
    await previous.catch(() => undefined);
    return () => {
      releaseGate();
      if (tails.get(canonicalFileKey) === tail) tails.delete(canonicalFileKey);
    };
  }

  return {
    async withCommit({ projectContext, sourcePath }, operation) {
      const identity = await identify(projectContext, sourcePath);
      return withIdentities([identity], ([resolved]) => operation(resolved));
    },
    withIdentities,
    get activeCount() { return tails.size; },
  };
}

function uniqueSortedIdentities(identities) {
  if (!Array.isArray(identities) || identities.length === 0) {
    throw new TypeError("At least one commit identity is required.");
  }
  const byKey = new Map();
  for (const identity of identities) {
    if (!identity || typeof identity.canonicalFileKey !== "string" || identity.canonicalFileKey.length === 0) {
      throw new TypeError("Commit identity must contain a stable canonical key.");
    }
    byKey.set(identity.canonicalFileKey, identity);
  }
  return [...byKey.values()].sort((left, right) => left.canonicalFileKey.localeCompare(right.canonicalFileKey));
}
