import { parseCsv } from "./csv-codec.mjs";
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { resolveDataFilePath, normalizeDataFileVirtualPath } from "./file-service.mjs";
import { findCapabilityBindings, resolveProjectCapabilityState } from "./project-capability-registry.mjs";
import { buildDocumentModel, getRows } from "./document-model.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fail = (reason) => { throw new Error(reason); };
const inside = (root, target) => { const relative = path.relative(root, target); return !relative.startsWith("..") && !path.isAbsolute(relative); };
function relativeFile(value) {
  if (typeof value !== "string" || !value || value.includes("\\") || value.split("/").some((part) => !part || part === "." || part === "..") || path.isAbsolute(value) || /^[a-z]:/i.test(value)) fail("依赖路径必须位于项目内");
  return value;
}
async function safeFile(root, relative) {
  const target = await realpath(path.resolve(root, relativeFile(relative)));
  if (!inside(root, target)) fail("真实文件路径越过项目边界");
  return target;
}
function scope(context, sourcePath, collection) {
  const virtual = normalizeDataFileVirtualPath(context, sourcePath);
  const slash = virtual.indexOf("/");
  return { dataSourceId: virtual.slice(0, slash), path: virtual.slice(slash + 1), collection };
}
export function assertNoGeneratedFieldInjection({ context, state, sourcePath, root }) {
  const target = scope(context, sourcePath, null);
  for (const binding of findCapabilityBindings({ ...state, status: "active" }, { engine: "generated-fields-v1", ...target })) {
    const rows = getRows(buildDocumentModel(root, "json"), binding.match.collection);
    for (const row of rows) for (const field of binding.fields) {
      if (Object.hasOwn(row, field.name)) throw Object.assign(new Error(`生成字段 ${field.name} 为只读投影，不能写入源文件。`), { code: "GENERATED_FIELD_INJECTION", status: 400, field: field.name });
    }
  }
}
export async function assertNoGeneratedTextInjection(context, sourcePath, text) {
  const state = await resolveProjectCapabilityState({ id: context.projectId, root: context.projectRoot, dataSources: context.dataSources, filePolicy: context.filePolicy }, context.capabilityRegistryOptions);
  if (state.status === "generic_absent") return;
  if (state.status !== "active") throw Object.assign(new Error("项目能力声明不可用于安全写入。"), { code: "GENERATED_FIELD_CAPABILITY_UNAVAILABLE", status: 409, details: state.error ?? null });
  const target = scope(context, sourcePath, null);
  if (!findCapabilityBindings(state, { engine: "generated-fields-v1", ...target }).length) return;
  const root = path.extname(sourcePath).toLowerCase() === ".csv" ? parseCsv(text) : JSON.parse(text);
  assertNoGeneratedFieldInjection({ context, state, sourcePath, root });
}

export async function readGeneratedFields({ project, context, state, sourcePath, collection }) {
  const target = scope(context, sourcePath, collection);
  const bindings = findCapabilityBindings({ ...state, status: "active" }, { engine: "generated-fields-v1", ...target });
  const response = { projectId: project.id, sourcePath: normalizeDataFileVirtualPath(context, sourcePath), collectionPath: collection, generation: state.generation, fields: [], bindings: [], documentEtag: null };
  for (const binding of bindings) {
    const identity = state.bindings.identityPolicies.find((policy) => policy.id === binding.identityPolicyId);
    const output = { bindingId: binding.id, identityField: identity?.provider.field, fields: binding.fields, state: "unavailable", reason: "生成结果不可用", rows: [], artifactDigest: null };
    response.fields.push(...binding.fields); response.bindings.push(output);
    try {
      if (state.status !== "active") fail("项目能力声明不可用");
      if (!identity?.provider.field) fail("稳定身份策略不可用");
      const projectRoot = await realpath(project.root);
      const targetFile = await realpath(resolveDataFilePath(context, sourcePath));
      if (!inside(projectRoot, targetFile)) fail("目标数据源位于项目根外");
      const targetBytes = await readFile(targetFile); const documentHash = hash(targetBytes);
      response.documentEtag = `"${documentHash}"`;
      const rows = getRows(buildDocumentModel(JSON.parse(targetBytes.toString("utf8")), "json"), collection);
      const ids = rows.map((row) => row[identity.provider.field]);
      if (ids.some((id) => typeof id !== "string" || !id) || new Set(ids).size !== ids.length) fail("稳定身份缺失或重复");
      const businessFields = identity.protectedIdentityFields.filter((field) => field !== identity.provider.field);
      for (const field of businessFields) { const values = rows.map((row) => row[field]); if (values.some((value) => value == null || value === "") || new Set(values).size !== values.length) fail("业务身份缺失或重复"); }
      if (rows.some((row) => binding.fields.some((field) => Object.hasOwn(row, field.name)))) fail("生成字段与源字段冲突");
      const artifactFile = await safeFile(projectRoot, binding.resource);
      const artifactBytes = await readFile(artifactFile); const artifact = JSON.parse(artifactBytes.toString("utf8"));
      output.artifactDigest = hash(artifactBytes);
      if (artifact.formatVersion !== 1 || artifact.bindingId !== binding.id || await realpath(artifact.projectRoot) !== projectRoot || !artifact.target || Object.keys(artifact.target).length !== 4 || Object.entries({ ...target, identityField: identity.provider.field }).some(([key, value]) => artifact.target[key] !== value)) fail("生成结果目标或版本失配");
      const dependencies = artifact.dependencies;
      if (!Array.isArray(dependencies) || !dependencies.length || dependencies.length > 512) fail("依赖集合无效");
      const seen = new Set(); const realSeen = new Set(); const snapshots = [];
      for (const dependency of dependencies) {
        const relative = relativeFile(dependency.path);
        if (seen.has(relative) || !/^[a-f0-9]{64}$/.test(dependency.sha256)) fail("依赖摘要无效或重复");
        seen.add(relative); const file = await safeFile(projectRoot, relative);
        if (realSeen.has(file)) fail("依赖真实路径重复"); realSeen.add(file); const digest = hash(await readFile(file));
        if (digest !== dependency.sha256) fail("生成结果已过期");
        snapshots.push({ file, digest, relative });
      }
      if (!snapshots.some((item) => item.file === targetFile && item.digest === documentHash)) fail("依赖未包含目标文档");
      if (!Array.isArray(artifact.rows) || artifact.rows.length !== ids.length) fail("生成结果记录集合失配");
      const remaining = new Set(ids); const names = binding.fields.map((field) => field.name);
      for (const row of artifact.rows) {
        if (!remaining.delete(row.id)) fail("生成结果身份重复或失配");
        if (row.state === "ready") {
          if (!row.values || Object.keys(row.values).length !== names.length || names.some((name) => typeof row.values[name] !== "boolean")) fail("生成结果必须提供严格布尔值");
        } else if (row.state !== "unavailable" || Object.hasOwn(row, "values") || typeof row.reason !== "string" || !row.reason) fail("生成结果状态无效");
      }
      for (const snapshot of snapshots) if (await safeFile(projectRoot, snapshot.relative) !== snapshot.file || hash(await readFile(snapshot.file)) !== snapshot.digest) fail("读取期间依赖发生变化");
      if (await realpath(resolveDataFilePath(context, sourcePath)) !== targetFile || await safeFile(projectRoot, binding.resource) !== artifactFile || hash(await readFile(artifactFile)) !== output.artifactDigest) fail("读取期间生成结果发生变化");
      output.state = "ready"; output.reason = null; output.rows = artifact.rows;
    } catch (error) { output.reason = error.code === "ENOENT" ? "生成结果或依赖尚不存在" : error.message; }
  }
  if (new Set(response.fields.map((field) => field.name)).size !== response.fields.length) { for (const output of response.bindings) { output.state = "unavailable"; output.reason = "生成字段声明冲突"; output.rows = []; } }
  return response;
}
