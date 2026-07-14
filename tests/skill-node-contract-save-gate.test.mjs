import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { addOrActivateProject } from "../src/project-registry.mjs";
import { assertSkillNodeContractUnchanged } from "../server.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nocturnelRoot = process.env.NOCTURNEL_ROOT
  ? path.resolve(process.env.NOCTURNEL_ROOT)
  : path.basename(path.dirname(repoRoot)) === "tools"
    ? path.resolve(repoRoot, "..", "..")
    : path.resolve(repoRoot, "..", "Nocturnel");
const serverScriptPath = path.join(repoRoot, "server.mjs");
const canonicalContract = JSON.parse(await readFile(path.join(nocturnelRoot, "data", "contracts", "skill_nodes.json"), "utf8"));
const canonicalSchemaText = await readFile(path.join(nocturnelRoot, "data", "contracts", "skill_nodes.schema.json"), "utf8");

test("skill save gate blocks invalid contract state and leaves non-skill saves untouched", async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "data-editor-save-gate-"));
  const registryHome = path.join(tempRoot, "registry");
  const projectA = path.join(tempRoot, "project-a");
  const projectB = path.join(tempRoot, "project-b");
  t.after(async () => rm(tempRoot, { recursive: true, force: true }));

  await writeProject(projectA, "project-a");
  await writeProject(projectB, "project-b");
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
    try { child.kill(); } catch {}
  });
  await waitForHealth(port);

  const contractResponse = await fetch(`http://127.0.0.1:${port}/api/skill-node-contract?projectId=project-a`);
  const etag = contractResponse.headers.get("etag");
  assert.ok(etag);
  const validRoot = { skill_node_contract_version: 1, skills: [{ skill_id: "accepted" }] };
  const validGate = gate("project-a", 1, etag);

  assert.equal((await save(port, "project-a", skillPath(), validRoot, validGate)).status, 200);
  assert.deepEqual(JSON.parse(await readFile(path.join(projectA, skillPath()), "utf8")), validRoot);

  assertSaveError(
    await save(port, "project-a", skillPath(), validRoot, { contractVersion: 1, saveToken: validGate.saveToken }),
    400,
    "SKILL_NODE_CONTRACT_SAVE_ETAG_MISSING",
    "contractEtag",
  );
  assertSaveError(
    await save(port, "project-a", skillPath(), validRoot, {
      contractVersion: 1,
      contractEtag: etag,
    }),
    400,
    "SKILL_NODE_CONTRACT_SAVE_TOKEN_MISSING",
    "saveToken",
  );
  assertSaveError(
    await save(port, "project-a", skillPath(), validRoot, {
      ...validGate,
      saveToken: { ...validGate.saveToken, etag: '"other"' },
    }),
    409,
    "SKILL_NODE_CONTRACT_SAVE_TOKEN_ETAG_MISMATCH",
    "saveToken.etag",
  );
  assertSaveError(
    await save(port, "project-a", skillPath(), validRoot, {
      ...validGate,
      saveToken: { ...validGate.saveToken, projectId: "project-b" },
    }),
    409,
    "SKILL_NODE_CONTRACT_SAVE_TOKEN_PROJECT_MISMATCH",
    "saveToken.projectId",
  );
  assertSaveError(
    await save(port, "project-a", skillPath(), { skills: [] }, validGate),
    409,
    "SKILL_NODE_CONTRACT_ROOT_VERSION_MISSING",
    "root.skill_node_contract_version",
  );
  assertSaveError(
    await save(
      port,
      "project-a",
      skillPath(),
      { skill_node_contract_version: 2, skills: [] },
      gate("project-a", 2, etag),
    ),
    409,
    "SKILL_NODE_CONTRACT_SAVE_VERSION_MISMATCH",
    "contractVersion",
  );

  await writeContract(projectA, contractWithMarker("changed"));
  assertSaveError(
    await save(port, "project-a", skillPath(), validRoot, validGate),
    409,
    "SKILL_NODE_CONTRACT_SAVE_ETAG_STALE",
    "contractEtag",
  );
  assert.deepEqual(JSON.parse(await readFile(path.join(projectA, skillPath()), "utf8")), validRoot);

  const changedResponse = await fetch(`http://127.0.0.1:${port}/api/skill-node-contract?projectId=project-a`);
  const changedEtag = changedResponse.headers.get("etag");
  const changedGate = gate("project-a", 1, changedEtag);
  await unlink(contractPath(projectA));
  assertSaveError(
    await save(port, "project-a", skillPath(), validRoot, changedGate),
    404,
    "SKILL_NODE_CONTRACT_MISSING",
    "contract",
  );

  await writeFile(contractPath(projectA), "{broken", "utf8");
  assertSaveError(
    await save(port, "project-a", skillPath(), validRoot, changedGate),
    422,
    "SKILL_NODE_CONTRACT_INVALID_JSON",
    "contract",
  );

  const unsupported = contractWithMarker("unsupported");
  unsupported.contract_version = 2;
  await writeContract(projectA, unsupported);
  assertSaveError(
    await save(port, "project-a", skillPath(), { skill_node_contract_version: 2, skills: [] }, gate("project-a", 2, '"v2"')),
    409,
    "SKILL_NODE_CONTRACT_VERSION_UNSUPPORTED",
    "contract",
  );

  const nonSkillRoot = { traits: [{ id: "not-blocked" }] };
  const nonSkill = await save(port, "project-a", "data/content/traits.json", nonSkillRoot, {});
  assert.equal(nonSkill.status, 200);
  assert.deepEqual(JSON.parse(await readFile(path.join(projectA, "data/content/traits.json"), "utf8")), nonSkillRoot);
});

test("second save-gate check detects a contract changed after initial validation", async (t) => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "data-editor-save-race-"));
  t.after(async () => rm(projectRoot, { recursive: true, force: true }));
  await writeProject(projectRoot, "before");
  const first = await fetchContractEtag(projectRoot);
  await writeContract(projectRoot, contractWithMarker("after"));

  await assert.rejects(
    () => assertSkillNodeContractUnchanged({ projectRoot }, first),
    (error) => error.code === "SKILL_NODE_CONTRACT_CHANGED_DURING_SAVE"
      && error.field === "contractEtag",
  );
});

function skillPath() {
  return "data/content/skills.json";
}

function gate(projectId, contractVersion, contractEtag) {
  return {
    contractVersion,
    contractEtag,
    saveToken: { projectId, contractVersion, etag: contractEtag },
  };
}

async function writeProject(projectRoot, marker) {
  await mkdir(path.join(projectRoot, "data", "contracts"), { recursive: true });
  await mkdir(path.join(projectRoot, "data", "content"), { recursive: true });
  await writeContract(projectRoot, contractWithMarker(marker));
  await writeFile(schemaPath(projectRoot), canonicalSchemaText, "utf8");
  await writeFile(path.join(projectRoot, skillPath()), JSON.stringify({ skill_node_contract_version: 1, skills: [] }), "utf8");
  await writeFile(path.join(projectRoot, "data/content/traits.json"), JSON.stringify({ traits: [] }), "utf8");
}

function contractWithMarker(marker) {
  const contract = structuredClone(canonicalContract);
  contract.labels.nodes.ap_cost = marker;
  return contract;
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

async function fetchContractEtag(projectRoot) {
  const bytes = await readFile(contractPath(projectRoot));
  const { createHash } = await import("node:crypto");
  return `"${createHash("sha256").update(bytes).digest("hex")}"`;
}

async function save(port, projectId, documentPath, root, contractGate) {
  const response = await fetch(`http://127.0.0.1:${port}/api/save`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId, path: documentPath, root, ...contractGate }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

function assertSaveError(response, status, code, field) {
  assert.equal(response.status, status);
  assert.equal(response.body.code, code);
  assert.equal(response.body.field, field);
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
