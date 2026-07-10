import crypto from "node:crypto";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { getRows } from "./document-model.mjs";
import { buildDocumentStore } from "./model/document-store.mjs";
import { createProjectContext, resolveInsideRoot } from "./project-context.mjs";

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
  if (rowId) {
    const store = buildDocumentStore({
      documentId: model?.sourcePath || "document",
      model,
    });
    const resolvedFromRowId = store.collections.get(collectionPath)?.sourceIndexByRowId.get(rowId) ?? null;
    if (Number.isInteger(resolvedFromRowId)) return resolvedFromRowId;
  }
  if (sourceRowIndex < 0 || sourceRowIndex >= rows.length) {
    throw new Error(`sourceRowIndex is out of range for ${collectionPath}: ${sourceRowIndex}`);
  }
  return sourceRowIndex;
}

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

export async function writeEntryActionHandoff(projectContextOrRoot, runId, payload) {
  const targetPath = entryActionHandoffPath(projectContextOrRoot, runId);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return targetPath;
}

export async function readEntryActionStarted(projectContextOrRoot, runId) {
  const targetPath = entryActionStartedPath(projectContextOrRoot, runId);
  return JSON.parse(await readFile(targetPath, "utf8"));
}

export async function readEntryActionResult(projectContextOrRoot, runId) {
  const targetPath = entryActionResultPath(projectContextOrRoot, runId);
  return JSON.parse(await readFile(targetPath, "utf8"));
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
