import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import {
  controllerStatePath,
  clearServiceState,
  ensureRuntimeDir,
  getSystemBootTimeMs,
  isRuntimeStateStaleAfterSystemRestart,
  loadControllerState,
  loadRecoveryBridgeState,
  loadServiceState,
  recoveryBridgeStatePath,
  saveControllerState,
  saveRecoveryBridgeState,
  saveServiceState,
  runtimeStatePath,
} from "../src/runtime-state.mjs";
import { createProjectContext } from "../src/project-context.mjs";

async function makeToolRoot(t) {
  const toolRoot = await mkdtemp(path.join(os.tmpdir(), "data-editor-tool-"));
  t.after(async () => {
    await rm(toolRoot, { recursive: true, force: true });
  });
  return toolRoot;
}

test("runtime state supports legacy toolRoot .runtime storage", async (t) => {
  const toolRoot = await makeToolRoot(t);
  const projectRoot = "C:/Code/Nocturnel";
  await ensureRuntimeDir(toolRoot);
  await saveServiceState(toolRoot, {
    pid: 4321,
    port: 8787,
    projectRoot,
    mode: "static",
    command: ["node", "server.mjs"],
    startedAt: "2026-05-31T12:00:00.000Z",
  });

  const file = JSON.parse(await readFile(runtimeStatePath(toolRoot), "utf8"));
  assert.equal(file.pid, 4321);
  assert.equal(file.projectRoot, projectRoot);
  assert.equal(
    runtimeStatePath(toolRoot),
    path.join(path.resolve(toolRoot, ".runtime"), "service.json"),
  );
  await saveControllerState(toolRoot, {
    controllerPid: 9876,
    servicePid: 4321,
    servicePort: 8787,
    mode: "static",
    generation: 3,
    operation: "running",
    lastExit: null,
  });
  const controllerFile = JSON.parse(await readFile(controllerStatePath(toolRoot), "utf8"));
  assert.equal(controllerFile.controllerPid, 9876);
  assert.equal(controllerFile.servicePid, 4321);
  assert.equal(
    controllerStatePath(toolRoot),
    path.join(path.resolve(toolRoot, ".runtime"), "controller.json"),
  );
});

test("runtime state stores project context state under project .data-editor runtime paths", async (t) => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "data-editor-project-"));
  t.after(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });
  const runtimeTarget = createProjectContext({ projectRoot });
  await ensureRuntimeDir(runtimeTarget);
  await saveServiceState(runtimeTarget, {
    pid: 4321,
    port: 8787,
    projectRoot,
    mode: "static",
    command: ["node", "server.mjs"],
    startedAt: "2026-05-31T12:00:00.000Z",
  });

  const file = JSON.parse(await readFile(runtimeStatePath(runtimeTarget), "utf8"));
  assert.equal(file.pid, 4321);
  assert.equal(file.projectRoot, projectRoot);
  assert.equal(
    runtimeStatePath(runtimeTarget),
    path.join(projectRoot, ".data-editor", "runtime", "service.json"),
  );
  await saveControllerState(runtimeTarget, {
    controllerPid: 9876,
    servicePid: 4321,
    servicePort: 8787,
    mode: "static",
    generation: 3,
    operation: "running",
    lastExit: null,
  });
  const controllerFile = JSON.parse(await readFile(controllerStatePath(runtimeTarget), "utf8"));
  assert.equal(controllerFile.controllerPid, 9876);
  assert.equal(controllerFile.servicePid, 4321);
  assert.equal(
    controllerStatePath(runtimeTarget),
    path.join(projectRoot, ".data-editor", "runtime", "controller.json"),
  );
});

test("clearServiceState removes runtime state file", async (t) => {
  const toolRoot = await makeToolRoot(t);
  await ensureRuntimeDir(toolRoot);
  await saveServiceState(toolRoot, {
    pid: 4321,
    port: 8787,
    projectRoot: "C:/Code/Nocturnel",
    mode: "static",
    command: ["node", "server.mjs"],
    startedAt: "2026-05-31T12:00:00.000Z",
  });

  await clearServiceState(toolRoot);
  assert.equal(await loadServiceState(toolRoot), null);
});

test("loadServiceState returns null for invalid runtime state json", async (t) => {
  const toolRoot = await makeToolRoot(t);
  await ensureRuntimeDir(toolRoot);
  await writeFile(runtimeStatePath(toolRoot), "{invalid json", "utf8");

  assert.equal(await loadServiceState(toolRoot), null);
});

test("loadControllerState returns null for invalid controller state json", async (t) => {
  const toolRoot = await makeToolRoot(t);
  await ensureRuntimeDir(toolRoot);
  await writeFile(controllerStatePath(toolRoot), "{invalid json", "utf8");

  assert.equal(await loadControllerState(toolRoot), null);
});

test("system boot time helper derives boot timestamp from uptime", () => {
  const bootTimeMs = getSystemBootTimeMs(10_000, 3);
  assert.equal(bootTimeMs, 7_000);
});

test("runtime state older than current system boot is treated as stale", () => {
  const nowMs = Date.parse("2026-06-03T00:35:15.000Z");
  const uptimeSeconds = 60;
  assert.equal(
    isRuntimeStateStaleAfterSystemRestart(
      {
        startedAt: "2026-06-03T00:30:00.000Z",
      },
      nowMs,
      uptimeSeconds,
    ),
    true,
  );
  assert.equal(
    isRuntimeStateStaleAfterSystemRestart(
      {
        updatedAt: "2026-06-03T00:35:00.000Z",
      },
      nowMs,
      uptimeSeconds,
    ),
    false,
  );
});

test("loaders clear stale runtime state files left behind by a system restart", async (t) => {
  const toolRoot = await makeToolRoot(t);
  await ensureRuntimeDir(toolRoot);

  const staleStartedAt = "2026-06-02T08:37:32.364Z";
  const staleUpdatedAt = "2026-06-02T08:37:31.345Z";
  const nowMs = Date.parse("2026-06-03T00:35:15.000Z");
  const uptimeSeconds = 60;

  await saveServiceState(toolRoot, {
    pid: 57528,
    port: 8787,
    projectRoot: "C:/Code/Nocturnel",
    mode: "static",
    command: ["node", "server.mjs"],
    startedAt: staleStartedAt,
  });
  await saveRecoveryBridgeState(toolRoot, {
    pid: 57240,
    toolRoot,
    projectRoot: "C:/Code/Nocturnel",
    port: 8791,
    servicePort: 8787,
    serviceMode: "static",
    command: ["node", "recovery-bridge.mjs"],
    startedAt: staleStartedAt,
  });
  await saveControllerState(toolRoot, {
    controllerPid: 57240,
    servicePid: 57528,
    servicePort: 8787,
    mode: "static",
    generation: 0,
    operation: "idle",
    lastExit: null,
    updatedAt: staleUpdatedAt,
  });

  assert.equal(await loadServiceState(toolRoot), null);
  assert.equal(await loadRecoveryBridgeState(toolRoot), null);
  assert.equal(await loadControllerState(toolRoot), null);

  assert.equal(
    isRuntimeStateStaleAfterSystemRestart({ startedAt: staleStartedAt }, nowMs, uptimeSeconds),
    true,
  );
  assert.equal(
    isRuntimeStateStaleAfterSystemRestart({ updatedAt: staleUpdatedAt }, nowMs, uptimeSeconds),
    true,
  );

  await assert.rejects(() => readFile(runtimeStatePath(toolRoot), "utf8"));
  await assert.rejects(() => readFile(recoveryBridgeStatePath(toolRoot), "utf8"));
  await assert.rejects(() => readFile(controllerStatePath(toolRoot), "utf8"));
});
