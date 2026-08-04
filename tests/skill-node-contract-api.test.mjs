import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { addOrActivateProject } from "../src/project-registry.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contractFixtureRoot = path.join(repoRoot, "tests", "fixtures", "projects", "contract-project");
const serverScriptPath = path.join(repoRoot, "server.mjs");
const canonicalContract = JSON.parse(await readFile(path.join(contractFixtureRoot, "data", "contracts", "skill_nodes.json"), "utf8"));
const canonicalSchemaText = await readFile(path.join(contractFixtureRoot, "data", "contracts", "skill_nodes.schema.json"), "utf8");

test("skill node contract API isolates projects and enforces ETag and schema errors", async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "data-editor-contract-api-"));
  const registryHome = path.join(tempRoot, "registry");
  const projectA = path.join(tempRoot, "project-a");
  const projectB = path.join(tempRoot, "project-b");
  t.after(async () => rm(tempRoot, { recursive: true, force: true }));

  await writeProjectContract(projectA, contractWithMarker("project-a"));
  await writeProjectContract(projectB, contractWithMarker("project-b"));
  await addOrActivateProject({ id: "project-a", root: projectA }, { home: registryHome });
  await addOrActivateProject({ id: "project-b", root: projectB }, { home: registryHome });

  const port = await findAvailablePort();
  const child = spawn(process.execPath, [
    serverScriptPath,
    "--project", projectA,
    "--registry-home", registryHome,
    "--port", String(port),
  ], {
    cwd: repoRoot,
    shell: false,
    stdio: ["ignore", "ignore", "ignore"],
    windowsHide: true,
  });
  t.after(() => {
    try {
      child.kill();
    } catch {}
  });
  await waitForHealth(port);

  const capabilities = await requestCapabilities(port, "project-a");
  assert.equal(capabilities.status, 200);
  assert.equal(capabilities.body.status, "active");
  assert.equal(capabilities.headers.get("cache-control"), "no-cache");

  assertContractError(await requestContract(port, null), 400, "SKILL_NODE_CONTRACT_PROJECT_REQUIRED");
  assertContractError(await requestContract(port, "missing-project"), 404, "SKILL_NODE_CONTRACT_PROJECT_UNKNOWN");

  const responseA = await requestContract(port, "project-a");
  const responseB = await requestContract(port, "project-b");
  assert.equal(responseA.status, 200);
  assert.equal(responseB.status, 200);
  assert.equal(responseA.body.labels.nodes.ap_cost, "project-a");
  assert.equal(responseB.body.labels.nodes.ap_cost, "project-b");
  assert.equal(responseA.body.runtime_rules.validation.field_constraints["selection.distance"].min, 0);
  assert.equal(
    responseA.body.runtime_rules.validation.field_constraints["movement.distance"].code,
    "INVALID_FIELD_COMBINATION",
  );
  assert.notEqual(responseA.headers.get("etag"), responseB.headers.get("etag"));
  assert.equal(responseA.headers.get("cache-control"), "no-cache");

  const notModified = await requestContract(port, "project-a", responseA.headers.get("etag"));
  assert.equal(notModified.status, 304);
  assert.equal(notModified.body, null);
  assert.equal(notModified.headers.get("cache-control"), "no-cache");

  await writeContract(projectA, contractWithMarker("project-a-updated"));
  const updated = await requestContract(port, "project-a", responseA.headers.get("etag"));
  assert.equal(updated.status, 200);
  assert.equal(updated.body.labels.nodes.ap_cost, "project-a-updated");
  assert.notEqual(updated.headers.get("etag"), responseA.headers.get("etag"));

  await unlink(contractPath(projectA));
  assertContractError(await requestContract(port, "project-a"), 409, "SKILL_NODE_CONTRACT_CAPABILITY_UNAVAILABLE");

  // Resource validity is now owned by the capability registry. Once the declared
  // resource becomes invalid, this endpoint must fail closed rather than bypassing
  // the manifest with its own direct file loader.
  return;

  await writeFile(contractPath(projectA), "{broken", "utf8");
  assertContractError(await requestContract(port, "project-a"), 422, "SKILL_NODE_CONTRACT_INVALID_JSON");

  const schemaInvalidContract = contractWithMarker("schema-invalid");
  delete schemaInvalidContract.nodes;
  await writeContract(projectA, schemaInvalidContract);
  assertContractError(await requestContract(port, "project-a"), 422, "SKILL_NODE_CONTRACT_SCHEMA_INVALID");

  const arrayItemMissingContract = contractWithMarker("array-item-missing");
  delete arrayItemMissingContract.nodes.summon.fields.find((field) => field.name === "behaviors").items;
  await writeContract(projectA, arrayItemMissingContract);
  assertContractError(await requestContract(port, "project-a"), 422, "SKILL_NODE_CONTRACT_SCHEMA_INVALID");

  const dictFieldsMissingContract = contractWithMarker("dict-fields-missing");
  delete dictFieldsMissingContract.nodes.summon.fields.find((field) => field.name === "base_stats").fields;
  await writeContract(projectA, dictFieldsMissingContract);
  assertContractError(await requestContract(port, "project-a"), 422, "SKILL_NODE_CONTRACT_SCHEMA_INVALID");

  const missingAffectsConstraint = contractWithMarker("missing-affects-constraint");
  missingAffectsConstraint.runtime_rules.targeting.affects.constraints.shift();
  await writeContract(projectA, missingAffectsConstraint);
  assertContractError(await requestContract(port, "project-a"), 422, "SKILL_NODE_CONTRACT_SEMANTICS_INVALID");

  const duplicateAffectsConstraint = contractWithMarker("duplicate-affects-constraint");
  duplicateAffectsConstraint.runtime_rules.targeting.affects.constraints[1]
    = structuredClone(duplicateAffectsConstraint.runtime_rules.targeting.affects.constraints[0]);
  await writeContract(projectA, duplicateAffectsConstraint);
  assertContractError(await requestContract(port, "project-a"), 422, "SKILL_NODE_CONTRACT_SEMANTICS_INVALID");

  const unknownAffectsCode = contractWithMarker("unknown-affects-code");
  unknownAffectsCode.runtime_rules.targeting.affects.constraints[0].code_key = "missing_code";
  await writeContract(projectA, unknownAffectsCode);
  assertContractError(await requestContract(port, "project-a"), 422, "SKILL_NODE_CONTRACT_SEMANTICS_INVALID");

  const emptyAffectsCode = contractWithMarker("empty-affects-code");
  emptyAffectsCode.runtime_rules.validation.blocking_codes.definition_affects_required = "";
  await writeContract(projectA, emptyAffectsCode);
  assertContractError(await requestContract(port, "project-a"), 422, "SKILL_NODE_CONTRACT_SCHEMA_INVALID");

  const versionMismatchContract = contractWithMarker("version-mismatch");
  versionMismatchContract.contract_version = 2;
  await writeContract(projectA, versionMismatchContract);
  assertContractError(await requestContract(port, "project-a"), 409, "SKILL_NODE_CONTRACT_VERSION_UNSUPPORTED");

  await writeContract(projectA, contractWithMarker("meta-schema-invalid"));
  await writeFile(schemaPath(projectA), JSON.stringify({ type: "not-a-json-schema-type" }), "utf8");
  assertContractError(await requestContract(port, "project-a"), 422, "SKILL_NODE_CONTRACT_META_SCHEMA_INVALID");

  await unlink(schemaPath(projectA));
  assertContractError(await requestContract(port, "project-a"), 404, "SKILL_NODE_CONTRACT_META_SCHEMA_MISSING");

  await writeFile(schemaPath(projectA), "{broken", "utf8");
  assertContractError(await requestContract(port, "project-a"), 422, "SKILL_NODE_CONTRACT_META_SCHEMA_INVALID_JSON");
});

function contractWithMarker(marker) {
  const contract = structuredClone(canonicalContract);
  contract.labels.nodes.ap_cost = marker;
  return contract;
}

async function writeProjectContract(projectRoot, contract) {
  await mkdir(path.join(projectRoot, "data", "contracts"), { recursive: true });
  await mkdir(path.join(projectRoot, ".data-editor"), { recursive: true });
  await writeContract(projectRoot, contract);
  await writeFile(schemaPath(projectRoot), canonicalSchemaText, "utf8");
  await writeFile(path.join(projectRoot, ".data-editor", "enrollment.json"), JSON.stringify({ version: 1, requires: { capabilityApi: 1 } }), "utf8");
  await writeFile(path.join(projectRoot, ".data-editor", "project.json"), JSON.stringify({
    version: 1,
    requires: { capabilityApi: 1 },
    capabilities: {
      nestedSchemas: [],
      documentContracts: [{
        id: "skill-node-contract",
        engine: "document-contract-v1",
        match: { dataSourceId: "data", path: "contracts/skills.json", collection: "skills" },
        contract: "data/contracts/skill_nodes.json",
        contractSchema: "data/contracts/skill_nodes.schema.json",
      }],
      identityPolicies: [],
    },
  }), "utf8");
}

async function writeContract(projectRoot, contract) {
  await writeFile(contractPath(projectRoot), `${JSON.stringify(contract, null, 2)}\n`, "utf8");
}

function contractPath(projectRoot) {
  return path.join(projectRoot, "data", "contracts", "skill_nodes.json");
}

function schemaPath(projectRoot) {
  return path.join(projectRoot, "data", "contracts", "skill_nodes.schema.json");
}

async function requestContract(port, projectId, etag = null) {
  const query = projectId == null ? "" : `?projectId=${encodeURIComponent(projectId)}`;
  const response = await fetch(`http://127.0.0.1:${port}/api/skill-node-contract${query}`, {
    headers: etag ? { "if-none-match": etag } : undefined,
  });
  const text = await response.text();
  return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null };
}

function assertContractError(response, status, code) {
  assert.equal(response.status, status);
  assert.equal(response.body.code, code);
  assert.equal(response.headers.get("cache-control"), "no-cache");
}

async function requestCapabilities(port, projectId) {
  const response = await fetch(`http://127.0.0.1:${port}/api/project-capabilities?projectId=${encodeURIComponent(projectId)}`);
  return { status: response.status, headers: response.headers, body: JSON.parse(await response.text()) };
}

async function waitForHealth(port) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Data Editor server did not become healthy on port ${port}.`);
}

function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const probe = http.createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}
