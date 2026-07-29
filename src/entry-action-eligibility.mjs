import { readFile } from "node:fs/promises";
import { createProjectContext } from "./project-context.mjs";

export async function loadEntryActionEligibility(projectContextOrRoot) {
  const context = createProjectContext(projectContextOrRoot);
  let value;
  try {
    value = JSON.parse(await readFile(context.entryActionEligibilityPath, "utf8"));
  } catch (cause) {
    if (cause?.code === "ENOENT") disabled("Entry-action eligibility manifest is missing.");
    disabled("Entry-action eligibility manifest is unreadable.", cause);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== 3
    || value.version !== 1
    || value.protocolMode !== "proposal-only"
    || !Array.isArray(value.actions)
    || value.actions.length === 0
    || value.actions.some((actionId) => typeof actionId !== "string" || !/^[a-z0-9_-]+$/.test(actionId))
    || new Set(value.actions).size !== value.actions.length) {
    disabled("Entry-action eligibility manifest is invalid.");
  }
  return { version: 1, protocolMode: "proposal-only", actions: [...value.actions] };
}

export function assertEntryActionEligible(eligibility, actionId) {
  if (!eligibility?.actions?.includes(actionId)) {
    disabled(`Entry action is not eligible for proposal-only execution: ${actionId}`);
  }
  return true;
}

export class EntryActionProtocolDisabledError extends Error {
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = "EntryActionProtocolDisabledError";
    this.code = "ENTRY_ACTION_PROTOCOL_DISABLED";
    this.status = 503;
  }
}

function disabled(message, cause) {
  throw new EntryActionProtocolDisabledError(message, { cause });
}
