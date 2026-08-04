import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { capabilityLkgPath, createProjectCapabilityRegistry, findCapabilityBinding, loadCapabilityLkg } from "../src/project-capability-registry.mjs";

async function fixture(t, id) {
  const root = await mkdtemp(path.join(os.tmpdir(), "data-editor-capability-registry-"));
  const home = await mkdtemp(path.join(os.tmpdir(), "data-editor-capability-home-"));
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(home, { recursive: true, force: true })]));
  await mkdir(path.join(root, ".data-editor"), { recursive: true });
  await writeFile(path.join(root, ".data-editor", "enrollment.json"), JSON.stringify({ version: 1, requires: { capabilityApi: 1 } }));
  await writeFile(path.join(root, ".data-editor", "project.json"), JSON.stringify({ version: 1, requires: { capabilityApi: 1 }, capabilities: { nestedSchemas: [], documentContracts: [], identityPolicies: [] } }));
  return { home, project: { id, root, dataSources: [{ id: "data", label: "Data", path: "data", kind: "relative" }], filePolicy: { includeExtensions: [".json"] } } };
}

test("registry isolates active generations by registry project id", async (t) => {
  const first = await fixture(t, "first");
  const second = await fixture(t, "second");
  const registry = createProjectCapabilityRegistry({ home: first.home });
  const a = await registry.resolve(first.project);
  const b = await registry.resolve({ ...second.project, root: second.project.root });
  assert.equal(a.status, "active");
  assert.equal(b.status, "active");
  assert.equal(registry.get("first").projectId, "first");
  assert.equal(registry.get("second").projectId, "second");
  assert.notEqual(capabilityLkgPath("first", { home: first.home }), capabilityLkgPath("second", { home: first.home }));
});

test("manifest changes advance generation and a missing enrolled manifest degrades from LKG", async (t) => {
  const { home, project } = await fixture(t, "project-a");
  const registry = createProjectCapabilityRegistry({ home });
  const first = await registry.resolve(project);
  const manifestPath = path.join(project.root, ".data-editor", "project.json");
  await writeFile(manifestPath, JSON.stringify({ version: 1, requires: { capabilityApi: 1 }, capabilities: { nestedSchemas: [], documentContracts: [], identityPolicies: [{ id: "identity", engine: "identity-policy-v1", match: { dataSourceId: "data", path: "items.json", collection: "$" }, provider: { kind: "embedded-v1", field: "__entry_id" } }] } }));
  const second = await registry.resolve(project);
  assert.equal(second.generation, first.generation + 1);
  await unlink(manifestPath);
  const degraded = await registry.resolve(project);
  assert.equal(degraded.status, "binding_degraded");
  assert.equal((await loadCapabilityLkg("project-a", { home })).status, "present");
});

test("binding matching requires the exact project-scoped virtual file identity", async (t) => {
  const { home, project } = await fixture(t, "project-a");
  const manifestPath = path.join(project.root, ".data-editor", "project.json");
  await mkdir(path.join(project.root, "data", "contracts"), { recursive: true });
  await writeFile(path.join(project.root, "data", "contracts", "skills.json"), "{}");
  await writeFile(path.join(project.root, "data", "contracts", "skills.schema.json"), "{}");
  await writeFile(manifestPath, JSON.stringify({ version: 1, requires: { capabilityApi: 1 }, capabilities: { nestedSchemas: [], documentContracts: [{ id: "contract", engine: "document-contract-v1", match: { dataSourceId: "data", path: "content/skills.json", collection: "skills" }, contract: "data/contracts/skills.json", contractSchema: "data/contracts/skills.schema.json" }], identityPolicies: [] } }));
  const registry = createProjectCapabilityRegistry({ home });
  const state = await registry.resolve(project);
  assert.equal(findCapabilityBinding(state, { engine: "document-contract-v1", dataSourceId: "data", path: "content/skills.json", collection: "skills" }).id, "contract");
  assert.equal(findCapabilityBinding(state, { engine: "document-contract-v1", dataSourceId: "data", path: "content/other.json", collection: "skills" }), null);
  assert.equal(registry.match("project-a", { engine: "document-contract-v1", dataSourceId: "data", path: "content/skills.json", collection: "$" }), null);
});

test("declared resource damage is contract_invalid instead of a generic fallback", async (t) => {
  const { home, project } = await fixture(t, "project-a");
  const manifestPath = path.join(project.root, ".data-editor", "project.json");
  await writeFile(manifestPath, JSON.stringify({ version: 1, requires: { capabilityApi: 1 }, capabilities: { nestedSchemas: [], documentContracts: [{ id: "contract", engine: "document-contract-v1", match: { dataSourceId: "data", path: "content/skills.json", collection: "skills" }, contract: "data/contracts/missing.json", contractSchema: "data/contracts/missing.schema.json" }], identityPolicies: [] } }));
  const state = await createProjectCapabilityRegistry({ home }).resolve(project);
  assert.equal(state.status, "contract_invalid");
  assert.equal(state.error.code, "CAPABILITY_RESOURCE_MISSING");
  assert.equal(state.bindings.documentContracts[0].id, "contract");
});

test("removing enrolled declarations or corrupting LKG remains fail-closed", async (t) => {
  const { home, project } = await fixture(t, "project-a");
  const registry = createProjectCapabilityRegistry({ home });
  await registry.resolve(project);
  await unlink(path.join(project.root, ".data-editor", "enrollment.json"));
  await unlink(path.join(project.root, ".data-editor", "project.json"));
  const removed = await registry.resolve(project);
  assert.equal(removed.status, "binding_degraded");
  assert.equal(removed.error.code, "CAPABILITY_ENROLLMENT_REMOVED");

  const second = await fixture(t, "project-b");
  const corruptLkgPath = capabilityLkgPath("project-b", { home: second.home });
  await mkdir(path.dirname(corruptLkgPath), { recursive: true });
  await writeFile(corruptLkgPath, "not-json");
  const corrupt = await createProjectCapabilityRegistry({ home: second.home }).resolve(second.project);
  assert.equal(corrupt.status, "binding_degraded");
  assert.equal(corrupt.error.code, "CAPABILITY_LKG_INVALID");
});

test("root or data-source remapping advances the capability generation", async (t) => {
  const { home, project } = await fixture(t, "project-a");
  const registry = createProjectCapabilityRegistry({ home });
  const first = await registry.resolve(project);
  const remapped = await registry.resolve({ ...project, dataSources: [{ ...project.dataSources[0], path: "remapped-data" }] });
  assert.equal(remapped.status, "active");
  assert.equal(remapped.generation, first.generation + 1);
});

test("binding removal requires a digest-bound controlled transition", async (t) => {
  const { home, project } = await fixture(t, "project-a");
  const manifestPath = path.join(project.root, ".data-editor", "project.json");
  const registry = createProjectCapabilityRegistry({ home });
  await writeFile(manifestPath, JSON.stringify({ version: 1, requires: { capabilityApi: 1 }, capabilities: { nestedSchemas: [], documentContracts: [], identityPolicies: [{ id: "identity", engine: "identity-policy-v1", match: { dataSourceId: "data", path: "items.json", collection: "$" }, provider: { kind: "embedded-v1", field: "__entry_id" } }] } }));
  const first = await registry.resolve(project);
  const removal = { version: 1, requires: { capabilityApi: 1 }, capabilities: { nestedSchemas: [], documentContracts: [], identityPolicies: [] } };
  await writeFile(manifestPath, JSON.stringify(removal));
  assert.equal((await registry.resolve(project)).error.code, "CAPABILITY_BINDING_REMOVAL_UNAUTHORIZED");
  removal.transition = { id: "remove-identity", previousManifestDigest: first.manifestDigest, removedBindingIds: ["identity"] };
  await writeFile(manifestPath, JSON.stringify(removal));
  const transitioned = await registry.resolve(project);
  assert.equal(transitioned.status, "active");
  assert.equal(transitioned.generation, first.generation + 1);
});
