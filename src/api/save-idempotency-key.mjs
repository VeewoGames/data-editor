export function createSaveIdempotencyKey({ now = () => Date.now(), random = () => Math.random(), cryptoApi = globalThis.crypto } = {}) {
  const uuid = typeof cryptoApi?.randomUUID === "function" ? cryptoApi.randomUUID() : "";
  if (typeof uuid === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(uuid)) return uuid;
  const entropy = Math.floor(random() * Number.MAX_SAFE_INTEGER).toString(36);
  return `save_${Number(now()).toString(36)}_${entropy}`;
}
