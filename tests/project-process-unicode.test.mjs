import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, mkdtemp, copyFile, readFile, rm, writeFile, realpath } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { saveProjectRegistry } from "../src/project-registry.mjs";
import { createProjectProcessService } from "../src/project-process-service.mjs";
import { inspectProjectProcess, matchesProjectProcessInstance } from "../src/project-process-instance.mjs";
import { spawnPersistentProcess } from "../src/persistent-process.mjs";

test("real Chinese and spaced root/home/entry preserve exact CIM identity through watch/status/stop", { skip: process.platform !== "win32", timeout: 120000 }, async t => {
  const repo = fileURLToPath(new URL("../", import.meta.url));
  const boundary = path.join(repo, "temp", "agent", "task4-project-process-unicode-tests");
  await mkdir(boundary, { recursive: true });
  const base = await mkdtemp(path.join(boundary, "中文 空格-"));
  const root = path.join(base, "中文 项目"), home = path.join(base, "中文 配置"), entry = "后台 计算.mjs";
  const launches = new Map();
  t.after(async () => {
    for (const [pid, original] of launches) {
      const current = await inspectProjectProcess(pid);
      if (current && current.started === original.started && current.command === original.command) {
        process.kill(pid, "SIGTERM"); const deadline = Date.now() + 10000;
        while (await inspectProjectProcess(pid)) { if (Date.now() > deadline) throw Error("unicode fixture cleanup timeout"); await delay(50); }
      }
    }
    const relative = path.relative(boundary, base);
    assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
    await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  await mkdir(path.join(root, ".data-editor"), { recursive: true });
  await copyFile(path.join(repo, "tests", "fixtures", "project-process-fixture.mjs"), path.join(root, entry));
  const binding = { id: "unicode-process", engine: "project-process-v1", displayName: "后台计算", entry, instanceResource: "instance.json" };
  await writeFile(path.join(root, ".data-editor", "enrollment.json"), JSON.stringify({ version: 1, requires: { capabilityApi: 1 } }));
  await writeFile(path.join(root, ".data-editor", "project.json"), JSON.stringify({ version: 1, requires: { capabilityApi: 1 }, capabilities: { projectProcesses: [binding] } }));
  await saveProjectRegistry({ version: 2, activeProjectId: "unicode-project", projects: [{ id: "unicode-project", name: "中文项目", root,
    dataSources: [{ id: "data", label: "Data", path: "data", kind: "relative" }], filePolicy: { includeExtensions: [".json"] } }] }, { home });
  const owner = createProjectProcessService({ home }, { spawnPersistentProcess: async (...args) => {
    const result = await spawnPersistentProcess(...args);
    const identity = await inspectProjectProcess(result.pid);
    if (identity) launches.set(result.pid, identity);
    return result;
  } });
  const request = (item, action) => ({ projectId: item.projectId, processId: item.processId, action,
    expectedGeneration: item.generation, declarationDigest: item.declarationDigest, expectedIntentVersion: item.intentVersion });
  const initial = (await owner.list("unicode-project")).processes[0]; assert.equal(initial.state, "stopped");
  const permission = await owner.control(request(initial, "start")); assert.equal(permission.code, "AUTH_REQUIRED");
  const running = await owner.authorize(permission.authorizationRequest); assert.equal(running.state, "running", running.error ?? undefined);
  const instance = JSON.parse(await readFile(path.join(root, "instance.json"), "utf8"));
  const identity = await inspectProjectProcess(instance.pid);
  assert.ok(identity); assert.ok(identity.command.includes(root)); assert.ok(identity.command.includes(entry));
  assert.equal(identity.command.includes("\uFFFD"), false);
  const target = { root: await realpath(root), entry: await realpath(path.join(root, entry)) };
  assert.equal(await matchesProjectProcessInstance(instance, identity, target), true);
  assert.equal(await matchesProjectProcessInstance({ ...instance, nonce: "f".repeat(36) }, identity, target), false);
  assert.equal(await matchesProjectProcessInstance({ ...instance, started: "2000-01-01T00:00:00Z" }, identity, target), false);
  const current = (await owner.list("unicode-project")).processes[0]; assert.equal(current.state, "running");
  const off = await owner.control(request(current, "stop")); assert.equal(off.state, "stopped", off.error ?? undefined); assert.equal(off.desiredEnabled, false);
  assert.equal(await inspectProjectProcess(instance.pid), null);
  const reopened = await createProjectProcessService({ home }).open("unicode-project", binding.id);
  assert.equal(reopened.processes[0].state, "stopped"); assert.equal(reopened.processes[0].desiredEnabled, false);
});
