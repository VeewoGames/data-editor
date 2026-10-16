import { execFile } from "node:child_process";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
export const sameProcessPath = (a, b) => process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
const within = (root, file) => { const relative = path.relative(root, file); return !relative || (!relative.startsWith("..") && !path.isAbsolute(relative)); };

export async function projectProcessResource(root, relative, { allowMissing = false } = {}) {
  if (typeof relative !== "string" || !relative || path.isAbsolute(relative)) throw Error("PROCESS_PATH_INVALID");
  const file = path.resolve(root, relative);
  if (!within(root, file)) throw Error("PROCESS_PATH_ESCAPE");
  let ancestor = file;
  while (true) {
    try {
      const resolved = await realpath(ancestor);
      if (!within(root, resolved)) throw Error("PROCESS_PATH_ESCAPE");
      return ancestor === file ? resolved : file;
    } catch (error) {
      if (!allowMissing || error.code !== "ENOENT" || ancestor === root) throw error;
      ancestor = path.dirname(ancestor);
    }
  }
}

export async function inspectProjectProcess(pid = null, { timeoutMs = 3000 } = {}) {
  if (process.platform !== "win32") throw Error("PROCESS_PLATFORM_UNSUPPORTED");
  if (pid !== null && (!Number.isInteger(pid) || pid < 1)) throw Error("PROCESS_PID_INVALID");
  const filter = pid === null ? "Name='node.exe'" : `ProcessId=${pid}`;
  const script = `[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); $items=@(Get-CimInstance Win32_Process -Filter \"${filter}\"); @($items|ForEach-Object {@{pid=$_.ProcessId;command=$_.CommandLine;executable=$_.ExecutablePath;started=$_.CreationDate.ToUniversalTime().ToString('o')}})|ConvertTo-Json -Compress`;
  const { stdout } = await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, shell: false, timeout: Math.min(3000, timeoutMs), maxBuffer: 1024 * 1024 });
  const parsed = stdout.trim() ? JSON.parse(stdout) : [];
  const items = Array.isArray(parsed) ? parsed : [parsed];
  return pid === null ? items : items[0] ?? null;
}

// Windows argv parsing; unlike a shell tokenizer this handles escaped quotes
// and trailing backslashes in the actual OS command line.
export function processCommandArgs(command) {
  const tokens = []; let token = "", quoted = false, active = false;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (c === "\\") {
      let count = 1; while (command[i + 1] === "\\") { count++; i++; }
      if (command[i + 1] === '"') { token += "\\".repeat(Math.floor(count / 2)); i++; if (count % 2) token += '"'; else quoted = !quoted; }
      else token += "\\".repeat(count);
      active = true;
    } else if (c === '"') { quoted = !quoted; active = true; }
    else if (/\s/.test(c) && !quoted) { if (active) tokens.push(token); token = ""; active = false; }
    else { token += c; active = true; }
  }
  if (active) tokens.push(token);
  return tokens;
}

export async function matchesProjectProcessInstance(instance, identity, target) {
  if (!instance || !identity || instance.protocolVersion !== 1 || instance.pid !== identity.pid
    || instance.mode !== "--watch" || !["starting", "ready"].includes(instance.phase)
    || typeof instance.nonce !== "string" || instance.nonce.length < 20
    || typeof instance.ownerToken !== "string" || instance.ownerToken.length < 20
    || instance.started !== identity.started || typeof instance.cwd !== "string"
    || !sameProcessPath(instance.projectRoot ?? "", target.root) || !sameProcessPath(instance.script ?? "", target.entry)) return false;
  const args = processCommandArgs(identity.command ?? "");
  if (args.length !== 7 || args[2] !== "--watch" || args[3] !== "--project-root" || args[5] !== "--nonce" || args[6] !== instance.nonce) return false;
  try {
    return sameProcessPath(await realpath(identity.executable), await realpath(process.execPath))
      && sameProcessPath(await realpath(path.resolve(instance.cwd, args[1])), target.entry)
      && sameProcessPath(await realpath(path.resolve(instance.cwd, args[4])), target.root);
  } catch { return false; }
}

export async function readProjectProcessInstance(target) {
  const file = await projectProcessResource(target.root, target.binding.instanceResource, { allowMissing: true });
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

async function orphanedInstance(target, inspect) {
  const identities = await inspect(null);
  for (const identity of identities) {
    const args = processCommandArgs(identity.command ?? "");
    if (args[2] !== "--watch" || args[3] !== "--project-root") continue;
    // Missing metadata has no trustworthy cwd, so only absolute paths can
    // establish an orphan. Relative command lines remain conservatively unknown.
    if (!path.isAbsolute(args[4] ?? "")) return true;
    try {
      if (!sameProcessPath(await realpath(args[4]), target.root)) continue;
      if (!path.isAbsolute(args[1] ?? "")) return true;
      if (sameProcessPath(await realpath(args[1]), target.entry) && sameProcessPath(await realpath(args[4]), target.root)) return true;
    } catch { /* Unrelated inaccessible process. */ }
  }
  return false;
}

export async function observeProjectProcess(target, { authorized, inspect = inspectProjectProcess, runStatus, deadline = null } = {}) {
  try {
    const remaining = () => {
      if (deadline === null) return undefined;
      const timeoutMs = deadline - Date.now();
      if (timeoutMs < 1) throw Error("PROCESS_START_DEADLINE_EXCEEDED");
      return timeoutMs;
    };
    const identify = pid => { const timeoutMs = remaining(); return inspect(pid, timeoutMs === undefined ? undefined : { timeoutMs }); };
    const instance = await readProjectProcessInstance(target);
    let observed;
    if (instance) {
      const identity = await identify(instance.pid);
      if (identity) {
        if (!await matchesProjectProcessInstance(instance, identity, target)) return { state: "unknown", error: "后台实例身份或协议不匹配，拒绝启停。" };
        observed = { state: instance.phase === "ready" ? "running" : "starting", instance };
      }
    }
    if (!observed) observed = await orphanedInstance(target, identify)
      ? { state: "unknown", error: "发现未能核对元数据的实例，拒绝启停。" }
      : { state: "stopped", instance: null };
    if (!authorized || !runStatus) return observed;
    const native = await runStatus(target, remaining());
    if (native.protocolVersion !== 1 || !["running", "stopped", "starting", "unknown"].includes(native.state)) throw Error("PROCESS_STATUS_PROTOCOL_INVALID");
    if (native.state === "unknown") return { state: "unknown", error: typeof native.error === "string" ? native.error : "项目无法确认后台实例状态。" };
    if (native.state === "stopped") {
      if (native.instance !== null || observed.state !== "stopped") throw Error("PROCESS_STATUS_IDENTITY_MISMATCH");
      return observed;
    }
    if (!await matchesProjectProcessInstance(native.instance, await identify(native.instance?.pid), target)
      || !observed.instance || native.instance.ownerToken !== observed.instance.ownerToken
      || native.instance.nonce !== observed.instance.nonce
      || (native.state === "running" && native.instance.phase !== "ready")
      || (native.state === "starting" && native.instance.phase !== "starting")) throw Error("PROCESS_STATUS_IDENTITY_MISMATCH");
    const current = await readProjectProcessInstance(target);
    if (current?.ownerToken !== native.instance.ownerToken || current?.nonce !== native.instance.nonce) throw Error("PROCESS_STATUS_INSTANCE_CHANGED");
    return { state: native.state, instance: native.instance };
  } catch (error) { return { state: "unknown", error: error.message }; }
}

export async function validateProjectProcessEntry(target) {
  target.entry = await projectProcessResource(target.root, target.binding.entry);
  if (!(await stat(target.entry)).isFile()) throw Error("PROCESS_ENTRY_NOT_FILE");
  await projectProcessResource(target.root, target.binding.instanceResource, { allowMissing: true });
}
