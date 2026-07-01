import crypto from "node:crypto";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { getRows } from "./document-model.mjs";
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

export function validateEntryActionTarget(action, sourcePath, collectionPath) {
  if (!action.targets.files.includes(sourcePath)) {
    throw new Error(`Entry action ${action.id} does not allow sourcePath: ${sourcePath}`);
  }
  if (!action.targets.collections.includes(collectionPath)) {
    throw new Error(`Entry action ${action.id} does not allow collectionPath: ${collectionPath}`);
  }
}

export function resolveEntryActionRow(model, collectionPath, sourceRowIndex) {
  const rows = getRows(model, collectionPath);
  if (sourceRowIndex < 0 || sourceRowIndex >= rows.length) {
    throw new Error(`sourceRowIndex is out of range for ${collectionPath}: ${sourceRowIndex}`);
  }
  return {
    row: rows[sourceRowIndex],
    previousRow: sourceRowIndex > 0 ? rows[sourceRowIndex - 1] : null,
    nextRow: sourceRowIndex + 1 < rows.length ? rows[sourceRowIndex + 1] : null,
    rowCount: rows.length,
  };
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

export function buildEntryActionHandoff({
  runId,
  project,
  action,
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
