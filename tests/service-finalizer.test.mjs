import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  buildProtectedPids,
  checkServiceHealth,
  decideRecovery,
  formatFinalizeSummary,
  parseListeningPidsFromPowerShell,
  planProcessCleanup,
  planTempDirectoryCleanup,
} from "../src/service-finalizer.mjs";

test("buildProtectedPids includes runtime state, controller, bridge, and listening pids", () => {
  const result = buildProtectedPids({
    serviceState: { pid: 101 },
    controllerState: { controllerPid: 102, servicePid: 103 },
    recoveryBridgeState: { pid: 104 },
    listeningPids: {
      main: { ok: true, pids: [105] },
      bridge: { ok: true, pids: [106] },
    },
  });

  assert.deepEqual([...result].sort((a, b) => a - b), [101, 102, 103, 104, 105, 106]);
});

test("parseListeningPidsFromPowerShell parses single, multiple, and empty output", () => {
  assert.deepEqual(parseListeningPidsFromPowerShell(""), []);
  assert.deepEqual(parseListeningPidsFromPowerShell('{"OwningProcess":20864}'), [20864]);
  assert.deepEqual(
    parseListeningPidsFromPowerShell('[{"OwningProcess":20864},{"OwningProcess":49312},{"OwningProcess":20864}]'),
    [20864, 49312],
  );
});

test("planProcessCleanup protects current service and skips when port pids are unavailable", () => {
  const processes = [
    {
      pid: 201,
      name: "node.exe",
      commandLine: '"node.exe" recovery-bridge.mjs --tool-root C:\\Users\\lans\\AppData\\Local\\Temp\\data-editor-stop-abc --port 1234',
    },
    {
      pid: 202,
      name: "node.exe",
      commandLine: '"node.exe" server.mjs --project C:\\Code\\Nocturnel --port 8787 --registry-home C:\\Users\\lans\\AppData\\Roaming\\data-editor',
    },
  ];

  const skipped = planProcessCleanup({
    processes,
    protectedPids: new Set([202]),
    listeningPidsAvailable: false,
    tempRoot: "C:\\Users\\lans\\AppData\\Local\\Temp",
  });
  assert.equal(skipped.skipped, true);
  assert.equal(skipped.reason, "listening-pids-unavailable");
  assert.deepEqual(skipped.processesToStop, []);

  const planned = planProcessCleanup({
    processes,
    protectedPids: new Set([202]),
    listeningPidsAvailable: true,
    tempRoot: "C:\\Users\\lans\\AppData\\Local\\Temp",
  });
  assert.equal(planned.skipped, false);
  assert.deepEqual(planned.processesToStop.map((item) => item.pid), [201]);
  assert.deepEqual(planned.protectedProcesses.map((item) => item.pid), [202]);
});

test("planProcessCleanup does not tree-kill when a child is not cleanable", () => {
  const processes = [
    {
      pid: 301,
      parentPid: 1,
      name: "node.exe",
      commandLine: '"node.exe" server.mjs --tool-root C:\\Users\\lans\\AppData\\Local\\Temp\\data-editor-stop-tree --port 9010',
    },
    {
      pid: 302,
      parentPid: 301,
      name: "node.exe",
      commandLine: '"node.exe" C:\\Users\\lans\\AppData\\Local\\OpenAI\\Codex\\kernel.js',
    },
  ];

  const planned = planProcessCleanup({
    processes,
    protectedPids: new Set(),
    listeningPidsAvailable: true,
    tempRoot: "C:\\Users\\lans\\AppData\\Local\\Temp",
    allowTreeKill: true,
  });

  assert.deepEqual(planned.processesToStop.map((item) => item.pid), [301]);
  assert.equal(planned.treeKillAllowed, false);
  assert.match(planned.warnings.join("\n"), /tree/i);
});

test("planTempDirectoryCleanup only deletes unused data-editor-stop directories inside temp root", () => {
  const tempRoot = path.resolve("C:/Users/lans/AppData/Local/Temp");
  const directories = [
    path.join(tempRoot, "data-editor-stop-abc"),
    path.join(tempRoot, "other"),
    path.resolve("C:/Users/lans/AppData/Local/TempNotReally/data-editor-stop-outside"),
    path.join(tempRoot, "data-editor-stop-used"),
  ];
  const processes = [
    {
      pid: 401,
      commandLine: `"node.exe" recovery-bridge.mjs --tool-root ${path.join(tempRoot, "data-editor-stop-used")}`,
    },
  ];

  const plan = planTempDirectoryCleanup({ directories, processes, tempRoot });

  assert.deepEqual(plan.directoriesToDelete, [path.join(tempRoot, "data-editor-stop-abc")]);
  assert.deepEqual(plan.skippedDirectories.map((item) => item.reason), [
    "name-mismatch",
    "outside-temp-root",
    "in-use",
  ]);
});

test("checkServiceHealth classifies main and bridge health", async () => {
  const health = await checkServiceHealth({
    mainPort: 8787,
    bridgePort: 8791,
    requestJson: async (url) => {
      if (url === "http://127.0.0.1:8787/api/health") return { ok: true, bridgePort: 8791 };
      if (url === "http://127.0.0.1:8791/health") return { ok: true };
      throw new Error(`unexpected url ${url}`);
    },
  });

  assert.equal(health.main.ok, true);
  assert.equal(health.bridge.ok, true);
});

test("decideRecovery requires recover flag, bridge status, and bridge identity", async () => {
  const base = {
    mainHealth: { ok: false },
    bridgeHealth: { ok: true },
    recover: true,
    bridgePort: 8791,
    bridgeState: {
      pid: 501,
      toolRoot: "C:\\Code\\data-editor",
      projectRoot: "C:\\Code\\Nocturnel",
      registryHome: "C:\\Users\\lans\\AppData\\Roaming\\data-editor",
      port: 8791,
      servicePort: 8787,
      serviceMode: "static",
    },
    bridgeProcessInfo: {
      commandLine: '"node.exe" recovery-bridge.mjs --tool-root C:\\Code\\data-editor --project C:\\Code\\Nocturnel --registry-home C:\\Users\\lans\\AppData\\Roaming\\data-editor --port 8791 --service-port 8787 --service-mode static',
    },
    requestJson: async (url) => {
      if (url === "http://127.0.0.1:8791/status") {
        return { ok: true, servicePort: 8787, serviceMode: "static" };
      }
      throw new Error(`unexpected url ${url}`);
    },
  };

  assert.deepEqual(await decideRecovery({ ...base, recover: false }), {
    action: "skip",
    reason: "recover-disabled",
  });
  assert.deepEqual(await decideRecovery(base), {
    action: "recover",
    url: "http://127.0.0.1:8791/start",
  });
  assert.deepEqual(await decideRecovery({ ...base, bridgeProcessInfo: { commandLine: "node other.mjs" } }), {
    action: "skip",
    reason: "bridge-identity-mismatch",
  });
});

test("formatFinalizeSummary includes degraded states", () => {
  const summary = formatFinalizeSummary({
    expectedUrl: "http://127.0.0.1:8787/",
    main: { status: "recovered", pid: 601 },
    bridge: { status: "healthy", pid: 602 },
    cleanup: { status: "cleanupSkipped", stoppedProcesses: [], deletedDirectories: [] },
  });

  assert.match(summary, /Main service: recovered/);
  assert.match(summary, /Recovery bridge: healthy/);
  assert.match(summary, /Cleanup: cleanupSkipped/);
  assert.match(summary, /http:\/\/127\.0\.0\.1:8787\//);
});
