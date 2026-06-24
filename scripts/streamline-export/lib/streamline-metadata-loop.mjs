import { loadManifestMetadataSummary } from "./manifest-store.mjs";

export async function runStreamlineMetadataLoop({
  manifestPath,
  batchSize = 24,
  maxBatches = Number.POSITIVE_INFINITY,
  stopOnFailure = false,
  loadSummary = loadManifestMetadataSummary,
  runBatch,
} = {}) {
  if (!manifestPath) {
    throw new Error("runStreamlineMetadataLoop requires manifestPath");
  }
  if (typeof runBatch !== "function") {
    throw new Error("runStreamlineMetadataLoop requires runBatch");
  }
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error("runStreamlineMetadataLoop requires a positive batchSize");
  }
  if (!(maxBatches > 0)) {
    throw new Error("runStreamlineMetadataLoop requires maxBatches > 0");
  }

  const batches = [];

  for (let batchIndex = 0; batchIndex < maxBatches; batchIndex += 1) {
    const before = await loadSummary(manifestPath);
    if (before.pending <= 0) {
      return {
        complete: true,
        batches,
        before,
        after: before,
      };
    }

    const requested = Math.min(batchSize, before.pending);
    const result = await runBatch({
      batchIndex,
      requested,
      before,
    });
    const after = await loadSummary(manifestPath);
    const batch = {
      index: batchIndex + 1,
      requested,
      success: Number(result?.success ?? 0),
      failed: Number(result?.failed ?? 0),
      pendingBefore: before.pending,
      pendingAfter: after.pending,
    };
    batches.push(batch);
    if (stopOnFailure && batch.failed > 0) {
      return {
        complete: false,
        batches,
        before,
        after,
      };
    }
  }

  const after = await loadSummary(manifestPath);
  return {
    complete: after.pending <= 0,
    batches,
    before: batches[0] ? undefined : after,
    after,
  };
}
