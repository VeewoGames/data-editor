export function createEntryActionCreateAdapterRegistry({ strategies = defaultStrategies() } = {}) {
  if (!(strategies instanceof Map)) throw adapterError("CANDIDATE_CREATE_ADAPTER_REGISTRY_INVALID");
  const registered = new Map(strategies);
  return Object.freeze({
    allocateServerFields: async (input) => {
      const descriptor = input?.contract?.createAdapter;
      if (!descriptor || typeof descriptor.id !== "string") throw adapterError("CANDIDATE_CREATE_SERVER_ALLOCATION_UNAVAILABLE");
      const strategy = registered.get(descriptor.id);
      if (typeof strategy !== "function") throw adapterError("CANDIDATE_CREATE_SERVER_ALLOCATION_UNAVAILABLE");
      return strategy(input, descriptor.config);
    },
  });
}

function defaultStrategies() {
  return new Map([["next-integer-v1", allocateNextInteger]]);
}

function allocateNextInteger({ fields, rows, contract }, config) {
  if (!plain(config) || Object.keys(config).sort().join(",") !== "field,startAt"
    || typeof config.field !== "string" || !Number.isSafeInteger(config.startAt) || config.startAt < 0
    || !Array.isArray(fields) || fields.length !== 1 || fields[0] !== config.field
    || !contract.serverOwnedFields.includes(config.field) || Object.hasOwn(contract.serverDefaults, config.field)) {
    throw adapterError("CANDIDATE_CREATE_SERVER_ALLOCATION_INVALID");
  }
  let maximum = config.startAt - 1;
  for (const row of rows) {
    if (!Object.hasOwn(row ?? {}, config.field)) continue;
    const value = row[config.field];
    if (!Number.isSafeInteger(value) || value < config.startAt) throw adapterError("CANDIDATE_CREATE_SERVER_ALLOCATION_INVALID");
    maximum = Math.max(maximum, value);
  }
  if (!Number.isSafeInteger(maximum + 1)) throw adapterError("CANDIDATE_CREATE_SERVER_ALLOCATION_INVALID");
  return { [config.field]: maximum + 1 };
}

function plain(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function adapterError(code) { return Object.assign(new Error(code), { code }); }
