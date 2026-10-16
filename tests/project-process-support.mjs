import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, mkdtemp, copyFile, readFile, rm, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { createProjectProcessService } from "../src/project-process-service.mjs";
import { saveProjectRegistry } from "../src/project-registry.mjs";
import { inspectProjectProcess, matchesProjectProcessInstance } from "../src/project-process-instance.mjs";
import { spawnPersistentProcess } from "../src/persistent-process.mjs";

export const repoRoot = fileURLToPath(new URL("../", import.meta.url));
export const binding = { id: "fixture-computation", engine: "project-process-v1", displayName: "后台计算", entry: "producer.mjs", instanceResource: "instance.json" };

export async function fixture(t, deps = {}) {
  const temp = path.join(repoRoot, "temp", "agent", "task4-project-process-tests"); await mkdir(temp, { recursive: true });
  const base = await mkdtemp(path.join(temp, "run-")); const root = path.join(base, "project"), home = path.join(base, "home");
  await mkdir(path.join(root, ".data-editor"), { recursive: true });
  await copyFile(path.join(repoRoot, "tests", "fixtures", "project-process-fixture.mjs"), path.join(root, binding.entry));
  await writeFile(path.join(root, ".data-editor", "enrollment.json"), JSON.stringify({ version: 1, requires: { capabilityApi: 1 } }));
  const manifest = { version: 1, requires: { capabilityApi: 1 }, capabilities: { projectProcesses: [binding] } };
  await writeFile(path.join(root, ".data-editor", "project.json"), JSON.stringify(manifest));
  await saveProjectRegistry({ version: 2, activeProjectId: "fixture-project", projects: [{ id: "fixture-project", name: "Fixture", root,
    dataSources: [{ id: "data", label: "Data", path: "data", kind: "relative" }], filePolicy: { includeExtensions: [".json"] } }] }, { home });
  const launched = new Map();
  const spawn = deps.spawnPersistentProcess ?? spawnPersistentProcess;
  const owner = createProjectProcessService({ home }, { ...deps, spawnPersistentProcess: async (...args) => {
    const result = await spawn(...args);
    const identity = await inspectProjectProcess(result.pid);
    if (identity) launched.set(result.pid, identity);
    return result;
  } });
  t.after(async () => {
    // Track the exact processes this test launched, independently of protocol
    // fault injection. A fabricated/reused metadata PID can never be killed.
    for (const [pid, original] of launched) {
      const live = await inspectProjectProcess(pid);
      if (live && live.started === original.started && live.command === original.command) {
        process.kill(pid, "SIGTERM");
        const deadline = Date.now() + 10000;
        while (await inspectProjectProcess(pid)) { if (Date.now() > deadline) throw Error("fixture cleanup exit timeout"); await delay(50); }
      }
    }
    try {
      const instance = JSON.parse(await readFile(path.join(root, binding.instanceResource), "utf8"));
      const identity = await inspectProjectProcess(instance.pid);
      if (identity && await matchesProjectProcessInstance(instance, identity, { root, entry: path.join(root, binding.entry) })) {
        process.kill(instance.pid, "SIGTERM");
        const deadline = Date.now() + 10000;
        while (await inspectProjectProcess(instance.pid)) {
          if (Date.now() > deadline) throw Error("fixture cleanup exit timeout");
          await delay(50);
        }
      }
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    const relative = path.relative(temp, base);
    assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative), "cleanup stays inside owned test root");
    await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  async function current() { return (await owner.list("fixture-project")).processes[0]; }
  function request(item, action) { return { projectId: item.projectId, processId: item.processId, action,
    expectedGeneration: item.generation, declarationDigest: item.declarationDigest, expectedIntentVersion: item.intentVersion }; }
  async function permit(action = "start") { const pending = await owner.control(request(await current(), action)); assert.equal(pending.code, "AUTH_REQUIRED"); return owner.authorize(pending.authorizationRequest); }
  return { base, root, home, owner, manifest, current, request, permit };
}
