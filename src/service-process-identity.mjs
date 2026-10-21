import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
let ownIdentity;

// PID alone is insufficient: an OS may reuse it after the writer crashes.
export async function readServiceProcessIdentity(pid = process.pid) {
  if (!Number.isSafeInteger(Number(pid)) || Number(pid) < 1) return null;
  if (process.platform === "win32") {
    const script = `try { $p=[Diagnostics.Process]::GetProcessById(${Number(pid)}); [Console]::Out.Write($p.StartTime.ToUniversalTime().ToFileTimeUtc().ToString([Globalization.CultureInfo]::InvariantCulture)) } catch [System.ArgumentException] { [Console]::Out.Write('ABSENT') } catch { [Console]::Out.Write('ERROR') }`;
    const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", windowsHide: true });
    const value = result.stdout?.trim();
    if (value === "ABSENT") return false;
    return !result.error && result.status === 0 && /^\d+$/.test(value ?? "") ? { pid: String(pid), creationTime: value } : null;
  }
  if (process.platform === "linux") {
    try {
      const text = await readFile(`/proc/${pid}/stat`, "utf8");
      const boot = (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim();
      return { pid: String(pid), creationTime: `${boot}:${text.slice(text.lastIndexOf(")") + 2).split(" ")[19]}` };
    } catch (error) { return error.code === "ENOENT" ? false : null; }
  }
  return null;
}
export async function serviceProcessIsAlive(expected) {
  if (!expected || !/^\d+$/.test(expected.pid ?? "") || typeof expected.creationTime !== "string") return null;
  const current = Number(expected.pid) === process.pid
    ? await (ownIdentity ??= readServiceProcessIdentity())
    : await readServiceProcessIdentity(Number(expected.pid));
  if (current === false) return false;
  if (!current) return null;
  return current.creationTime === expected.creationTime;
}
