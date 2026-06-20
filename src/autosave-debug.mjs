export const autosaveDebugStorageKey = "data-editor:debug-autosave";
export const autosaveDebugQueryParam = "debugAutosave";
export const autosaveDebugGlobalKey = "__dataEditorAutosaveDebug";

function normalizeSearch(search) {
  if (!search) return "";
  return String(search).startsWith("?") ? String(search).slice(1) : String(search);
}

function safeGetItem(storage, key) {
  try {
    return typeof storage?.getItem === "function" ? storage.getItem(key) : null;
  } catch {
    return null;
  }
}

export function isAutosaveDebugEnabled({ storage, search }) {
  if (safeGetItem(storage, autosaveDebugStorageKey) === "1") return true;
  const query = new URLSearchParams(normalizeSearch(search));
  return query.get(autosaveDebugQueryParam) === "1";
}

function describeEvent(event) {
  if (event.kind === "request") return `${event.method ?? "POST"} ${event.url} ${event.status}`;
  if (event.kind === "state") return `state ${event.state}`;
  return event.kind;
}

function resolveLevel(event) {
  if (event.kind === "request" && event.status === "failure") return "error";
  if (event.kind === "state" && (event.state === "error" || event.state === "blocked-confirmation")) return "warn";
  return "info";
}

export function recordAutosaveDebugEvent(target, event, {
  console = globalThis.console,
  enabled = false,
  maxEntries = 50,
} = {}) {
  if (!enabled || !target) return null;
  const entry = {
    timestamp: new Date().toISOString(),
    ...event,
  };
  const current = target[autosaveDebugGlobalKey] ?? { enabled: true, events: [] };
  const events = [...current.events, entry].slice(-maxEntries);
  target[autosaveDebugGlobalKey] = { enabled: true, events };
  const level = resolveLevel(event);
  const logger = console && typeof console[level] === "function" ? console[level].bind(console) : null;
  logger?.(`[data-editor][autosave] ${describeEvent(event)}`, entry);
  return entry;
}

export function recordWindowAutosaveDebugEvent(event, windowObject = typeof window !== "undefined" ? window : null) {
  if (!windowObject) return null;
  return recordAutosaveDebugEvent(windowObject, event, {
    enabled: isAutosaveDebugEnabled({
      storage: windowObject.localStorage,
      search: windowObject.location?.search ?? "",
    }),
    console: windowObject.console,
  });
}
