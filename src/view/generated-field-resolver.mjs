/**
 * Merge all refresh triggers. Scope/version changes invalidate in-flight results;
 * a queued trigger retries with the latest scope after the current read settles.
 * @param {{ getCurrent: () => import('./generated-fields-types').GeneratedRefreshScope,
 * read: (scope: import('./generated-fields-types').GeneratedRefreshScope) => Promise<import('./generated-fields-types').GeneratedFieldsResponse>,
 * onResult: (scope: import('./generated-fields-types').GeneratedRefreshScope, value: import('./generated-fields-types').GeneratedFieldsResponse) => void,
 * onError: (scope: import('./generated-fields-types').GeneratedRefreshScope) => void }} options
 */
export function createGeneratedFieldResolver({ getCurrent, read, onResult, onError }) {
  let flight = null; let flightScope = null; let queued = false; let disposed = false;
  const resolver = {
    refresh() {
      if (disposed) return Promise.resolve();
      if (flight) { const current = getCurrent(); queued ||= current.key !== flightScope.key || current.dirty !== flightScope.dirty; return flight; }
      const request = { ...getCurrent() };
      if (!request.projectId || !request.sourcePath) return Promise.resolve();
      flightScope = request;
      flight = (async () => {
        try {
          const value = await read(request);
          if (!disposed && getCurrent().key === request.key) onResult(request, value);
        } catch {
          if (!disposed && getCurrent().key === request.key) onError(request);
        } finally {
          flight = null; flightScope = null;
          if (queued && !disposed) { queued = false; void resolver.refresh(); }
        }
      })();
      return flight;
    },
    activate() { disposed = false; },
    dispose() { disposed = true; queued = false; },
  };
  return resolver;
}

/** Keep only the current scope's declaration after a failed refresh. ETag is
 * a value-pairing version, not the declaration identity.
 * @param {{ key: string; value: import('./generated-fields-types').GeneratedFieldsResponse } | null} previous
 * @param {import('./generated-fields-types').GeneratedRefreshScope} request
 */
export function invalidateGeneratedFieldResult(previous, request) {
  const value = previous?.value;
  if (!value || value.projectId !== request.projectId || value.sourcePath !== request.sourcePath || value.collectionPath !== request.collectionPath) return null;
  return { key: request.key, value: { ...value, bindings: value.bindings.map((binding) => ({ ...binding, state: "unavailable", rows: [], reason: "生成字段读取失败" })) } };
}
