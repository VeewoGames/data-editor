import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { assertRegistryQuiescent, migrateRegistryV2 } from "../scripts/registry-migrate-v2.mjs";
import { loadProjectRegistry, projectRegistryPath } from "../src/project-registry.mjs";

async function makeHome(t) {
  const home = await mkdtemp(path.join(os.tmpdir(), "data-editor-registry-v2-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  return home;
}

function v1Registry(root) {
  return {
    version: 1,
    activeProjectId: "project",
    projects: [{
      id: "project",
      name: "Project",
      root,
      adapter: "nocturnel",
      adapterId: "nocturnel",
      entryActions: [{ id: "legacy" }],
      dataSources: [{ id: "data", label: "Data", path: "data", kind: "relative" }],
      filePolicy: { includeExtensions: [".json"] },
    }],
  };
}

test("registry v2 migration is explicit, preserves a raw v1 backup, and is repeatable", async (t) => {
  const home = await makeHome(t);
  const root = path.join(home, "project");
  await mkdir(root, { recursive: true });
  const target = projectRegistryPath({ home });
  const rawV1 = Buffer.from(`\ufeff${JSON.stringify(v1Registry(root), null, 2)}\n`, "utf8");
  await writeFile(target, rawV1);

  await assert.rejects(() => loadProjectRegistry({ home }), (error) => error?.code === "PROJECT_REGISTRY_MIGRATION_REQUIRED");
  const migrated = await migrateRegistryV2(target);
  assert.equal(migrated.status, "migrated");
  assert.equal(await readFile(migrated.backup, "utf8"), rawV1.toString("utf8"));
  const registry = await loadProjectRegistry({ home });
  assert.equal(registry.version, 2);
  assert.equal("adapter" in registry.projects[0], false);
  assert.equal("entryActions" in registry.projects[0], false);
  assert.equal((await migrateRegistryV2(target)).status, "already_v2");
});

test("registry v2 migration does not create a registry when no v1 source exists", async (t) => {
  const home = await makeHome(t);
  const target = projectRegistryPath({ home });
  const result = await migrateRegistryV2(target);
  assert.equal(result.status, "not_applicable");
  await assert.rejects(() => readFile(target), { code: "ENOENT" });
});

test("registry v2 migration refuses an existing migration lock without replacing source bytes", async (t) => {
  const home = await makeHome(t);
  const root = path.join(home, "project");
  await mkdir(root, { recursive: true });
  const target = projectRegistryPath({ home });
  const rawV1 = `${JSON.stringify(v1Registry(root), null, 2)}\n`;
  await writeFile(target, rawV1);
  await writeFile(`${target}.migrate-v2.lock`, "interrupted migration\n");

  await assert.rejects(() => migrateRegistryV2(target), { code: "EEXIST" });
  assert.equal(await readFile(target, "utf8"), rawV1);
});

test("registry v2 migration blocks cutover when the registry runtime still has a state owner", async (t) => {
  const home = await makeHome(t);
  const runtime = path.join(home, "runtime");
  await mkdir(runtime, { recursive: true });
  await writeFile(path.join(runtime, "service.json"), "{\"pid\":123}\n");
  await assert.rejects(
    () => assertRegistryQuiescent(projectRegistryPath({ home }), { listNodeProcesses: async () => [] }),
    (error) => error?.code === "PROJECT_REGISTRY_MIGRATION_NOT_QUIESCENT" && error.residualStates.length === 1,
  );
});

test("registry v2 migration blocks a server process using the same registry home", async (t) => {
  const home = await makeHome(t);
  await assert.rejects(
    () => assertRegistryQuiescent(projectRegistryPath({ home }), {
      listNodeProcesses: async () => [{ pid: 42, commandLine: `node server.mjs --registry-home \"${home}\"` }],
    }),
    (error) => error?.code === "PROJECT_REGISTRY_MIGRATION_NOT_QUIESCENT" && error.activeProcesses[0].pid === 42,
  );
});
