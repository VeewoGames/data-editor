import { execFile, spawn } from "node:child_process";
import path from "node:path";

const WINDOWS_DETACHED_FLAGS = 0x00000008 | 0x00000200 | 0x00000400;

export async function spawnPersistentProcess(command, args = [], options = {}, deps = {}) {
  const platform = deps.platform ?? process.platform;
  if (platform === "win32") {
    return spawnWindowsPersistentProcess(command, args, options, deps);
  }

  const child = (deps.spawnImpl ?? spawn)(command, args, {
    cwd: options.cwd,
    detached: true,
    env: options.env,
    shell: false,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  return { pid: child.pid, child };
}

export async function spawnWindowsPersistentProcess(command, args = [], options = {}, deps = {}) {
  const payload = Buffer.from(
    JSON.stringify({
      commandLine: buildWindowsCommandLine(command, args),
      cwd: path.win32.resolve(options.cwd ?? process.cwd()),
    }),
    "utf8",
  ).toString("base64");
  const encodedCommand = Buffer.from(buildWindowsBrokerScript(payload), "utf16le").toString("base64");
  const powershellPath = resolveWindowsPowerShell(options.env ?? process.env);
  const { stdout, stderr } = await execFileText(
    deps.execFileImpl ?? execFile,
    powershellPath,
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encodedCommand],
    {
      env: options.env,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    },
  );

  let result;
  try {
    result = JSON.parse(lastNonEmptyLine(stdout));
  } catch (error) {
    const detail = [stderr, stdout].map((value) => String(value ?? "").trim()).filter(Boolean).join("\n");
    throw new Error(`Windows process broker returned an invalid response${detail ? `: ${detail}` : "."}`, { cause: error });
  }

  const returnValue = Number(result?.returnValue);
  const pid = Number(result?.processId);
  if (returnValue !== 0 || !Number.isInteger(pid) || pid <= 0) {
    throw new Error(`Windows process broker failed with return value ${Number.isFinite(returnValue) ? returnValue : "unknown"}.`);
  }
  return { pid, child: null };
}

export function buildWindowsCommandLine(command, args = []) {
  return [command, ...args].map(quoteWindowsCommandLineArgument).join(" ");
}

export function quoteWindowsCommandLineArgument(value) {
  const text = String(value);
  if (text && !/[\s"]/u.test(text)) return text;

  let quoted = '"';
  let backslashes = 0;
  for (const character of text) {
    if (character === "\\") {
      backslashes += 1;
      continue;
    }
    if (character === '"') {
      quoted += "\\".repeat(backslashes * 2 + 1) + '"';
      backslashes = 0;
      continue;
    }
    quoted += "\\".repeat(backslashes) + character;
    backslashes = 0;
  }
  return quoted + "\\".repeat(backslashes * 2) + '"';
}

export function buildWindowsBrokerScript(payload) {
  return [
    "$ErrorActionPreference = 'Stop'",
    `$payload = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json`,
    "$startup = ([wmiclass]'Win32_ProcessStartup').CreateInstance()",
    "$startup.ShowWindow = 0",
    `$startup.CreateFlags = ${WINDOWS_DETACHED_FLAGS}`,
    "$startup.EnvironmentVariables = [string[]]([Environment]::GetEnvironmentVariables().GetEnumerator() | ForEach-Object { '{0}={1}' -f $_.Key, $_.Value })",
    "$result = ([wmiclass]'Win32_Process').Create([string]$payload.commandLine, [string]$payload.cwd, $startup)",
    "[pscustomobject]@{ returnValue = [int]$result.ReturnValue; processId = [int]$result.ProcessId } | ConvertTo-Json -Compress",
  ].join("\n");
}

export function resolveWindowsPowerShell(env = process.env) {
  const systemRoot = env.SystemRoot || env.SYSTEMROOT || "C:\\Windows";
  return path.win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

function execFileText(execFileImpl, file, args, options) {
  return new Promise((resolve, reject) => {
    execFileImpl(file, args, options, (error, stdout, stderr) => {
      if (error) {
        const detail = String(stderr ?? stdout ?? "").trim();
        reject(new Error(`Windows process broker could not start${detail ? `: ${detail}` : "."}`, { cause: error }));
        return;
      }
      resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
    });
  });
}

function lastNonEmptyLine(value) {
  return String(value ?? "").split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).at(-1) ?? "";
}
