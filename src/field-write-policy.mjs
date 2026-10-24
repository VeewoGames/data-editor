import {projectHistoricalRunActivity} from './historical-disposition.mjs';
import path from "node:path";
import { readFile } from "node:fs/promises";
import { buildDocumentModel, getRows } from "./document-model.mjs";
import { loadAutomationProfile } from "./automation-profile.mjs";
import { entryActionHandoffPath } from "./entry-actions.mjs";

function invalid(message, field = "policy") { return Object.assign(new Error(message), { code: "FIELD_WRITE_POLICY_INVALID", status: 409, field }); }
export async function loadFieldWritePolicy(context) {
  const text = await readFile(path.join(context.projectRoot, ".data-editor", "field-write-policy.json"), "utf8").catch(error => { if (error.code === "ENOENT") return null; throw error; });
  if (text === null) return { version: 1, policies: [] };
  const value = JSON.parse(text);
  if (value?.version !== 1 || Object.keys(value).sort().join(",") !== "policies,version" || !Array.isArray(value.policies)) throw invalid("Invalid field write policy");
  for (const policy of value.policies) {
    if (!policy || Object.keys(policy).filter(key => key !== "rowSelector").sort().join(",") !== "collection,fields,file,requiresFields" || typeof policy.file !== "string" || !policy.file || policy.file.includes("..") || typeof policy.collection !== "string" || !policy.collection || !Array.isArray(policy.fields) || !policy.fields.length || !Array.isArray(policy.requiresFields) || [...policy.fields, ...policy.requiresFields].some(field => typeof field !== "string" || !field || ["__proto__", "constructor", "prototype"].includes(field))) throw invalid("Invalid field write policy target");
    if (Object.hasOwn(policy, "rowSelector")) {
      const selector = policy.rowSelector;
      if (!selector || Object.keys(selector).sort().join(",") !== "primaryKeyField,values" || typeof selector.primaryKeyField !== "string" || !selector.primaryKeyField || ["__proto__", "constructor", "prototype"].includes(selector.primaryKeyField)
        || !Array.isArray(selector.values) || !selector.values.length || selector.values.some(value => !(typeof value === "string" && value.length > 0) && !Number.isSafeInteger(value)) || new Set(selector.values).size !== selector.values.length) throw invalid("Invalid field write policy row selector");
    }
  }
  return value;
}
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export async function assertOrdinarySaveFieldPolicy({ context, sourcePath, beforeRoot, afterRoot }) {
  const policy = await loadFieldWritePolicy(context);
  for (const item of policy.policies.filter(item => item.file === sourcePath)) {
    const before = getRows(buildDocumentModel(beforeRoot, "json", sourcePath), item.collection);
    const after = getRows(buildDocumentModel(afterRoot, "json", sourcePath), item.collection);
    if (item.rowSelector) {
      assertSelectedRows(item, before, after);
      continue;
    }
    const guarded = row => item.requiresFields.every(field => Object.hasOwn(row, field));
    const ids = new Map();
    for (const row of before) {
      if (!guarded(row)) continue;
      if (typeof row.__entry_id !== "string" || ids.has(row.__entry_id)) throw invalid("Protected rows require unique durable identity");
      ids.set(row.__entry_id, row);
    }
    const seen = new Set();
    for (const row of after) {
      const old = ids.get(row.__entry_id);
      if (!old && !guarded(row)) continue;
      if (old && seen.has(row.__entry_id)) throw invalid("Protected row identity duplicated");
      seen.add(row.__entry_id);
      // Removing the source marker cannot unlock fields on an existing row.
      if (old && !guarded(row)) throw Object.assign(invalid("普通保存不可移除动作字段的来源声明。", item.requiresFields[0]), { code: "FIELD_WRITE_POLICY_FORBIDDEN" });
      const previous = old ?? before.find(candidate => candidate.__entry_id === row.__entry_id);
      for (const field of item.fields) if (Object.hasOwn(previous ?? {}, field) !== Object.hasOwn(row, field) || !equal(previous?.[field], row[field])) throw Object.assign(invalid(`字段 ${field} 由条目动作维护，普通保存不可修改。`, field), { code: "FIELD_WRITE_POLICY_FORBIDDEN" });
    }
    // Whole-row deletion remains an ordinary row operation; field mutation does not.
  }
}

// Precise admission must survive both pre- and post-image checks. A protected
// row cannot be removed/recreated under a new identity by an ordinary save.
function assertSelectedRows(item, before, after) {
  const { primaryKeyField, values } = item.rowSelector;
  const selectedKeys = new Set(values);
  const selected = row => selectedKeys.has(row[primaryKeyField]);
  const forbidden = field => Object.assign(invalid(`字段 ${field} 或条目身份由条目动作维护，普通保存不可修改。`, field), { code: "FIELD_WRITE_POLICY_FORBIDDEN" });
  for (const rows of [before, after]) {
    const ids = new Set(), keys = new Set();
    const counts = new Map();
    for (const row of rows) counts.set(row.__entry_id, (counts.get(row.__entry_id) ?? 0) + 1);
    for (const row of rows.filter(selected)) {
      if (typeof row.__entry_id !== "string" || !row.__entry_id || ids.has(row.__entry_id) || keys.has(row[primaryKeyField]) || counts.get(row.__entry_id) !== 1) throw invalid("Selected rows require unique durable and primary identity");
      ids.add(row.__entry_id); keys.add(row[primaryKeyField]);
    }
  }
  const protectedIds = new Set([...before.filter(selected), ...after.filter(selected)].map(row => row.__entry_id));
  const beforeById = new Map(before.map(row => [row.__entry_id, row]));
  const afterById = new Map(after.map(row => [row.__entry_id, row]));
  for (const id of protectedIds) {
    const old = beforeById.get(id), row = afterById.get(id);
    if (!old || !row || !equal(old[primaryKeyField], row[primaryKeyField])) throw forbidden(primaryKeyField);
    for (const field of item.requiresFields) if (!Object.hasOwn(old, field) || !Object.hasOwn(row, field)) throw forbidden(field);
    for (const field of item.fields) if (Object.hasOwn(old, field) !== Object.hasOwn(row, field) || !equal(old[field], row[field])) throw forbidden(field);
  }
}

/** Both the accepted run and the current declaration must explicitly opt in. */
export async function ordinarySaveBlockingRuns(context, runs) {
  if (!runs.length) return [];
  ({runs}=await projectHistoricalRunActivity(context,runs));
  if (!runs.length) return [];
  const profile = await loadAutomationProfile(context);
  const blocked = [];
  for (const run of runs) {
    let handoff;
    try { handoff = JSON.parse(await readFile(entryActionHandoffPath(context, run.runId), "utf8")); } catch { blocked.push(run); continue; }
    const current = profile.rules.find(action => action.id === run.actionId);
    if (handoff.action?.execution?.kind !== "project-command" || handoff.action.execution.allowConcurrentSave !== true || current?.execution?.kind !== "project-command" || current.execution.allowConcurrentSave !== true || run.phase === "committing") blocked.push(run);
  }
  return blocked;
}
