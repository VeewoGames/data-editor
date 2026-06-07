import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import http from "node:http";
import net from "node:net";
import { EventEmitter } from "node:events";
import { promisify } from "node:util";
import { loadControllerState, loadServiceState, saveServiceState } from "../src/runtime-state.mjs";
import { createProjectContext } from "../src/project-context.mjs";
import { runtimeHome } from "../src/project-registry.mjs";
import { openService } from "../open.mjs";
import { startMainService } from "../service-lifecycle.mjs";
import { postControllerStopRequest, runBuildCommand } from "../server.mjs";
import {
  buildExpectedIdentity,
  inspectProcess,
  inspectWindowsProcess,
  matchesServiceIdentity,
  stopService,
  terminateWindowsProcess,
} from "../stop.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stopScriptPath = path.join(repoRoot, "stop.mjs");
const openScriptPath = path.join(repoRoot, "open.mjs");
const serverScriptPath = path.join(repoRoot, "server.mjs");
const serviceFinalizeScriptPath = path.join(repoRoot, "scripts", "service-finalize.mjs");
const projectRoot = path.resolve(process.env.DATA_EDITOR_FIXTURE_PROJECT_ROOT ?? path.join(repoRoot, "..", "Nocturnel"));
const execFileAsync = promisify(execFile);

async function makeToolRoot(t) {
  const toolRoot = await mkdtemp(path.join(os.tmpdir(), "data-editor-stop-"));
  t.after(async () => {
    await rm(toolRoot, { recursive: true, force: true });
  });
  return toolRoot;
}

function runStop(toolRoot) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      stopScriptPath,
      "--tool-root",
      toolRoot,
      "--project",
      projectRoot,
      ...runtimeArgs(toolRoot),
    ], {
      cwd: repoRoot,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
  });
}

function runOpen(toolRoot, extraArgs = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [openScriptPath, "--tool-root", toolRoot, ...runtimeArgs(toolRoot), ...extraArgs], {
      cwd: repoRoot,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
  });
}

function runServiceFinalize(extraArgs = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [serviceFinalizeScriptPath, ...extraArgs], {
      cwd: repoRoot,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
  });
}

function runtimeArgs(toolRoot) {
  return [
    "--registry-home",
    toolRoot,
  ];
}

function runtimeTargetFor(toolRoot) {
  return runtimeHome({ home: toolRoot });
}

function runtimeDirFor(toolRoot) {
  return `.data-editor/runtime-tests/${path.basename(toolRoot)}`;
}

function logsDirFor(toolRoot) {
  return `.data-editor/log-tests/${path.basename(toolRoot)}`;
}

function postJson(port, requestPath, body = {}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: requestPath,
        method: "POST",
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-length": Buffer.byteLength(payload),
        },
        timeout: 3000,
      },
      (response) => {
        let responseBody = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          responseBody += chunk;
        });
        response.on("end", () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            body: responseBody ? JSON.parse(responseBody) : null,
          });
        });
      },
    );
    request.on("timeout", () => request.destroy(new Error("timeout")));
    request.on("error", reject);
    request.end(payload);
  });
}

async function openIdleKeepAliveConnection(port, requestPath = "/") {
  const socket = net.createConnection({ host: "127.0.0.1", port });
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });

  const responseText = await new Promise((resolve, reject) => {
    let buffer = "";
    const onData = (chunk) => {
      buffer += chunk.toString("utf8");
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const headerText = buffer.slice(0, headerEnd);
      const match = headerText.match(/content-length:\s*(\d+)/i);
      const contentLength = match ? Number(match[1]) : 0;
      const totalLength = headerEnd + 4 + contentLength;
      if (buffer.length < totalLength) return;
      socket.off("data", onData);
      resolve(buffer.slice(0, totalLength));
    };
    socket.on("data", onData);
    socket.once("error", reject);
    socket.write(`GET ${requestPath} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: keep-alive\r\n\r\n`);
  });

  return { socket, responseText };
}

async function openIncompleteHttpConnection(port, requestPath = "/") {
  const socket = net.createConnection({ host: "127.0.0.1", port });
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  socket.write(`GET ${requestPath} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: keep-alive\r\n`);
  return socket;
}

function getJson(port, requestPath) {
  return new Promise((resolve, reject) => {
    const request = http.get(
      {
        hostname: "127.0.0.1",
        port,
        path: requestPath,
        timeout: 3000,
      },
      (response) => {
        let responseBody = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          responseBody += chunk;
        });
        response.on("end", () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            body: responseBody ? JSON.parse(responseBody) : null,
          });
        });
      },
    );
    request.on("timeout", () => request.destroy(new Error("timeout")));
    request.on("error", reject);
  });
}

function requestBridge(port, requestPath, method, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: requestPath,
        method,
        headers,
        timeout: 3000,
      },
      (response) => {
        let responseBody = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          responseBody += chunk;
        });
        response.on("end", () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            headers: response.headers,
            bodyText: responseBody,
          });
        });
      },
    );
    request.on("timeout", () => request.destroy(new Error("timeout")));
    request.on("error", reject);
    request.end();
  });
}

function spawnDataEditorServer(port = "0", extraArgs = []) {
  return spawn(process.execPath, [serverScriptPath, "--root", projectRoot, "--port", String(port), ...extraArgs], {
    cwd: repoRoot,
    shell: false,
    stdio: ["ignore", "ignore", "ignore"],
  });
}

function spawnForeignProcess(marker) {
  return spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", "--", marker], {
    cwd: repoRoot,
    shell: false,
    stdio: ["ignore", "ignore", "ignore"],
  });
}

async function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

async function findAvailablePortExcluding(disallowedPorts) {
  const blocked = new Set(disallowedPorts.map((value) => Number(value)));
  while (true) {
    const port = await findAvailablePort();
    if (!blocked.has(port)) return port;
  }
}

function getText(port, requestPath) {
  return new Promise((resolve, reject) => {
    const request = http.get(
      {
        hostname: "127.0.0.1",
        port,
        path: requestPath,
        timeout: 3000,
      },
      (response) => {
        let responseBody = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          responseBody += chunk;
        });
        response.on("end", () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            bodyText: responseBody,
          });
        });
      },
    );
    request.on("timeout", () => request.destroy(new Error("timeout")));
    request.on("error", reject);
  });
}

async function listListeningPids(port) {
  if (process.platform !== "win32") return null;
  const { stdout } = await execFileAsync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Get-NetTCPConnection -LocalPort ${port} -State Listen | Select-Object -ExpandProperty OwningProcess | ConvertTo-Json -Compress`,
    ],
    { windowsHide: true },
  );
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed);
  return (Array.isArray(parsed) ? parsed : [parsed]).map((value) => Number(value));
}

async function waitForHttpOk(port, timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const statusCode = await new Promise((resolve, reject) => {
        const request = http.get(
          {
            hostname: "127.0.0.1",
            port,
            path: "/",
            timeout: 1000,
          },
          (response) => {
            response.resume();
            resolve(response.statusCode ?? 0);
          },
        );
        request.on("timeout", () => request.destroy(new Error("timeout")));
        request.on("error", reject);
      });
      if (statusCode >= 200 && statusCode < 500) return;
    } catch {}
    await delay(100);
  }
  throw new Error(`Timed out waiting for http://127.0.0.1:${port}/`);
}

async function waitForJsonOk(port, requestPath, timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await getJson(port, requestPath);
      if (response.statusCode >= 200 && response.statusCode < 300) return response.body;
    } catch {}
    await delay(100);
  }
  throw new Error(`Timed out waiting for http://127.0.0.1:${port}${requestPath}`);
}

async function waitForHttpDown(port, timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      await new Promise((resolve, reject) => {
        const request = http.get(
          {
            hostname: "127.0.0.1",
            port,
            path: "/",
            timeout: 1000,
          },
          (response) => {
            response.resume();
            resolve(response.statusCode ?? 0);
          },
        );
        request.on("timeout", () => request.destroy(new Error("timeout")));
        request.on("error", reject);
      });
    } catch {
      return;
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for http://127.0.0.1:${port}/ to stop responding`);
}

async function waitForServiceStateClear(toolRoot, timeoutMs = 10000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if ((await loadServiceState(toolRoot)) == null) return;
    await delay(100);
  }
  assert.equal(await loadServiceState(toolRoot), null);
}

async function waitForPidExit(pid, timeoutMs = 10000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!(await inspectProcess(pid))) return;
    await delay(100);
  }
  assert.equal(await inspectProcess(pid), null);
}

async function listenOnPort(port) {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return server;
}

async function waitForExit(child, timeoutMs = 5000) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode };
  }
  return Promise.race([
    new Promise((resolve) => {
      child.once("exit", (code, signal) => resolve({ code, signal }));
    }),
    delay(timeoutMs).then(() => {
      throw new Error(`Timed out waiting for pid ${child.pid} to exit`);
    }),
  ]);
}

test("npm run stop terminates a matching data-editor server process and clears runtime state", async (t) => {
  const toolRoot = await makeToolRoot(t);
  const server = spawnDataEditorServer();
  t.after(() => {
    if (!server.killed) {
      try {
        process.kill(server.pid, "SIGTERM");
      } catch {}
    }
  });
  await delay(300);

  await saveServiceState(toolRoot, {
    pid: server.pid,
    port: 0,
    mode: "static",
    projectRoot,
    command: [process.execPath, serverScriptPath, "--root", projectRoot],
    startedAt: new Date().toISOString(),
  });

  const result = await runStop(toolRoot);
  assert.equal(result.code, 0, result.stderr || result.stdout);
  await waitForExit(server);
  assert.equal(await loadServiceState(toolRoot), null);
});

test("npm run stop clears stale runtime state when pid is no longer running", async (t) => {
  const toolRoot = await makeToolRoot(t);
  const server = spawnDataEditorServer();
  await delay(300);
  const pid = server.pid;
  server.kill("SIGTERM");
  await waitForExit(server);

  await saveServiceState(toolRoot, {
    pid,
    port: 0,
    mode: "static",
    projectRoot,
    command: [process.execPath, serverScriptPath, "--root", projectRoot],
    startedAt: new Date().toISOString(),
  });

  const result = await runStop(toolRoot);
  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /stale|not running/i);
  assert.equal(await loadServiceState(toolRoot), null);
});

test("npm run stop refuses to terminate a live process whose identity does not match runtime state", async (t) => {
  const toolRoot = await makeToolRoot(t);
  const foreign = spawnForeignProcess("data-editor-foreign-process");
  t.after(() => {
    if (!foreign.killed) {
      try {
        process.kill(foreign.pid, "SIGTERM");
      } catch {}
    }
  });
  await delay(300);

  await saveServiceState(toolRoot, {
    pid: foreign.pid,
    port: 8787,
    mode: "static",
    projectRoot,
    command: [process.execPath, serverScriptPath, "--root", projectRoot],
    startedAt: new Date().toISOString(),
  });

  const result = await runStop(toolRoot);
  assert.equal(result.code, 1, `stdout=${result.stdout}\nstderr=${result.stderr}`);
  assert.match(result.stderr, /identity|mismatch|refus/i);
  assert.notEqual(await loadServiceState(toolRoot), null);
  process.kill(foreign.pid, "SIGTERM");
  await waitForExit(foreign);
});

test("identity matching does not depend on state.command when structured fields are enough", () => {
  const state = {
    pid: 1234,
    port: 8787,
    mode: "static",
    projectRoot: "C:/Code/Nocturnel",
    command: [process.execPath],
  };
  const info = {
    commandLine: `"${process.execPath}" C:\\Code\\Nocturnel\\tools\\data-editor\\server.mjs --root C:\\Code\\Nocturnel --port 8787`,
  };

  assert.deepEqual(buildExpectedIdentity(state), {
    mode: "static",
    scriptName: "server.mjs",
    projectRoot: "c:/code/nocturnel",
    port: 8787,
  });
  assert.equal(matchesServiceIdentity(info, state), true);
});

test("identity matching normalizes path case and slash differences but still rejects wrong structured fields", () => {
  const matchingState = {
    pid: 1234,
    port: 8787,
    mode: "dev",
    projectRoot: "c:\\code\\NOCTURNEL",
  };
  const processInfo = {
    commandLine: `"${process.execPath}" C:/Code/Nocturnel/tools/data-editor/dev.mjs --root C:/Code/Nocturnel --port 8787`,
  };
  const wrongProjectState = {
    ...matchingState,
    projectRoot: "C:/Code/OtherProject",
  };

  assert.equal(matchesServiceIdentity(processInfo, matchingState), true);
  assert.equal(matchesServiceIdentity(processInfo, wrongProjectState), false);
});

test("identity matching rejects the same projectRoot when the port differs", () => {
  const state = {
    pid: 1234,
    port: 8787,
    mode: "static",
    projectRoot: "C:/Code/Nocturnel",
  };
  const processInfo = {
    commandLine: `"${process.execPath}" C:/Code/Nocturnel/tools/data-editor/server.mjs --root C:/Code/Nocturnel --port 8788`,
  };

  assert.equal(matchesServiceIdentity(processInfo, state), false);
});

test("identity matching rejects processes whose server and dev modes do not match", () => {
  const state = {
    pid: 1234,
    port: 8787,
    mode: "dev",
    projectRoot: "C:/Code/Nocturnel",
  };
  const processInfo = {
    commandLine: `"${process.execPath}" C:/Code/Nocturnel/tools/data-editor/server.mjs --root C:/Code/Nocturnel --port 8787`,
  };

  assert.equal(matchesServiceIdentity(processInfo, state), false);
});

test("identity matching rejects prefixed projectRoot paths that only match by substring", () => {
  const state = {
    pid: 1234,
    port: 8787,
    mode: "static",
    projectRoot: "C:/Code/Nocturnel",
  };
  const processInfo = {
    commandLine: `"${process.execPath}" C:/Code/Nocturnel/tools/data-editor/server.mjs --root C:/Code/Nocturnel-2 --port 8787`,
  };

  assert.equal(matchesServiceIdentity(processInfo, state), false);
});

test("terminateWindowsProcess does not rely on localized taskkill output when process is already gone", async () => {
  let inspected = 0;
  await terminateWindowsProcess(4321, {
    execFileImpl: async () => {
      const error = new Error("taskkill failed");
      error.stdout = "";
      error.stderr = "错误: 没有运行的任务。";
      throw error;
    },
    inspectProcessImpl: async () => {
      inspected += 1;
      return null;
    },
  });

  assert.equal(inspected, 1);
});

test("startMainService starts exactly one main service and records runtime state", async (t) => {
  const toolRoot = await makeToolRoot(t);
  const runtimeTarget = runtimeTargetFor(toolRoot);
  const port = await findAvailablePort();
  const bridgePort = await findAvailablePortExcluding([port, port + 1]);

  const result = await startMainService({
    toolRoot,
    projectRoot,
    registryHome: toolRoot,
    runtimeTarget,
    runtimeDir: runtimeDirFor(toolRoot),
    logsDir: logsDirFor(toolRoot),
    port,
    mode: "static",
    bridgePort,
  });

  assert.match(result.message, /Data Editor is running/i);
  await waitForHttpOk(port);
  const state = await loadServiceState(runtimeTarget);
  assert.ok(state);
  assert.equal(Number(state.port), port);

  const stopResult = await stopService(runtimeTarget, { includeBridge: false });
  assert.equal(stopResult.ok, true, stopResult.message);
});

test("open script starts a detached static service, writes runtime state, and leaves the service running after open exits", async (t) => {
  const toolRoot = await makeToolRoot(t);
  const runtimeTarget = runtimeTargetFor(toolRoot);
  const port = await findAvailablePort();

  const bridgePort = await findAvailablePortExcluding([port, port + 1]);
  const result = await runOpen(toolRoot, ["--root", projectRoot, "--port", String(port), "--bridge-port", String(bridgePort)]);
  assert.equal(result.code, 0, `stdout=${result.stdout}\nstderr=${result.stderr}`);

  const state = await loadServiceState(runtimeTarget);
  assert.ok(state);
  assert.equal(state.mode, "static");
  assert.equal(state.port, port);
  assert.equal(state.projectRoot, projectRoot);
  assert.equal(path.basename(state.command[1]), "server.mjs");

  await waitForHttpOk(port);
  await waitForJsonOk(bridgePort, "/health");
  process.kill(state.pid, 0);

  const stopResult = await runStop(toolRoot);
  assert.equal(stopResult.code, 0, stopResult.stderr || stopResult.stdout);
  assert.equal(await loadServiceState(runtimeTarget), null);
});

test("open script also ensures a detached recovery bridge and stop tears it down with the main service", async (t) => {
  const toolRoot = await makeToolRoot(t);
  const port = await findAvailablePort();
  const bridgePort = await findAvailablePortExcluding([port, port + 1]);

  const result = await runOpen(toolRoot, [
    "--root",
    projectRoot,
    "--port",
    String(port),
    "--bridge-port",
    String(bridgePort),
  ]);
  assert.equal(result.code, 0, `stdout=${result.stdout}\nstderr=${result.stderr}`);

  await waitForHttpOk(port);
  const bridgeHealth = await waitForJsonOk(bridgePort, "/health");
  assert.deepEqual(bridgeHealth, { ok: true });

  const bridgeReopen = await postJson(bridgePort, "/reopen");
  assert.equal(bridgeReopen.statusCode, 200, JSON.stringify(bridgeReopen.body));
  assert.match(String(bridgeReopen.body?.message ?? ""), /already running/i);

  const stopResult = await runStop(toolRoot);
  assert.equal(stopResult.code, 0, stopResult.stderr || stopResult.stdout);
  await waitForHttpDown(port);
  await waitForHttpDown(bridgePort);
});

test("recovery bridge exposes CORS headers and handles browser preflight for cross-port reopen requests", async (t) => {
  const toolRoot = await makeToolRoot(t);
  const port = await findAvailablePort();
  const bridgePort = await findAvailablePortExcluding([port, port + 1]);

  const result = await runOpen(toolRoot, [
    "--root",
    projectRoot,
    "--port",
    String(port),
    "--bridge-port",
    String(bridgePort),
  ]);
  assert.equal(result.code, 0, `stdout=${result.stdout}\nstderr=${result.stderr}`);

  await waitForHttpOk(port);
  await waitForJsonOk(bridgePort, "/health");

  const preflight = await requestBridge(bridgePort, "/reopen", "OPTIONS", {
    origin: "http://127.0.0.1:8787",
    "access-control-request-method": "POST",
    "access-control-request-headers": "content-type",
  });
  assert.equal(preflight.statusCode, 204);
  assert.equal(preflight.headers["access-control-allow-origin"], "*");
  assert.match(String(preflight.headers["access-control-allow-methods"] ?? ""), /POST/);
  assert.match(String(preflight.headers["access-control-allow-headers"] ?? ""), /content-type/i);

  const health = await requestBridge(bridgePort, "/health", "GET", {
    origin: "http://127.0.0.1:8787",
  });
  assert.equal(health.statusCode, 200);
  assert.equal(health.headers["access-control-allow-origin"], "*");

  const stopResult = await runStop(toolRoot);
  assert.equal(stopResult.code, 0, stopResult.stderr || stopResult.stdout);
  await waitForHttpDown(bridgePort);
});

test("recovery bridge can reopen the main service after it stops unexpectedly", async (t) => {
  const toolRoot = await makeToolRoot(t);
  const runtimeTarget = runtimeTargetFor(toolRoot);
  const port = await findAvailablePort();
  const bridgePort = await findAvailablePortExcluding([port, port + 1]);

  const result = await runOpen(toolRoot, [
    "--root",
    projectRoot,
    "--port",
    String(port),
    "--bridge-port",
    String(bridgePort),
  ]);
  assert.equal(result.code, 0, `stdout=${result.stdout}\nstderr=${result.stderr}`);

  const state = await loadServiceState(runtimeTarget);
  assert.ok(state);
  await waitForHttpOk(port);
  await waitForJsonOk(bridgePort, "/health");

  process.kill(state.pid, "SIGTERM");
  await waitForHttpDown(port);
  await waitForPidExit(state.pid);
  await waitForServiceStateClear(runtimeTarget);

  const reopen = await postJson(bridgePort, "/reopen");
  assert.equal(reopen.statusCode, 200, JSON.stringify(reopen.body));
  assert.match(String(reopen.body?.message ?? ""), /running|started|reopened/i);

  await waitForHttpOk(port);
  const reopenedState = await loadServiceState(runtimeTarget);
  assert.ok(reopenedState);

  const stopResult = await runStop(toolRoot);
  assert.equal(stopResult.code, 0, stopResult.stderr || stopResult.stdout);
  await waitForHttpDown(bridgePort);
});

test("service finalize recovers the main service through the recovery bridge", async (t) => {
  const toolRoot = await makeToolRoot(t);
  const runtimeTarget = runtimeTargetFor(toolRoot);
  const port = await findAvailablePort();
  const bridgePort = await findAvailablePortExcluding([port, port + 1]);

  const result = await runOpen(toolRoot, [
    "--root",
    projectRoot,
    "--port",
    String(port),
    "--bridge-port",
    String(bridgePort),
  ]);
  assert.equal(result.code, 0, `stdout=${result.stdout}\nstderr=${result.stderr}`);

  const state = await loadServiceState(runtimeTarget);
  assert.ok(state);
  await waitForHttpOk(port);
  await waitForJsonOk(bridgePort, "/health");

  process.kill(state.pid, "SIGTERM");
  await waitForHttpDown(port);
  await waitForPidExit(state.pid);
  await waitForServiceStateClear(runtimeTarget);

  const finalize = await runServiceFinalize([
    "--recover",
    "--json",
    "--registry-home",
    toolRoot,
    "--main-port",
    String(port),
    "--bridge-port",
    String(bridgePort),
  ]);
  assert.equal(finalize.code, 0, `stdout=${finalize.stdout}\nstderr=${finalize.stderr}`);
  const body = JSON.parse(finalize.stdout);
  assert.equal(body.main.status, "recovered");
  assert.equal(body.bridge.status, "healthy");

  await waitForHttpOk(port);
  const listeners = await listListeningPids(port);
  if (listeners) assert.equal([...new Set(listeners)].length, 1);

  const stopResult = await runStop(toolRoot);
  assert.equal(stopResult.code, 0, stopResult.stderr || stopResult.stdout);
  await waitForHttpDown(bridgePort);
});

test("controller serializes concurrent reopen requests and starts only one main service", async (t) => {
  const toolRoot = await makeToolRoot(t);
  const runtimeTarget = runtimeTargetFor(toolRoot);
  const port = await findAvailablePort();
  const bridgePort = await findAvailablePortExcluding([port, port + 1]);

  const openResult = await runOpen(toolRoot, [
    "--root",
    projectRoot,
    "--port",
    String(port),
    "--bridge-port",
    String(bridgePort),
  ]);
  assert.equal(openResult.code, 0, `stdout=${openResult.stdout}\nstderr=${openResult.stderr}`);

  const firstState = await loadServiceState(runtimeTarget);
  assert.ok(firstState);
  process.kill(firstState.pid, "SIGTERM");
  await waitForHttpDown(port);
  await waitForPidExit(firstState.pid);
  await waitForServiceStateClear(runtimeTarget);

  const responses = await Promise.all([
    postJson(bridgePort, "/reopen"),
    postJson(bridgePort, "/reopen"),
    postJson(bridgePort, "/reopen"),
  ]);
  for (const response of responses) {
    assert.equal(response.statusCode, 200, JSON.stringify(response.body));
    assert.equal(response.body?.ok, true);
  }

  await waitForHttpOk(port);
  const listeners = await listListeningPids(port);
  if (listeners) assert.equal(listeners.length, 1);

  const controllerState = await loadControllerState(runtimeTarget);
  assert.ok(controllerState);
  assert.equal(Number(controllerState.servicePort), port);
  assert.equal(Number(controllerState.servicePid) > 0, true);

  const stopResult = await runStop(toolRoot);
  assert.equal(stopResult.code, 0, stopResult.stderr || stopResult.stdout);
});

test("controller stop-service stops only the main service and keeps the controller running", async (t) => {
  const toolRoot = await makeToolRoot(t);
  const runtimeTarget = runtimeTargetFor(toolRoot);
  const port = await findAvailablePort();
  const bridgePort = await findAvailablePortExcluding([port, port + 1]);

  const openResult = await runOpen(toolRoot, [
    "--root",
    projectRoot,
    "--port",
    String(port),
    "--bridge-port",
    String(bridgePort),
  ]);
  assert.equal(openResult.code, 0, `stdout=${openResult.stdout}\nstderr=${openResult.stderr}`);
  await waitForHttpOk(port);
  await waitForJsonOk(bridgePort, "/health");

  const response = await postJson(bridgePort, "/stop-service");
  assert.equal(response.statusCode, 200, JSON.stringify(response.body));
  assert.equal(response.body?.ok, true);

  await waitForHttpDown(port);
  const health = await getJson(bridgePort, "/health");
  assert.equal(health.statusCode, 200);

  const status = await getJson(bridgePort, "/status");
  assert.equal(status.statusCode, 200, JSON.stringify(status.body));
  assert.equal(status.body?.serviceRunning, false);

  const controllerState = await loadControllerState(runtimeTarget);
  assert.ok(controllerState);
  assert.equal(controllerState.servicePid, null);

  const stopResult = await runStop(toolRoot);
  assert.equal(stopResult.code, 0, stopResult.stderr || stopResult.stdout);
  await waitForHttpDown(bridgePort);
});

test("static service clears runtime state when the server process exits unexpectedly", async (t) => {
  const toolRoot = await makeToolRoot(t);
  const runtimeTarget = runtimeTargetFor(toolRoot);
  const port = await findAvailablePort();
  const bridgePort = await findAvailablePortExcluding([port, port + 1]);

  const result = await runOpen(toolRoot, ["--root", projectRoot, "--port", String(port), "--bridge-port", String(bridgePort)]);
  assert.equal(result.code, 0, `stdout=${result.stdout}\nstderr=${result.stderr}`);

  const state = await loadServiceState(runtimeTarget);
  assert.ok(state);
  await waitForHttpOk(port);

  process.kill(state.pid, "SIGTERM");
  await waitForHttpDown(port);
  await waitForPidExit(state.pid);
  await waitForServiceStateClear(runtimeTarget);
});

test("open script clears stale runtime state before launching dev mode and records the detached dev parent identity", async (t) => {
  const toolRoot = await makeToolRoot(t);
  const runtimeTarget = runtimeTargetFor(toolRoot);
  const port = await findAvailablePort();
  const bridgePort = await findAvailablePortExcluding([port, port + 1]);

  await saveServiceState(runtimeTarget, {
    pid: 999999,
    port,
    mode: "static",
    projectRoot,
    command: [process.execPath, serverScriptPath, "--root", projectRoot, "--port", String(port)],
    startedAt: new Date().toISOString(),
  });

  const result = await runOpen(toolRoot, [
    "--root",
    projectRoot,
    "--port",
    String(port),
    "--mode",
    "dev",
    "--bridge-port",
    String(bridgePort),
  ]);
  assert.equal(result.code, 0, `stdout=${result.stdout}\nstderr=${result.stderr}`);

  const state = await loadServiceState(runtimeTarget);
  assert.ok(state);
  assert.equal(state.mode, "dev");
  assert.equal(state.port, port);
  assert.equal(state.projectRoot, projectRoot);
  assert.equal(path.basename(state.command[1]), "dev.mjs");

  await waitForHttpOk(port);
  process.kill(state.pid, 0);

  const stopResult = await runStop(toolRoot);
  assert.equal(stopResult.code, 0, stopResult.stderr || stopResult.stdout);
  await waitForHttpDown(port);
  const portProbe = await listenOnPort(port);
  await new Promise((resolve, reject) => portProbe.close((error) => (error ? reject(error) : resolve())));
  assert.equal(await loadServiceState(runtimeTarget), null);
});

test("formal open and stop use the controller as the single lifecycle owner", async (t) => {
  const toolRoot = await makeToolRoot(t);
  const runtimeTarget = runtimeTargetFor(toolRoot);
  const port = await findAvailablePort();
  const bridgePort = await findAvailablePortExcluding([port, port + 1]);

  const openResult = await runOpen(toolRoot, [
    "--root",
    projectRoot,
    "--port",
    String(port),
    "--bridge-port",
    String(bridgePort),
  ]);
  assert.equal(openResult.code, 0, `stdout=${openResult.stdout}\nstderr=${openResult.stderr}`);
  await waitForHttpOk(port);

  const status = await getJson(bridgePort, "/status");
  assert.equal(status.statusCode, 200, JSON.stringify(status.body));
  assert.equal(status.body?.serviceRunning, true);
  assert.equal(status.body?.servicePort, port);

  const controllerState = await loadControllerState(runtimeTarget);
  assert.ok(controllerState);
  assert.equal(Number(controllerState.controllerPid) > 0, true);
  assert.equal(Number(controllerState.servicePid) > 0, true);

  const stopResult = await runStop(toolRoot);
  assert.equal(stopResult.code, 0, stopResult.stderr || stopResult.stdout);
  await waitForHttpDown(port);
  await waitForHttpDown(bridgePort);
  assert.equal(await loadServiceState(runtimeTarget), null);
});

test("dev service clears runtime state when the parent process exits unexpectedly", async (t) => {
  const toolRoot = await makeToolRoot(t);
  const runtimeTarget = runtimeTargetFor(toolRoot);
  const port = await findAvailablePort();
  const bridgePort = await findAvailablePortExcluding([port, port + 1]);

  const result = await runOpen(toolRoot, [
    "--root",
    projectRoot,
    "--port",
    String(port),
    "--mode",
    "dev",
    "--bridge-port",
    String(bridgePort),
  ]);
  assert.equal(result.code, 0, `stdout=${result.stdout}\nstderr=${result.stderr}`);

  const state = await loadServiceState(runtimeTarget);
  assert.ok(state);
  await waitForHttpOk(port);

  process.kill(state.pid, "SIGTERM");
  await waitForHttpDown(port);
  await waitForPidExit(state.pid);
  await waitForServiceStateClear(runtimeTarget);
});

test("open script fails cleanly when the requested port is already occupied and does not leave runtime state behind", async (t) => {
  const toolRoot = await makeToolRoot(t);
  const runtimeTarget = runtimeTargetFor(toolRoot);
  const occupiedPort = await findAvailablePort();
  const bridgePort = await findAvailablePort();
  const blocker = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("blocked");
  });
  await new Promise((resolve, reject) => {
    blocker.once("error", reject);
    blocker.listen(occupiedPort, "127.0.0.1", resolve);
  });
  t.after(async () => {
    await new Promise((resolve, reject) => blocker.close((error) => (error ? reject(error) : resolve())));
  });

  const result = await runOpen(toolRoot, [
    "--root",
    projectRoot,
    "--port",
    String(occupiedPort),
    "--bridge-port",
    String(bridgePort),
  ]);
  assert.equal(result.code, 1, `stdout=${result.stdout}\nstderr=${result.stderr}`);
  assert.match(`${result.stdout}\n${result.stderr}`, /port|listen|in use|eaddrinuse/i);
  assert.equal(await loadServiceState(runtimeTarget), null);
});

test("open script fails cleanly when dev api port is already occupied and does not leave runtime state behind", async (t) => {
  const toolRoot = await makeToolRoot(t);
  const runtimeTarget = runtimeTargetFor(toolRoot);
  const port = await findAvailablePort();
  const bridgePort = await findAvailablePortExcluding([port, port + 1]);
  const apiBlocker = await listenOnPort(port + 1);
  t.after(async () => {
    await new Promise((resolve, reject) => apiBlocker.close((error) => (error ? reject(error) : resolve())));
  });

  const result = await runOpen(toolRoot, [
    "--root",
    projectRoot,
    "--port",
    String(port),
    "--mode",
    "dev",
    "--bridge-port",
    String(bridgePort),
  ]);
  assert.equal(result.code, 1, `stdout=${result.stdout}\nstderr=${result.stderr}`);
  assert.match(`${result.stdout}\n${result.stderr}`, /port|in use|eaddrinuse/i);
  assert.equal(await loadServiceState(runtimeTarget), null);
});

test("openService surfaces controller startup failures without writing service state", async (t) => {
  const toolRoot = await makeToolRoot(t);
  const runtimeTarget = runtimeTargetFor(toolRoot);
  const port = await findAvailablePort();

  await assert.rejects(
    () =>
      openService(
        { toolRoot, projectRoot, port, mode: "static", runtimeTarget },
        {
          ensureRecoveryBridgeRunningImpl: async () => {},
          postControllerJsonImpl: async () => {
            throw new Error("synthetic readiness failure");
          },
        },
      ),
    /synthetic readiness failure/i,
  );

  assert.equal(await loadServiceState(runtimeTarget), null);
});

test("startMainService launches the dev parent in background mode", async (t) => {
  const toolRoot = await makeToolRoot(t);
  const runtimeTarget = runtimeTargetFor(toolRoot);
  const port = await findAvailablePort();
  const bridgePort = await findAvailablePortExcluding([port, port + 1]);
  const calls = [];
  const child = {
    pid: 45678,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    exitCode: null,
    signalCode: null,
    unref() {},
  };
  child.stdout.destroy = () => {};
  child.stderr.destroy = () => {};

  await startMainService(
    { toolRoot, projectRoot, port, mode: "dev", bridgePort, runtimeTarget, registryHome: toolRoot },
    {
      spawnImpl: (...args) => {
        calls.push(args);
        return child;
      },
      saveServiceStateImpl: async () => {},
      isPortRespondingImpl: async () => false,
      waitForServiceReadyImpl: async () => {},
    },
  );

  assert.equal(calls.length, 1);
  const options = calls[0][2];
  assert.equal(options.env.DATA_EDITOR_BACKGROUND, "1");
});

test("shutdown helper posts stop-service to the controller bridge", async () => {
  const bridgePort = await findAvailablePort();
  const requests = [];
  const bridge = http.createServer(async (req, res) => {
    let body = "";
    req.setEncoding("utf8");
    for await (const chunk of req) {
      body += chunk;
    }
    requests.push({
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: body ? JSON.parse(body) : null,
    });
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise((resolve, reject) => {
    bridge.once("error", reject);
    bridge.listen(bridgePort, "127.0.0.1", resolve);
  });

  try {
    await postControllerStopRequest(bridgePort);
  } finally {
    await new Promise((resolve, reject) => bridge.close((error) => (error ? reject(error) : resolve())));
  }

  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].url, "/stop-service");
  assert.equal(requests[0].headers["content-type"], "application/json; charset=utf-8");
  assert.equal(requests[0].body && typeof requests[0].body === "object" ? Object.keys(requests[0].body).length : -1, 0);
});

test("inspectWindowsProcess hides the transient powershell window on Windows", async () => {
  if (process.platform !== "win32") return;

  const calls = [];
  const processInfo = await inspectWindowsProcess(12345, {
    execFileImpl: async (...args) => {
      calls.push(args);
      return {
        stdout: JSON.stringify({
          ProcessId: 12345,
          Name: "node.exe",
          ExecutablePath: "C:\\Program Files\\nodejs\\node.exe",
          CommandLine: "node server.mjs --port 8787",
        }),
      };
    },
  });

  assert.equal(processInfo?.pid, 12345);
  assert.deepEqual(calls, [
    [
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        '$p = Get-CimInstance Win32_Process -Filter "ProcessId = 12345"; if (-not $p) { exit 0 }; $p | Select-Object ProcessId, Name, ExecutablePath, CommandLine | ConvertTo-Json -Compress',
      ],
      {
        windowsHide: true,
      },
    ],
  ]);
});

test("terminateWindowsProcess hides the transient taskkill window on Windows", async () => {
  if (process.platform !== "win32") return;

  const calls = [];
  await terminateWindowsProcess(12345, {
    execFileImpl: async (...args) => {
      calls.push(args);
      return { stdout: "" };
    },
  });

  assert.deepEqual(calls, [
    [
      "taskkill.exe",
      ["/PID", "12345", "/T", "/F"],
      {
        windowsHide: true,
      },
    ],
  ]);
});

test("build helper runs npm run build from the tool root and surfaces stderr on failure", async () => {
  const calls = [];
  await assert.rejects(
    () =>
      runBuildCommand({
        cwd: "C:\\Code\\Nocturnel\\tools\\data-editor",
        execFileImpl: async (...args) => {
          calls.push(args);
          const error = new Error("build failed");
          error.stderr = "synthetic build stderr";
          throw error;
        },
      }),
    /synthetic build stderr/i,
  );

  assert.deepEqual(calls, [
    [
      process.execPath,
      [path.resolve("C:\\Code\\Nocturnel\\tools\\data-editor", "node_modules", "vite", "bin", "vite.js"), "build"],
      {
        cwd: "C:\\Code\\Nocturnel\\tools\\data-editor",
        shell: false,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
      },
    ],
  ]);
});

test("missing static assets return 404 without crashing the static server", async (t) => {
  const port = await findAvailablePort();
  const registryHome = await mkdtemp(path.join(os.tmpdir(), "data-editor-static-home-"));
  t.after(async () => {
    await rm(registryHome, { recursive: true, force: true });
  });
  const child = spawnDataEditorServer(port, ["--registry-home", registryHome, "--static", "dist"]);
  t.after(() => {
    try {
      child.kill();
    } catch {}
  });

  await waitForHttpOk(port);

  const faviconResponse = await getText(port, "/favicon.ico");
  assert.equal(faviconResponse.statusCode, 404, faviconResponse.bodyText);

  const healthResponse = await getJson(port, "/api/health");
  assert.equal(healthResponse.statusCode, 200, JSON.stringify(healthResponse.body));
});

test("invalid document requests return 500 without crashing the static server", async (t) => {
  const port = await findAvailablePort();
  const registryHome = await mkdtemp(path.join(os.tmpdir(), "data-editor-invalid-document-home-"));
  t.after(async () => {
    await rm(registryHome, { recursive: true, force: true });
  });
  const child = spawnDataEditorServer(port, ["--project", projectRoot, "--registry-home", registryHome, "--static", "dist"]);
  t.after(async () => {
    try {
      child.kill();
    } catch {}
    await waitForExit(child).catch(() => {});
  });

  await waitForHttpOk(port);

  const response = await getJson(port, "/api/document?path=data/prototypes_mini.json");
  assert.equal(response.statusCode, 500);
  assert.match(String(response.body?.error ?? ""), /allowlist/i);

  const healthResponse = await getJson(port, "/api/health");
  assert.equal(healthResponse.statusCode, 200, JSON.stringify(healthResponse.body));
});

test("server registers project and lists files by projectId", async (t) => {
  const project = await mkdtemp(path.join(os.tmpdir(), "data-editor-api-project-"));
  const registryHome = await mkdtemp(path.join(os.tmpdir(), "data-editor-api-home-"));
  t.after(async () => {
    await rm(project, { recursive: true, force: true });
    await rm(registryHome, { recursive: true, force: true });
  });
  await mkdir(path.join(project, "data"));
  await writeFile(path.join(project, "data", "api.json"), "[]");
  const port = await findAvailablePort();
  const child = spawnDataEditorServer(port, ["--project", project, "--registry-home", registryHome, "--static", "dist"]);
  t.after(async () => {
    try {
      child.kill();
    } catch {}
    await waitForExit(child).catch(() => {});
  });

  await waitForHttpOk(port);
  const projects = await waitForJsonOk(port, "/api/projects");
  assert.equal(projects.projects.length, 1);
  assert.equal(projects.activeProjectId, projects.projects[0].id);

  const files = await waitForJsonOk(port, `/api/files?projectId=${encodeURIComponent(projects.activeProjectId)}`);
  assert.deepEqual(files.map((file) => file.path), ["data/api.json"]);
});

test("POST /api/shutdown returns success and stops the static service through the formal stop flow", async (t) => {
  const toolRoot = await makeToolRoot(t);
  const runtimeTarget = runtimeTargetFor(toolRoot);
  const port = await findAvailablePort();
  const bridgePort = await findAvailablePort();

  const result = await runOpen(toolRoot, ["--root", projectRoot, "--port", String(port), "--bridge-port", String(bridgePort)]);
  assert.equal(result.code, 0, `stdout=${result.stdout}\nstderr=${result.stderr}`);
  await waitForHttpOk(port);

  const response = await postJson(port, "/api/shutdown");
  assert.equal(response.statusCode, 202, JSON.stringify(response.body));
  assert.deepEqual(response.body, { ok: true, stopping: true });

  await waitForHttpDown(port);
  await waitForServiceStateClear(runtimeTarget);
  const bridgeHealth = await getJson(bridgePort, "/health");
  assert.equal(bridgeHealth.statusCode, 200);
  const stopResult = await runStop(toolRoot);
  assert.equal(stopResult.code, 0, stopResult.stderr || stopResult.stdout);
  await waitForHttpDown(bridgePort);
});

test("POST /api/shutdown also stops the dev service through the same formal stop flow", async (t) => {
  const toolRoot = await makeToolRoot(t);
  const runtimeTarget = runtimeTargetFor(toolRoot);
  const port = await findAvailablePort();
  const bridgePort = await findAvailablePortExcluding([port, port + 1]);

  const result = await runOpen(toolRoot, [
    "--root",
    projectRoot,
    "--port",
    String(port),
    "--mode",
    "dev",
    "--bridge-port",
    String(bridgePort),
  ]);
  assert.equal(result.code, 0, `stdout=${result.stdout}\nstderr=${result.stderr}`);
  await waitForHttpOk(port);

  const response = await postJson(port, "/api/shutdown");
  assert.equal(response.statusCode, 202, JSON.stringify(response.body));
  assert.deepEqual(response.body, { ok: true, stopping: true });

  await waitForHttpDown(port);
  const rebound = await listenOnPort(port);
  await new Promise((resolve, reject) => rebound.close((error) => (error ? reject(error) : resolve())));
  await waitForServiceStateClear(runtimeTarget);
  const bridgeHealth = await getJson(bridgePort, "/health");
  assert.equal(bridgeHealth.statusCode, 200);
  const stopResult = await runStop(toolRoot);
  assert.equal(stopResult.code, 0, stopResult.stderr || stopResult.stdout);
  await waitForHttpDown(bridgePort);
});

test("POST /api/shutdown exits the static service even when a keep-alive client is still connected", async (t) => {
  const toolRoot = await makeToolRoot(t);
  const runtimeTarget = runtimeTargetFor(toolRoot);
  const port = await findAvailablePort();
  const bridgePort = await findAvailablePort();

  const result = await runOpen(toolRoot, ["--root", projectRoot, "--port", String(port), "--bridge-port", String(bridgePort)]);
  assert.equal(result.code, 0, `stdout=${result.stdout}\nstderr=${result.stderr}`);
  await waitForHttpOk(port);

  const serviceState = await loadServiceState(runtimeTarget);
  assert.ok(serviceState?.pid, "expected service pid to be recorded before shutdown");

  const { socket, responseText } = await openIdleKeepAliveConnection(port, "/api/health");
  t.after(() => socket.destroy());
  assert.match(responseText, /^HTTP\/1\.1 200 /);
  assert.match(responseText, /Connection: keep-alive/i);

  const shutdownResponse = await postJson(port, "/api/shutdown");
  assert.equal(shutdownResponse.statusCode, 202, JSON.stringify(shutdownResponse.body));
  assert.deepEqual(shutdownResponse.body, { ok: true, stopping: true });

  await waitForHttpDown(port);
  await waitForServiceStateClear(runtimeTarget);
  await waitForPidExit(Number(serviceState.pid));

  const bridgeHealth = await getJson(bridgePort, "/health");
  assert.equal(bridgeHealth.statusCode, 200);
  const stopResult = await runStop(toolRoot);
  assert.equal(stopResult.code, 0, stopResult.stderr || stopResult.stdout);
  await waitForHttpDown(bridgePort);
});

test("POST /api/shutdown exits the static service even when a client leaves an incomplete HTTP connection open", async (t) => {
  const toolRoot = await makeToolRoot(t);
  const runtimeTarget = runtimeTargetFor(toolRoot);
  const port = await findAvailablePort();
  const bridgePort = await findAvailablePort();

  const result = await runOpen(toolRoot, ["--root", projectRoot, "--port", String(port), "--bridge-port", String(bridgePort)]);
  assert.equal(result.code, 0, `stdout=${result.stdout}\nstderr=${result.stderr}`);
  await waitForHttpOk(port);

  const serviceState = await loadServiceState(runtimeTarget);
  assert.ok(serviceState?.pid, "expected service pid to be recorded before shutdown");

  const socket = await openIncompleteHttpConnection(port, "/api/health");
  t.after(() => socket.destroy());

  const shutdownResponse = await postJson(port, "/api/shutdown");
  assert.equal(shutdownResponse.statusCode, 202, JSON.stringify(shutdownResponse.body));
  assert.deepEqual(shutdownResponse.body, { ok: true, stopping: true });

  await waitForHttpDown(port);
  await waitForServiceStateClear(runtimeTarget);
  await waitForPidExit(Number(serviceState.pid));

  const bridgeHealth = await getJson(bridgePort, "/health");
  assert.equal(bridgeHealth.statusCode, 200);
  const stopResult = await runStop(toolRoot);
  assert.equal(stopResult.code, 0, stopResult.stderr || stopResult.stdout);
  await waitForHttpDown(bridgePort);
});
