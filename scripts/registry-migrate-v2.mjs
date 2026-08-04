import crypto from "node:crypto";
import { execFile } from "node:child_process";
import path from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { atomicWrite, exclusiveCreateLock } from "../src/atomic-file.mjs";
import { migrateProjectRegistryV1, projectRegistryPath } from "../src/project-registry.mjs";

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.registryHome) throw new Error("--registry-home is required.");
  const target = projectRegistryPath({ home: path.resolve(args.registryHome) });
  const result = await migrateRegistryV2(target);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

export async function migrateRegistryV2(target) {
  const resolvedTarget = path.resolve(target);
  await assertRegistryQuiescent(resolvedTarget);
  const initial = await readRegistryBytes(resolvedTarget);
  if (!initial) return { status: "not_applicable", target: resolvedTarget };
  const initialHash = hashBytes(initial);
  const initialRegistry = parseRegistry(initial);
  if (initialRegistry.version === 2) return { status: "already_v2", target: resolvedTarget, sourceHash: initialHash };
  const lock = `${resolvedTarget}.migrate-v2.lock`;
  await exclusiveCreateLock(lock, {
    createdAt: new Date().toISOString(),
    sourceHash: initialHash,
    fromVersion: initialRegistry.version,
    toVersion: 2,
  });
  try {
    const source = await readRegistryBytes(resolvedTarget);
    if (!source) throw sourceChangedDuringMigration(resolvedTarget, initialHash, null);
    const sourceHash = hashBytes(source);
    if (sourceHash !== initialHash) throw sourceChangedDuringMigration(resolvedTarget, initialHash, sourceHash);
    const parsed = parseRegistry(source);
    const candidate = migrateProjectRegistryV1(parsed);
    const backup = `${resolvedTarget}.v1-${Date.now()}-${sourceHash.slice(0, 12)}.bak`;
    await mkdir(path.dirname(resolvedTarget), { recursive: true });
    await writeFile(backup, source, { flag: "wx" });
    const serialized = `${JSON.stringify(candidate, null, 2)}\n`;
    await atomicWrite(resolvedTarget, serialized);
    const written = await readRegistryBytes(resolvedTarget);
    if (!written || hashBytes(written) !== hashBytes(Buffer.from(serialized, "utf8"))) {
      throw new Error(`Registry migration verification failed: ${resolvedTarget}`);
    }
    return { status: "migrated", target: resolvedTarget, backup, sourceHash, fromVersion: 1, toVersion: 2 };
  } finally {
    await rm(lock, { force: true }).catch(() => {});
  }
}

export async function assertRegistryQuiescent(target, dependencies = {}) {
  const registryHome = path.dirname(path.resolve(target));
  const statePaths = ["service.json", "controller.json", "recovery-bridge.json"]
    .map((name) => path.join(registryHome, "runtime", name));
  const residualStates = [];
  for (const statePath of statePaths) {
    if (await readRegistryBytes(statePath)) residualStates.push(statePath);
  }
  const processes = await (dependencies.listNodeProcesses ?? listNodeProcesses)();
  const activeProcesses = processes.filter((processInfo) => usesRegistryHome(processInfo.commandLine, registryHome));
  if (residualStates.length || activeProcesses.length) {
    throw Object.assign(new Error(`Registry migration requires a quiescent runtime: ${registryHome}`), {
      code: "PROJECT_REGISTRY_MIGRATION_NOT_QUIESCENT",
      registryHome,
      residualStates,
      activeProcesses: activeProcesses.map(({ pid, commandLine }) => ({ pid, commandLine })),
      remediation: "Run npm run stop with this registry home, resolve any remaining state or process owner, then retry migration.",
    });
  }
}

async function readRegistryBytes(target) {
  try { return await readFile(target); }
  catch (error) { if (error?.code === "ENOENT") return null; throw error; }
}

function parseRegistry(bytes) {
  return JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
}

function hashBytes(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function sourceChangedDuringMigration(target, expectedSourceHash, actualSourceHash) {
  return Object.assign(new Error(`Registry source changed during migration: ${target}`), {
    code: "PROJECT_REGISTRY_MIGRATION_SOURCE_CHANGED",
    expectedSourceHash,
    actualSourceHash,
  });
}

async function listNodeProcesses() {
  if (process.platform !== "win32") return [];
  const command = [
    "Get-CimInstance Win32_Process",
    "| Where-Object { $_.Name -eq 'node.exe' }",
    "| Select-Object ProcessId,CommandLine",
    "| ConvertTo-Json -Compress",
  ].join(" ");
  const { stdout } = await promisify(execFile)("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (!stdout.trim()) return [];
  const rows = JSON.parse(stdout);
  return (Array.isArray(rows) ? rows : [rows]).map((row) => ({
    pid: Number(row.ProcessId),
    commandLine: String(row.CommandLine ?? ""),
  }));
}

function usesRegistryHome(commandLine, registryHome) {
  const command = String(commandLine ?? "");
  if (!/(?:^|[\\/ ])(?:server|dev|recovery-bridge)\.mjs(?:$|[\\/ ])/i.test(command)) return false;
  const match = /--registry-home(?:\s+|=)(?:"([^"]+)"|'([^']+)'|(\S+))/i.exec(command);
  const value = match?.[1] ?? match?.[2] ?? match?.[3];
  return Boolean(value) && path.resolve(value).toLowerCase() === path.resolve(registryHome).toLowerCase();
}

function parseArgs(argv) {
  const index = argv.indexOf("--registry-home");
  if (index < 0 || !argv[index + 1] || argv.length !== 2) return { registryHome: null };
  return { registryHome: argv[index + 1] };
}
