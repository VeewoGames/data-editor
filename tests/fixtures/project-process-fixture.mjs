// Generic real Node lifecycle fixture; copied into isolated project roots.
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import crypto from "node:crypto";
import net from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
const args = process.argv.slice(2), root = await fs.realpath(args[args.indexOf("--project-root") + 1]);
const file = path.join(root, "instance.json");
const guard = `\\\\.\\pipe\\data-editor-fixture-${crypto.createHash("sha256").update(root).digest("hex")}`;
async function identify(pid) {
  const script = `$p=Get-CimInstance Win32_Process -Filter "ProcessId=${pid}";if($p){@{pid=$p.ProcessId;started=$p.CreationDate.ToUniversalTime().ToString('o');command=$p.CommandLine}|ConvertTo-Json -Compress}`;
  const { stdout } = await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 3000 });
  return stdout.trim() ? JSON.parse(stdout) : null;
}
async function read(file) { try { return JSON.parse(await fs.readFile(file, "utf8")); } catch (error) { if (error.code === "ENOENT") return null; throw error; } }
async function status() {
  const instance = await read(file);
  const identity = instance ? await identify(instance.pid) : null;
  if (!identity) return { protocolVersion: 1, state: "stopped", instance: null };
  if (identity.started !== instance.started || !identity.command.includes(instance.nonce)) return { protocolVersion: 1, state: "unknown", instance: null, error: "fixture identity mismatch" };
  return { protocolVersion: 1, state: instance.phase === "ready" ? "running" : "starting", instance };
}
if (args.includes("--status")) {
  const behavior = await read(path.join(root, "behavior.json"));
  if (behavior?.queryFailure) throw Error("fixture status failure");
  const result = await status();
  if (behavior?.fakeIdentity && result.instance) result.instance.started = "2000-01-01T00:00:00Z";
  process.stdout.write(`${JSON.stringify(result)}\n`);
} else if (args.includes("--stop")) {
  const behavior = await read(path.join(root, "behavior.json"));
  if (behavior?.stopFailure) throw Error("fixture stop failure");
  const current = await status();
  if (current.state === "unknown") throw Error("fixture stop identity mismatch");
  if (current.instance) {
    process.kill(current.instance.pid, "SIGTERM");
    const deadline = Date.now() + 3000;
    while (await identify(current.instance.pid)) { if (Date.now() > deadline) throw Error("fixture stop timeout"); await new Promise(r => setTimeout(r, 50)); }
  }
} else if (args.includes("--watch")) {
  const server = net.createServer(socket => socket.destroy());
  const acquired = await new Promise((resolve, reject) => { server.once("error", error => error.code === "EADDRINUSE" ? resolve(false) : reject(error)); server.listen(guard, () => resolve(true)); });
  if (acquired) {
    const identity = await identify(process.pid);
    const instance = { protocolVersion: 1, phase: "starting", pid: process.pid, projectRoot: root,
      script: await fs.realpath(fileURLToPath(import.meta.url)), cwd: process.cwd(), nonce: args[args.indexOf("--nonce") + 1],
      started: identity.started, mode: "--watch", ownerToken: crypto.randomUUID() };
    const publish = async () => { const tmp = `${file}.${crypto.randomUUID()}.tmp`; await fs.writeFile(tmp, JSON.stringify(instance)); await fs.rename(tmp, file); };
    await publish();
    const behavior = await read(path.join(root, "behavior.json"));
    if (behavior?.exitBeforeReady) process.exit(7);
    await new Promise(r => setTimeout(r, behavior?.readyDelayMs ?? 0));
    instance.phase = "ready"; await publish();
    await fs.writeFile(path.join(root, "starts.log"), `${instance.ownerToken}\n`, { flag: "a" });
    // The persistent pipe owns fixture lifetime. No shared Editor or project data.
    process.on("SIGTERM", () => server.close(() => process.exit(0)));
  }
} else throw Error("fixture action invalid");
