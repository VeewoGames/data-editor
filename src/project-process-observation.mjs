export function acceptsProjectProcessObservation(current, incoming, generation) {
  if (!Number.isSafeInteger(generation) || generation < 0) return false;
  if (!current) return true;
  if (generation < current.generation) return false;
  if (!incoming || generation > current.generation) return true;
  return incoming.projectId === current.projectId && incoming.processId === current.processId
    && incoming.declarationDigest === current.declarationDigest && incoming.intentVersion >= current.intentVersion;
}

// Poll requests can exceed the refresh interval because they inspect real OS
// identity. A rejected request must release this gate just like a successful one.
export function singleFlightPoll(operation) {
  let pending = false;
  return async () => {
    if (pending) return false;
    pending = true;
    try { await operation(); return true; }
    finally { pending = false; }
  };
}
