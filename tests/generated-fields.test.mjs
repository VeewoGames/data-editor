import { writeTextFile } from "../src/file-service.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { createProjectContext } from "../src/project-context.mjs";
import { createProjectCapabilityRegistry } from "../src/project-capability-registry.mjs";
import { assertNoGeneratedFieldInjection, readGeneratedFields } from "../src/generated-fields-service.mjs";
import { projectDerivedFields, projectViewEngineRows, generatedFieldState } from "../src/view/derived-field-projection.mjs";
import { matchesFilterRule } from "../src/view/filtering.mjs";
import { runView } from "../src/view/view-engine.mjs";
import { buildVisibleTableRenderContract } from "../src/table/table-render-contract.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "generated-fields-"));
  const home = await mkdtemp(path.join(os.tmpdir(), "generated-fields-home-"));
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(home, { recursive: true, force: true })]));
  await mkdir(path.join(root, "data")); await mkdir(path.join(root, ".data-editor"));
  const rootValue = { items: [{ stable: "a", business: "one" }, { stable: "b", business: "two" }] };
  await writeFile(path.join(root, "data", "items.json"), JSON.stringify(rootValue));
  await writeFile(path.join(root, "rule.mjs"), "export const rule = true;");
  const match = { dataSourceId: "data", path: "items.json", collection: "items" };
  const binding = { id: "calculated", engine: "generated-fields-v1", match, resource: ".data-editor/result.json", identityPolicyId: "identity", fields: [{ name: "available", type: "Boolean" }] };
  const manifest = { version: 1, requires: { capabilityApi: 1 }, capabilities: { identityPolicies: [{ id: "identity", engine: "identity-policy-v1", match, provider: { kind: "embedded-v1", field: "stable" } }], generatedFields: [binding] } };
  await writeFile(path.join(root, ".data-editor", "enrollment.json"), JSON.stringify({ version: 1, requires: { capabilityApi: 1 } }));
  await writeFile(path.join(root, ".data-editor", "project.json"), JSON.stringify(manifest));
  const project = { id: "fixture", root, dataSources: [{ id: "data", path: "data", kind: "relative" }] };
  const registry = createProjectCapabilityRegistry({ home });
  const state = await registry.resolve(project);
  const context = createProjectContext({ projectId: project.id, projectRoot: root, dataSources: project.dataSources, capabilityRegistryOptions: { home } });
  const artifact = { formatVersion: 1, bindingId: binding.id, projectRoot: await realpath(root), target: { identityField: "stable", collection: "items", path: "items.json", dataSourceId: "data" }, dependencies: await Promise.all(["data/items.json", "rule.mjs"].map(async (p) => ({ path: p, sha256: hash(await readFile(path.join(root, p))) }))), rows: [{ id: "a", state: "ready", values: { available: true } }, { id: "b", state: "unavailable", reason: "待计算" }] };
  const publish = () => writeFile(path.join(root, binding.resource), JSON.stringify(artifact));
  const read = () => readGeneratedFields({ project, context, state, sourcePath: "data/items.json", collection: "items" });
  return { root, project, context, registry, state, manifest, artifact, publish, read, rootValue };
}
test("missing/malformed artifacts do not damage registry or ordinary save guard; arbitrary source keys remain raw", async (t) => {
  const f = await fixture(t); assert.equal(f.state.status, "active");
  const missing = await f.read(); assert.deepEqual(missing.fields, [{ name: "available", type: "Boolean" }]); assert.equal(missing.bindings[0].state, "unavailable");
  await writeFile(path.join(f.root, ".data-editor/result.json"), "{");
  assert.equal((await f.registry.resolve(f.project)).status, "active");
  assertNoGeneratedFieldInjection({ ...f, sourcePath: "data/items.json", root: f.rootValue });
  assert.throws(() => assertNoGeneratedFieldInjection({ ...f, sourcePath: "data/items.json", root: { items: [{ available: false }] } }), { code: "GENERATED_FIELD_INJECTION" });
  assertNoGeneratedFieldInjection({ ...f, sourcePath: "data/items.json", root: { other: [{ available: false }] } });
  await assert.rejects(writeTextFile(f.context, "data/items.json", JSON.stringify({ items: [{ available: false }] })), { code: "GENERATED_FIELD_INJECTION" });
  await writeTextFile(f.context, "data/items.json", JSON.stringify(f.rootValue));
});
test("reader accepts target property order, exact identity and byte digests, and projection never enters canonical rows", async (t) => {
  const f = await fixture(t); await f.publish(); const result = await f.read(); assert.equal(result.bindings[0].state, "ready");
  const before = JSON.stringify(f.rootValue); const projected = projectDerivedFields(f.rootValue.items[0], { generated: result });
  assert.equal(projected.available, true); assert.equal(JSON.stringify(f.rootValue), before); assert.equal(generatedFieldState(projected, "available").ready, true);
  const unknown = projectDerivedFields(f.rootValue.items[1], { generated: result });
  for (const value of [true, false]) for (const operator of ["is", "is_not"]) assert.equal(matchesFilterRule(unknown, { field: "available", operator, value }), false);
  assert.equal(matchesFilterRule({ ordinary: null }, { field: "ordinary", operator: "is", value: false }), true);
  assert.equal(projectDerivedFields(f.rootValue.items[0], { generated: result, dirty: true }).available, null);
  const view = runView({ rows: [{ rowId: "a", sourceOrder: 0, row: f.rootValue.items[0] }, { rowId: "b", sourceOrder: 1, row: f.rootValue.items[1] }], filters: { rules: [{ field: "available", operator: "is_not", value: false }] }, derivedFieldProjection: { generated: result } });
  assert.deepEqual(view.visibleRowIds, ["a"]);
  const contract = buildVisibleTableRenderContract({ rowViews: [{ rowId: "a", sourceIndex: 0, row: projected }], windowStart: 0 });
  assert.equal(generatedFieldState(contract.rows[0], "available").ready, true);
});
test("reader rejects stale/duplicate/partial/injected/nonboolean results and lexical aliases", async (t) => {
  const f = await fixture(t); const original = structuredClone(f.artifact);
  const bad = [
    (a) => a.dependencies[0].sha256 = "0".repeat(64),
    (a) => a.dependencies.push({ ...a.dependencies[0] }),
    (a) => a.dependencies[0].path = "data/./items.json",
    (a) => a.dependencies[0].path = "../items.json",
    (a) => a.rows.pop(),
    (a) => a.rows[1].id = "a",
    (a) => a.rows[0].values.available = "false",
    (a) => a.rows[0].values.extra = false,
    (a) => a.rows[1].values = {},
    (a) => a.target.identityField = "business",
  ];
  for (const mutation of bad) { Object.assign(f.artifact, structuredClone(original)); mutation(f.artifact); await f.publish(); assert.equal((await f.read()).bindings[0].state, "unavailable", mutation.toString()); }
});
test("manifest rejects unsupported generated types, missing identities and duplicate fields", async (t) => {
  const f = await fixture(t);
  for (const mutate of [(m) => m.capabilities.generatedFields[0].fields[0].type = "Number", (m) => m.capabilities.generatedFields[0].identityPolicyId = "missing", (m) => m.capabilities.generatedFields[0].fields.push({ name: "available", type: "Boolean" })]) {
    const m = structuredClone(f.manifest); mutate(m); await writeFile(path.join(f.root, ".data-editor/project.json"), JSON.stringify(m)); assert.notEqual((await f.registry.resolve(f.project)).status, "active");
  }
});
test("real-path duplicate dependencies and outside symlinks are unavailable", async (t) => {
  const f = await fixture(t); const outside = await mkdtemp(path.join(os.tmpdir(), "generated-external-")); t.after(() => rm(outside, { recursive: true, force: true }));
  await symlink(path.join(f.root, "data"), path.join(f.root, "alias"), "junction");
  f.artifact.dependencies.push({ path: "alias/items.json", sha256: f.artifact.dependencies[0].sha256 }); await f.publish(); assert.equal((await f.read()).bindings[0].state, "unavailable");
  await writeFile(path.join(outside, "rules.json"), "{}"); await symlink(outside, path.join(f.root, "outside"), "junction");
  f.artifact.dependencies.pop(); f.artifact.dependencies.push({ path: "outside/rules.json", sha256: hash("{}") }); await f.publish(); assert.match((await f.read()).bindings[0].reason, /边界/);
});
import { spawn } from "node:child_process";
import net from "node:net";
import { once } from "node:events";

test("isolated HTTP reader and save reject injection while raw saves survive bad artifacts", async (t) => {
  const f = await fixture(t); await f.publish();
  const listener = net.createServer(); listener.listen(0, "127.0.0.1"); await once(listener, "listening"); const port = listener.address().port; await new Promise((resolve) => listener.close(resolve));
  assert.notEqual(port, 8787); assert.notEqual(port, 8791);
  const registryHome = path.join(f.root, "isolated-registry");
  const child = spawn(process.execPath, ["server.mjs", "--project", f.root, "--port", String(port), "--registry-home", registryHome], { cwd: path.resolve(import.meta.dirname, ".."), windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, DATA_EDITOR_HOME: registryHome } });
  const childPid = child.pid; let output = ""; child.stdout.on("data", (chunk) => output += chunk); child.stderr.on("data", (chunk) => output += chunk);
  const exited = once(child, "exit");
  try {
    const base = `http://127.0.0.1:${port}`;
    let registry;
    for (let attempt = 0; attempt < 100; attempt++) { try { const r = await fetch(`${base}/api/projects`); if (r.ok) { registry = await r.json(); break; } } catch {} await new Promise((resolve) => setTimeout(resolve, 50)); }
    assert.ok(registry, output); const projectId = registry.activeProjectId;
    const query = new URLSearchParams({ projectId, path: "data/items.json", collection: "items" });
    const readResponse = await fetch(`${base}/api/generated-fields?${query}`); assert.equal(readResponse.status, 200); const values = await readResponse.json(); assert.equal(values.bindings[0].state, "ready");
    const doc = await (await fetch(`${base}/api/document?${new URLSearchParams({projectId, path: "data/items.json"})}`)).json(); assert.equal(Object.hasOwn(doc.root.items[0], "available"), false);
    const injected = structuredClone(doc.root); injected.items[0].available = true;
    const denied = await fetch(`${base}/api/save`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId, path: "data/items.json", root: injected, documentEtag: doc.documentEtag }) }); assert.equal(denied.status, 400); assert.equal((await denied.json()).code, "GENERATED_FIELD_INJECTION");
    await writeFile(path.join(f.root, ".data-editor/result.json"), "{");
    const bad = await (await fetch(`${base}/api/generated-fields?${query}`)).json(); assert.equal(bad.bindings[0].state, "unavailable");
    doc.root.items[0].business = "updated";
    const saved = await fetch(`${base}/api/save`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId, path: "data/items.json", root: doc.root, documentEtag: doc.documentEtag }) }); assert.equal(saved.status, 200, await saved.text());
    assert.equal(Object.hasOwn(JSON.parse(await readFile(path.join(f.root, "data/items.json"), "utf8")).items[0], "available"), false);
    t.diagnostic(`isolated HTTP PID=${childPid} port=${port}; project=${f.root}; registry=${registryHome}`);
  } finally {
    // Only this owned ChildProcess is stopped; no PID discovery or shared service changes.
    if (child.exitCode == null && child.pid === childPid) child.kill();
    await exited;
    assert.throws(() => process.kill(childPid, 0));
    t.diagnostic(`owned child PID=${childPid} exited; fixture cleanup registered for exact temporary roots`);
  }
});
test("registered external data sources and missing/duplicate stable identities are unavailable", async (t) => {
  const f = await fixture(t); await f.publish();
  const outside = await mkdtemp(path.join(os.tmpdir(), "generated-source-external-")); t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(path.join(outside, "items.json"), JSON.stringify(f.rootValue));
  const externalContext = createProjectContext({ projectId: f.project.id, projectRoot: f.root, dataSources: [{ id: "data", kind: "absolute", path: outside }] });
  const external = await readGeneratedFields({ ...f, context: externalContext, sourcePath: "data/items.json", collection: "items" });
  assert.match(external.bindings[0].reason, /项目根外/);
  for (const stable of [undefined, "a"]) {
    const root = structuredClone(f.rootValue); root.items[1].stable = stable;
    await writeFile(path.join(f.root, "data/items.json"), JSON.stringify(root));
    assert.match((await f.read()).bindings[0].reason, /稳定身份/);
  }
});
test("colliding source fields retain canonical value but have no confirmed generated projection", async (t) => {
  const f = await fixture(t); await f.publish(); const result = await f.read();
  const raw = { ...f.rootValue.items[0], available: false };
  const projected = projectDerivedFields(raw, { generated: result });
  assert.equal(projected.available, false); assert.equal(raw.available, false);
  assert.equal(generatedFieldState(projected, "available").ready, false);
  assert.match(generatedFieldState(projected, "available").reason, /冲突/);
  assert.equal(matchesFilterRule(projected, { field: "available", operator: "is", value: false }), false);
});
import { unlink } from "node:fs/promises";
import { submitFreshEntryActionProposal } from "../src/entry-action-service.mjs";
import { writeEntryActionStarted } from "../src/entry-actions.mjs";
import { rowDigest } from "../src/row-digest.mjs";
import { prepareCandidateCreate } from "../src/entry-action-candidate-create.mjs";
import { commitPreparedCandidateCreate } from "../src/entry-action-candidate-create-service.mjs";
import { canonicalFileIdentity } from "../src/canonical-file-identity.mjs";
import { canonicalProjectArtifactIdentity } from "../src/canonical-project-artifact-identity.mjs";
function canonical(value) { if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`; return JSON.stringify(value); }

test("central writer fails closed for malformed/missing enrolled declarations using the same LKG owner", async (t) => {
  for (const damage of ["malformed", "missing-manifest", "missing-enrollment", "missing-both"]) {
    const f = await fixture(t); const before = await readFile(path.join(f.root, "data/items.json"), "utf8");
    if (damage === "malformed") await writeFile(path.join(f.root, ".data-editor/project.json"), "{");
    if (damage === "missing-manifest" || damage === "missing-both") await unlink(path.join(f.root, ".data-editor/project.json"));
    if (damage === "missing-enrollment" || damage === "missing-both") await unlink(path.join(f.root, ".data-editor/enrollment.json"));
    await assert.rejects(writeTextFile(f.context, "data/items.json", JSON.stringify({ items: [{ stable: "a", available: true }] })), { code: "GENERATED_FIELD_CAPABILITY_UNAVAILABLE" }, damage);
    assert.equal(await readFile(path.join(f.root, "data/items.json"), "utf8"), before);
    if (damage === "missing-both") {
      const fresh = createProjectContext({ ...f.context, projectId: "never-enrolled" });
      await writeTextFile(fresh, "data/items.json", before); // no LKG, genuinely generic project
    }
  }
});
test("actual fresh and accepted project-skill proposal writers cannot bypass damaged generated declarations", async (t) => {
  for (const accepted of [false, true]) {
    const f = await fixture(t); f.rootValue.items[0].__entry_id = "01JTESTENTRY00000000000001";
    await writeFile(path.join(f.root, "data/items.json"), JSON.stringify(f.rootValue));
    const unsigned = { contractId: "fixture.patch.v1", version: 1, predicate: { all: [] }, writableFields: ["business"], legalTransitions: [], textArtifactPolicy: {}, evidencePolicy: { required: false }, resultPolicy: "proposal", createAuthority: null };
    const contract = { ...unsigned, digest: hash(canonical(unsigned)) };
    await writeFile(f.context.automationProfilePath, JSON.stringify({ rules: [{ id: "patch", enabled: true, label: "Patch", icon: "edit", targets: [{ file: "data/items.json", collection: "items" }], payload: { includeRow: true, includeNeighbors: false }, execution: { kind: "proposal", resultPolicy: "proposal" }, contractId: contract.contractId }] }));
    await writeFile(path.join(f.root, ".data-editor/entry-action-contracts.json"), JSON.stringify({ version: 1, contracts: [contract] }));
    const before = await readFile(path.join(f.root, "data/items.json"), "utf8");
    const runId = "10000000-0000-4000-8000-000000000090";
    if (accepted) await writeEntryActionStarted(f.context, runId, { version: 3, runId, actionId: "patch", phase: "proposal_ready", outcome: null, startedAt: new Date().toISOString() });
    await writeFile(path.join(f.root, ".data-editor/project.json"), "{");
    await assert.rejects(submitFreshEntryActionProposal({ projectContext: f.context, project: f.project, request: { actionId: "patch", sourcePath: "data/items.json", collectionPath: "items", rowId: f.rootValue.items[0].__entry_id, expectedRowDigest: rowDigest(f.rootValue.items[0]) }, result: { changes: [{ field: "business", beforeExists: true, before: "one", afterExists: true, after: "modified" }], summary: "Patch", evidence: [] }, dependencies: accepted ? { runId } : {} }), { code: "GENERATED_FIELD_CAPABILITY_UNAVAILABLE" });
    assert.equal(await readFile(path.join(f.root, "data/items.json"), "utf8"), before);
  }
});
test("actual candidate canonical commit rejects invalid capability before source replacement", async (t) => {
  const f = await fixture(t); await mkdir(path.join(f.root, "docs"));
  const documentText = await readFile(path.join(f.root, "data/items.json"), "utf8");
  const sourceIdentity = await canonicalFileIdentity(f.context, "data/items.json");
  const artifactIdentity = await canonicalProjectArtifactIdentity(f.context, "docs/new.md");
  const binding = { projectId: f.project.id, runId: "10000000-0000-4000-8000-000000000091", actionId: "create", sourcePath: "data/items.json", collectionPath: "items", canonicalFileKey: sourceIdentity.canonicalFileKey, baseDocumentEtag: `"${hash(documentText)}"`, ruleDigest: "b".repeat(64), fencingToken: 1, createContractId: "fixture.create.v1", createContractDigest: "c".repeat(64) };
  const contract = { contractId: binding.createContractId, digest: binding.createContractDigest, collectionKind: "array", rowSchema: { type: "object", additionalProperties: false, required: ["stable", "business", "__entry_id"], properties: { stable: { type: "string" }, business: { type: "string" }, __entry_id: { type: "string" } } }, requiredFields: ["stable", "business"], writableFields: ["stable", "business"], serverOwnedFields: [], serverDefaults: {}, uniqueKeys: [["stable"]], humanNoteFields: [], textArtifactPolicy: { required: true, maxBytes: 4096 } };
  const content = "# Candidate\n";
  const prepared = await prepareCandidateCreate({ manifest: { version: 1, kind: "candidate-create", candidateId: "candidate-new", designSubjectDigest: "d".repeat(64), row: { stable: "c", business: "three" }, textArtifact: { afterContent: content, afterDigest: hash(content) }, summary: "Create" }, binding, createContract: contract, documentText, resolveTextArtifact: async () => ({ id: "artifact_new", path: "docs/new.md", beforeExists: false, beforeDigest: null, afterContent: content, afterDigest: hash(content) }) });
  await unlink(path.join(f.root, ".data-editor/enrollment.json"));
  const lease = { canonicalFileKey: binding.canonicalFileKey, runId: binding.runId, ownerToken: "owner", ownerHash: "e".repeat(64), fencingToken: 1, jobInstanceId: "job" };
  await assert.rejects(commitPreparedCandidateCreate({ projectContext: f.context, prepared, lease, sourceIdentity, artifactIdentity, documentText, verifyOwnership: async () => {}, verifyAuthority: async () => {}, publishResultIdempotently: async () => assert.fail("invalid source must not publish") }), { code: "GENERATED_FIELD_CAPABILITY_UNAVAILABLE" });
  assert.equal(await readFile(path.join(f.root, "data/items.json"), "utf8"), documentText);
});
import { createEntryActionRunRoute } from "../src/entry-action-route.mjs";
test("project-skill route forwards the actual registry home into its canonical writer context", async (t) => {
  const f = await fixture(t); const before = await readFile(path.join(f.root, "data/items.json"), "utf8");
  await unlink(path.join(f.root, ".data-editor/project.json")); await unlink(path.join(f.root, ".data-editor/enrollment.json"));
  const route = createEntryActionRunRoute({ loadRegistry: async () => ({ projects: [f.project] }), capabilityRegistryOptions: f.context.capabilityRegistryOptions, resolveExecution: async () => ({ kind: "project-skill", resultPolicy: "proposal" }), startProjectSkill: async ({ projectContext }) => { assert.deepEqual(projectContext.capabilityRegistryOptions, f.context.capabilityRegistryOptions); await writeTextFile(projectContext, "data/items.json", JSON.stringify({ items: [{ available: true }] })); assert.fail("removed declaration must not reach accepted host result"); } });
  await assert.rejects(route.run({ projectId: f.project.id, actionId: "fixture", sourcePath: "data/items.json", collectionPath: "items" }), { code: "GENERATED_FIELD_CAPABILITY_UNAVAILABLE" });
  assert.equal(await readFile(path.join(f.root, "data/items.json"), "utf8"), before);
});
