import crypto from "node:crypto";
import path from "node:path";
import { access, mkdir, readFile, readdir } from "node:fs/promises";
import { getRows } from "./document-model.mjs";
import { readPersistentEntryId } from "./model/persistent-entry-id.mjs";
import { createProjectContext, resolveInsideRoot } from "./project-context.mjs";
import { isTerminalEntryActionState, migrateLegacyEntryActionStateRecord, normalizeEntryActionStateRecord } from "./entry-action-state.mjs";
import { canonicalFileIdentity } from "./canonical-file-identity.mjs";
import { atomicWrite, exclusiveCreateLock } from "./atomic-file.mjs";

export function normalizeEntryActionPath(value, label) {
  const normalized = String(value ?? "").trim().replaceAll("\\", "/");
  if (!normalized) throw new Error(`Missing ${label}`);
  return normalized;
}

export function normalizeEntryActionRowId(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

export function normalizeEntryActionSourceRowIndex(value) {
  if (value == null || value === "") return null;
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 0) {
    throw new Error(`Invalid sourceRowIndex: ${value}`);
  }
  return normalized;
}

export function findEntryAction(project, actionId) {
  const normalizedActionId = String(actionId ?? "").trim();
  if (!normalizedActionId) throw new Error("Missing actionId");
  const action = project.entryActions?.find((candidate) => candidate.id === normalizedActionId);
  if (!action) throw new Error(`Unknown entry action: ${normalizedActionId}`);
  return action;
}

export function findAutomationEntryAction(profile, actionId) {
  const normalizedActionId = String(actionId ?? "").trim();
  if (!normalizedActionId) throw new Error("Missing actionId");
  const action = profile?.rules?.find((candidate) => candidate.id === normalizedActionId);
  if (!action) throw new Error(`Unknown entry action: ${normalizedActionId}`);
  if (action.enabled === false) throw new Error(`Entry action is disabled: ${normalizedActionId}`);
  return action;
}

export function resolveAutomationEntryActionBinding(bindings, actionId) {
  const normalizedActionId = String(actionId ?? "").trim();
  const binding = bindings?.bindings?.[normalizedActionId];
  if (!binding) throw new Error(`Missing automation binding: ${normalizedActionId}`);
  if (binding.enabled === false) throw new Error(`Automation binding is disabled: ${normalizedActionId}`);
  if (!String(binding.skill ?? "").trim()) throw new Error(`Automation binding is missing skill: ${normalizedActionId}`);
  return binding;
}

export function validateEntryActionTarget(action, sourcePath, collectionPath) {
  const matched = action.targets.some((target) => target.file === sourcePath && target.collection === collectionPath);
  if (!matched) {
    throw new Error(`Entry action ${action.id} does not allow target: ${sourcePath}#${collectionPath}`);
  }
}

export function resolveEntryActionRow(model, collectionPath, sourceRowIndex, rowId = null) {
  const rows = getRows(model, collectionPath);
  const resolvedSourceRowIndex = resolveEntryActionSourceRowIndex(model, collectionPath, sourceRowIndex, rowId);
  if (resolvedSourceRowIndex < 0 || resolvedSourceRowIndex >= rows.length) {
    throw new Error(`sourceRowIndex is out of range for ${collectionPath}: ${resolvedSourceRowIndex}`);
  }
  return {
    row: rows[resolvedSourceRowIndex],
    previousRow: resolvedSourceRowIndex > 0 ? rows[resolvedSourceRowIndex - 1] : null,
    nextRow: resolvedSourceRowIndex + 1 < rows.length ? rows[resolvedSourceRowIndex + 1] : null,
    rowCount: rows.length,
    sourceRowIndex: resolvedSourceRowIndex,
  };
}

export function resolveEntryActionSourceRowIndex(model, collectionPath, sourceRowIndex, rowId = null) {
  const rows = getRows(model, collectionPath);
  if (typeof rowId !== "string" || !rowId.trim()) entryTargetError("ENTRY_ACTION_TARGET_MISSING", "A persistent __entry_id is required.");
  const matches = rows.flatMap((row, index) => readPersistentEntryId(row) === rowId.trim() ? [index] : []);
  if (matches.length === 0) entryTargetError("ENTRY_ACTION_TARGET_MISSING", "Persistent __entry_id was not found in the target collection.");
  if (matches.length > 1) entryTargetError("ENTRY_ACTION_TARGET_ID_DUPLICATE", "Persistent __entry_id is duplicated in the target collection.");
  return matches[0];
}

function entryTargetError(code, message) { throw Object.assign(new Error(message), { code }); }

export function createEntryActionRunId() {
  return crypto.randomUUID();
}

export function entryActionsRuntimeDir(projectContextOrRoot) {
  const context = createProjectContext(projectContextOrRoot);
  return resolveInsideRoot(context.projectRoot, path.join(context.runtimeDir, "entry-actions"));
}

export function entryActionHandoffPath(projectContextOrRoot, runId) {
  return path.join(entryActionsRuntimeDir(projectContextOrRoot), `${runId}.json`);
}

export function entryActionStartedPath(projectContextOrRoot, runId) {
  return path.join(entryActionsRuntimeDir(projectContextOrRoot), `${runId}.started.json`);
}

export function entryActionResultPath(projectContextOrRoot, runId) {
  return path.join(entryActionsRuntimeDir(projectContextOrRoot), `${runId}.result.json`);
}

export function entryActionOutputPath(projectContextOrRoot, runId) {
  return path.join(entryActionsRuntimeDir(projectContextOrRoot), `${runId}.reply.md`);
}

export function entryActionProposalPath(projectContextOrRoot, runId) { return path.join(entryActionsRuntimeDir(projectContextOrRoot), `${runId}.proposal.json`); }
export function entryActionDiagnosticsPath(projectContextOrRoot, runId) { return path.join(entryActionsRuntimeDir(projectContextOrRoot), `${runId}.diagnostics.json`); }

export async function describeEntryActionArtifacts(projectContextOrRoot, runId) {
  return {
    proposal: await describeArtifact(entryActionProposalPath(projectContextOrRoot, runId)),
    reply: await describeArtifact(entryActionOutputPath(projectContextOrRoot, runId)),
    diagnostics: await describeArtifact(entryActionDiagnosticsPath(projectContextOrRoot, runId)),
  };
}

async function describeArtifact(targetPath) {
  try { await access(targetPath); return { path: targetPath, available: true }; }
  catch { return { path: targetPath, available: false }; }
}

export async function writeEntryActionHandoff(projectContextOrRoot, runId, payload) {
  const targetPath = entryActionHandoffPath(projectContextOrRoot, runId);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await atomicWrite(targetPath, `${JSON.stringify(payload, null, 2)}\n`);
  return targetPath;
}

export async function writeEntryActionStarted(projectContextOrRoot, runId, payload) {
  const targetPath = entryActionStartedPath(projectContextOrRoot, runId);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await exclusiveCreateLock(targetPath, `${JSON.stringify(normalizeEntryActionStateRecord(payload), null, 2)}\n`);
  return targetPath;
}

export async function advanceEntryActionPhase(projectContextOrRoot, runId, phase, details = {}) {
  const targetPath = entryActionStartedPath(projectContextOrRoot, runId);
  const current = await readEntryActionStarted(projectContextOrRoot, runId);
  if (activePhaseRank(phase) < activePhaseRank(current.phase)) {
    throw Object.assign(new Error("ENTRY_ACTION_PHASE_REGRESSION"), { code: "ENTRY_ACTION_PHASE_REGRESSION" });
  }
  const advancedAt = new Date().toISOString();
  const normalized = normalizeEntryActionStateRecord({
    ...current,
    ...details,
    runId,
    phase,
    outcome: null,
    phaseStartedAt: advancedAt,
    phaseHistory: [...(Array.isArray(current.phaseHistory) ? current.phaseHistory : []), { phase, startedAt: advancedAt }],
    updatedAt: advancedAt,
  });
  await atomicWrite(targetPath, `${JSON.stringify(normalized, null, 2)}\n`);
  return normalized;
}

export async function publishEntryActionResultIdempotently(projectContextOrRoot, runId, payload) {
  const targetPath = entryActionResultPath(projectContextOrRoot, runId);
  const normalized = normalizeEntryActionStateRecord(payload);
  await mkdir(path.dirname(targetPath), { recursive: true });
  try {
    await exclusiveCreateLock(targetPath, `${JSON.stringify(normalized, null, 2)}\n`);
    return { ...normalized, replayed: false };
  } catch (cause) {
    if (cause?.code !== "EEXIST") throw cause;
  }
  const existing = normalizeEntryActionStateRecord(JSON.parse(await readFile(targetPath, "utf8")));
  if (stableJson(existing) !== stableJson(normalized)) {
    throw Object.assign(new Error("ENTRY_ACTION_RESULT_IDEMPOTENCY_CONFLICT"), { code: "ENTRY_ACTION_RESULT_IDEMPOTENCY_CONFLICT" });
  }
  return { ...existing, replayed: true };
}

export async function readEntryActionStarted(projectContextOrRoot, runId) {
  const targetPath = entryActionStartedPath(projectContextOrRoot, runId);
  return normalizeEntryActionStateRecord(JSON.parse(await readFile(targetPath, "utf8")));
}

export async function readEntryActionResult(projectContextOrRoot, runId) {
  const targetPath = entryActionResultPath(projectContextOrRoot, runId);
  return normalizeEntryActionStateRecord(JSON.parse(await readFile(targetPath, "utf8")));
}

/**
 * Permanently upgrades known pre-v2 runtime state files before normal reads.
 */
export async function migrateLegacyEntryActionStateArtifacts(projectContextOrRoot) {
  const runtimeDir = entryActionsRuntimeDir(projectContextOrRoot);
  let fileNames = [];
  try {
    fileNames = await readdir(runtimeDir);
  } catch {
    return { migrated: [] };
  }

  const migrated = [];
  for (const fileName of fileNames) {
    const artifactKind = fileName.endsWith(".started.json") ? "started"
      : fileName.endsWith(".result.json") ? "result"
        : null;
    if (!artifactKind) continue;
    const targetPath = path.join(runtimeDir, fileName);
    try {
      const legacy = JSON.parse(await readFile(targetPath, "utf8"));
      const next = migrateLegacyEntryActionStateRecord(legacy, artifactKind);
      if (!next) continue;
      await atomicWrite(targetPath, `${JSON.stringify(next, null, 2)}\n`);
      migrated.push(targetPath);
    } catch {
      // Malformed or unknown artifacts remain untouched for manual diagnosis.
    }
  }
  return { migrated };
}

export async function findLatestEntryActionRun(projectContextOrRoot, identity) {
  const runtimeDir = entryActionsRuntimeDir(projectContextOrRoot);
  let fileNames = [];
  try {
    fileNames = await readdir(runtimeDir);
  } catch {
    return null;
  }

  const matches = [];
  for (const fileName of fileNames) {
    if (!fileName.endsWith(".json") || fileName.endsWith(".started.json") || fileName.endsWith(".result.json")) continue;
    try {
      const handoff = JSON.parse(await readFile(path.join(runtimeDir, fileName), "utf8"));
      if (!matchesEntryActionIdentity(handoff, identity)) continue;
      matches.push(handoff);
    } catch {
      // Ignore partial or unrelated runtime files.
    }
  }

  const latest = matches.sort((left, right) => String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? "")))[0];
  if (!latest) return null;
  const runId = latest.runId;
  const actionId = latest.action?.id ?? null;
  try {
    return { ...await readEntryActionResult(projectContextOrRoot, runId), actionId, createdAt: latest.createdAt ?? null };
  } catch {}
  try {
    return { ...await readEntryActionStarted(projectContextOrRoot, runId), actionId, createdAt: latest.createdAt ?? null };
  } catch {}
  return { runId, actionId, createdAt: latest.createdAt ?? null, phase: "running", outcome: null };
}

/** Returns every non-terminal run for one canonical physical source file. */
export async function findActiveEntryActionRuns(projectContextOrRoot, sourcePath) {
  const context = createProjectContext(projectContextOrRoot);
  const identity = await canonicalFileIdentity(context, sourcePath);
  let fileNames = [];
  try { fileNames = await readdir(entryActionsRuntimeDir(context)); } catch { return { canonicalFileKey: identity.canonicalFileKey, runs: [] }; }
  const runs = [];
  for (const fileName of fileNames) {
    if (!fileName.endsWith(".json") || fileName.endsWith(".started.json") || fileName.endsWith(".result.json")) continue;
    try {
      const handoff = JSON.parse(await readFile(path.join(entryActionsRuntimeDir(context), fileName), "utf8"));
      if (handoff?.entry?.canonicalFileKey !== identity.canonicalFileKey || typeof handoff.runId !== "string") continue;
      let state = { runId: handoff.runId, phase: "running", outcome: null };
      try { state = await readEntryActionResult(context, handoff.runId); }
      catch { try { state = await readEntryActionStarted(context, handoff.runId); } catch {} }
      if (!isTerminalEntryActionState(state)) runs.push({ runId: handoff.runId, actionId: handoff?.action?.id ?? null, sourcePath: handoff?.entry?.sourcePath ?? identity.sourcePath, phase: state.phase });
    } catch {}
  }
  return { canonicalFileKey: identity.canonicalFileKey, runs };
}

export function matchesEntryActionIdentity(handoff, identity) {
  const entry = handoff?.entry;
  if (!entry || entry.sourcePath !== identity.sourcePath || entry.collectionPath !== identity.collectionPath) return false;
  if (identity.actionId && handoff?.action?.id !== identity.actionId) return false;
  return Boolean(identity.rowId && entry.rowId && identity.rowId === entry.rowId);
}

export function buildEntryActionHandoff({
  runId,
  project,
  action,
  binding,
  runtime,
  sourcePath,
  collectionPath,
  rowId,
  sourceRowIndex,
  row,
  previousRow,
  nextRow,
  rowCount,
}) {
  const createdAt = new Date().toISOString();
  return {
    version: 1,
    runId,
    createdAt,
    action: {
      id: action.id,
      label: action.label,
      icon: action.icon,
      binding: binding ? {
        provider: binding.provider,
        skill: binding.skill,
      } : null,
      runtime: runtime ? {
        model: runtime.model,
        reasoning: runtime.reasoning,
        verbosity: runtime.verbosity,
        timeoutMs: runtime.timeoutMs,
      } : null,
      payload: {
        includeRow: action.payload.includeRow,
        includeNeighbors: action.payload.includeNeighbors,
      },
    },
    project: {
      id: project.id,
      name: project.name,
      root: project.root,
    },
    entry: {
      sourcePath,
      collectionPath,
      rowId,
      sourceRowIndex,
      rowCount,
      row: action.payload.includeRow ? structuredClone(row) : null,
      previousRow: action.payload.includeNeighbors && previousRow != null ? structuredClone(previousRow) : null,
      nextRow: action.payload.includeNeighbors && nextRow != null ? structuredClone(nextRow) : null,
    },
  };
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function activePhaseRank(phase) {
  const rank = ["queued", "preparing_input", "preflight_running", "running", "review_running", "proposal_ready", "committing"].indexOf(phase);
  if (rank < 0) throw Object.assign(new Error("ENTRY_ACTION_STATE_INVALID"), { code: "ENTRY_ACTION_STATE_INVALID" });
  return rank;
}
