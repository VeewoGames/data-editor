import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { loadProjectCapabilityManifest } from "../src/project-capability-manifest.mjs";

async function makeProject(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "data-editor-capability-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function context(root, projectId = "project-a") {
  return { projectRoot: root, projectId, dataSources: [{ id: "content", label: "Content", path: "data", kind: "relative" }] };
}

function manifest() {
  return {
    version: 1,
    requires: { capabilityApi: 1 },
    capabilities: {
      nestedSchemas: [{ id: "nested", engine: "nested-schema-v1", match: { dataSourceId: "content", path: "content/skills.json", collection: "skills" }, manifest: ".data-editor/contracts/nested.json" }],
      documentContracts: [{ id: "contract", engine: "document-contract-v1", match: { dataSourceId: "content", path: "content/skills.json", collection: "skills" }, contract: "data/contracts/skills.json", contractSchema: "data/contracts/skills.schema.json" }],
      identityPolicies: [{ id: "identity", engine: "identity-policy-v1", match: { dataSourceId: "content", path: "content/skills.json", collection: "skills" }, provider: { kind: "embedded-v1", field: "__entry_id" } }],
    },
  };
}

test("un-enrolled project is generic absent without creating files", async (t) => {
  const root = await makeProject(t);
  const loaded = await loadProjectCapabilityManifest(context(root));
  assert.equal(loaded.status, "generic_absent");
  assert.equal(loaded.projectId, "project-a");
});

test("enrolled manifest compiles only declared built-in engines and has a stable digest", async (t) => {
  const root = await makeProject(t);
  await mkdir(path.join(root, ".data-editor"), { recursive: true });
  await writeFile(path.join(root, ".data-editor", "enrollment.json"), JSON.stringify({ version: 1, requires: { capabilityApi: 1 } }));
  await writeFile(path.join(root, ".data-editor", "project.json"), JSON.stringify(manifest()));
  const first = await loadProjectCapabilityManifest(context(root));
  const second = await loadProjectCapabilityManifest(context(root));
  assert.equal(first.status, "active");
  assert.equal(first.manifest.capabilities.documentContracts[0].engine, "document-contract-v1");
  assert.equal(first.manifestDigest, second.manifestDigest);
});

test("enrollment and manifest failures are explicit and fail closed", async (t) => {
  const root = await makeProject(t);
  await mkdir(path.join(root, ".data-editor"), { recursive: true });
  await writeFile(path.join(root, ".data-editor", "enrollment.json"), JSON.stringify({ version: 1, requires: { capabilityApi: 1 } }));
  const missing = await loadProjectCapabilityManifest(context(root));
  assert.equal(missing.status, "manifest_invalid");
  assert.equal(missing.error.code, "CAPABILITY_MANIFEST_MISSING");

  const invalid = manifest();
  invalid.capabilities.documentContracts[0].contract = "../outside.json";
  await writeFile(path.join(root, ".data-editor", "project.json"), JSON.stringify(invalid));
  const outside = await loadProjectCapabilityManifest(context(root));
  assert.equal(outside.status, "manifest_invalid");
  assert.equal(outside.error.code, "CAPABILITY_RESOURCE_OUTSIDE_ROOT");
});
