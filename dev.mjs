import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { clearServiceStateIfOwned } from "./src/runtime-state.mjs";
import { buildDevChildSpawnOptions, isBackgroundDevProcess } from "./src/dev-spawn-options.mjs";
import { createProjectContext } from "./src/project-context.mjs";

const toolRoot = path.dirname(fileURLToPath(import.meta.url));
const rootArgIndex = process.argv.indexOf("--root");
const projectArgIndex = process.argv.indexOf("--project");
const projectRoot = projectArgIndex >= 0
  ? process.argv[projectArgIndex + 1]
  : rootArgIndex >= 0
    ? process.argv[rootArgIndex + 1]
    : path.resolve(toolRoot, "../..");
const portArgIndex = process.argv.indexOf("--port");
const vitePort = portArgIndex >= 0 ? Number(process.argv[portArgIndex + 1]) : 8787;
const apiPort = vitePort + 1;
const bridgePortArgIndex = process.argv.indexOf("--bridge-port");
const bridgePort = bridgePortArgIndex >= 0 ? Number(process.argv[bridgePortArgIndex + 1]) : 8791;
const adapterArgIndex = process.argv.indexOf("--adapter");
const adapterId = adapterArgIndex >= 0 ? process.argv[adapterArgIndex + 1] : "nocturnel";
const runtimeDirArgIndex = process.argv.indexOf("--runtime-dir");
const runtimeDir = runtimeDirArgIndex >= 0 ? process.argv[runtimeDirArgIndex + 1] : ".data-editor/runtime";
const logsDirArgIndex = process.argv.indexOf("--logs-dir");
const logsDir = logsDirArgIndex >= 0 ? process.argv[logsDirArgIndex + 1] : ".data-editor/logs";
const registryHomeArgIndex = process.argv.indexOf("--registry-home");
const registryHome = registryHomeArgIndex >= 0 ? process.argv[registryHomeArgIndex + 1] : null;
const runtimeToolRootArgIndex = process.argv.indexOf("--tool-root");
const runtimeToolRoot = runtimeToolRootArgIndex >= 0 ? process.argv[runtimeToolRootArgIndex + 1] : toolRoot;
const background = isBackgroundDevProcess(process.env);
const childSpawnOptions = buildDevChildSpawnOptions(background);

const api = spawn(
  process.execPath,
  [
    "server.mjs",
    "--project",
    projectRoot,
    "--port",
    String(apiPort),
    "--tool-root",
    runtimeToolRoot,
    "--bridge-port",
    String(bridgePort),
    "--adapter",
    adapterId,
    ...(registryHome ? ["--registry-home", registryHome] : []),
    "--runtime-dir",
    runtimeDir,
    "--logs-dir",
    logsDir,
  ],
  {
    cwd: toolRoot,
    ...childSpawnOptions,
  },
);

const viteBin = path.resolve(toolRoot, "node_modules/vite/bin/vite.js");
const vite = spawn(process.execPath, [viteBin, "--host", "127.0.0.1", "--port", String(vitePort)], {
  cwd: toolRoot,
  env: { ...process.env, DATA_EDITOR_API_PORT: String(apiPort), DATA_EDITOR_VITE_PORT: String(vitePort) },
  ...childSpawnOptions,
});

let shuttingDown = false;
let shutdownTimer = null;
let remainingChildren = 2;
let finalizing = false;

for (const child of [api, vite]) {
  child.on("exit", (code, signal) => {
    remainingChildren -= 1;
    if (!shuttingDown) {
      shuttingDown = true;
      process.exitCode = code ?? (signal ? 1 : 0);
      requestShutdown(child);
    }
    if (remainingChildren <= 0) {
      void finalizeAndExit(process.exitCode ?? 0);
    }
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.exitCode = 0;
    requestShutdown(null, signal);
  });
}

function requestShutdown(originChild = null, signal = "SIGTERM") {
  stopChild(api, originChild === api ? null : signal);
  stopChild(vite, originChild === vite ? null : signal);
  armShutdownTimer();
}

function stopChild(child, signal) {
  if (!child || child.killed) return;
  try {
    if (signal) child.kill(signal);
  } catch {}
}

function armShutdownTimer() {
  if (shutdownTimer) return;
  shutdownTimer = setTimeout(() => {
    stopChild(api, "SIGKILL");
    stopChild(vite, "SIGKILL");
  }, 5000);
  shutdownTimer.unref?.();
}

function clearShutdownTimer() {
  if (!shutdownTimer) return;
  clearTimeout(shutdownTimer);
  shutdownTimer = null;
}

async function finalizeAndExit(code) {
  if (finalizing) return;
  finalizing = true;
  clearShutdownTimer();
  await clearServiceStateIfOwned(createProjectContext({
    projectRoot,
    adapterId,
    runtimeDir,
    logsDir,
  }), process.pid).catch(() => {});
  process.exit(code);
}
