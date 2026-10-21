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
    if (!policy || Object.keys(policy).sort().join(",") !== "collection,fields,file,requiresFields" || typeof policy.file !== "string" || !policy.file || policy.file.includes("..") || typeof policy.collection !== "string" || !policy.collection || !Array.isArray(policy.fields) || !policy.fields.length || !Array.isArray(policy.requiresFields) || [...policy.fields, ...policy.requiresFields].some(field => typeof field !== "string" || !field || ["__proto__", "constructor", "prototype"].includes(field))) throw invalid("Invalid field write policy target");
  }
  return value;
}
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export async function assertOrdinarySaveFieldPolicy({ context, sourcePath, beforeRoot, afterRoot }) {
  const policy = await loadFieldWritePolicy(context);
  for (const item of policy.policies.filter(item => item.file === sourcePath)) {
    const before = getRows(buildDocumentModel(beforeRoot, "json", sourcePath), item.collection);
    const after = getRows(buildDocumentModel(afterRoot, "json", sourcePath), item.collection);
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

/** Both the accepted run and the current declaration must explicitly opt in. */
export async function ordinarySaveBlockingRuns(context, runs) {
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
