import path from "node:path";
import { spawnSync } from "node:child_process";
import { claimFencingAdmission, classifyRecoveryCommand, finalizeClaimedRecovery, inspectFencingRecovery, recoverClaim, releaseClaimedAdmission, writeCompletedRecoveryRecord } from "../src/entry-action-recovery.mjs";
const args = process.argv.slice(2); const [command] = args;
const value = (name) => { const i=args.indexOf(name); return i < 0 ? null : args[i+1] ?? null; };
const project = value("--project"), runId = value("--run-id");
if (!project || !runId || !["inspect", "recover"].includes(command)) fail(2, "RECOVERY_ARGUMENT_INVALID");
const stateRoot = path.join(path.resolve(project), ".data-editor", "runtime", "entry-actions", "fencing");
const inspection = await inspectFencingRecovery({ stateRoot, runId, processIdentity }).catch(() => ({ decision: "error", reasonCode: "RECOVERY_STATE_UNREADABLE", released: false }));
let result;
if (command === "inspect") result = inspectResult(inspection);
else if (inspection.decision === "completed") {
  try {
    const claim = await claimFencingAdmission({ stateRoot, lease: inspection.lease });
    await finalizeClaimedRecovery(claim);
    result = classifyRecoveryCommand({ inspection });
  } catch (error) {
    result = error?.message === "RECOVERY_ADMISSION_SUPERSEDED"
      ? classifyRecoveryCommand({ inspection })
      : { exitCode: 2, decision: "error", reasonCode: "RECOVERY_CLAIM_UNAVAILABLE", released: false };
  }
}
else if (inspection.reasonCode === "RECOVERY_CLAIM_IN_PROGRESS") {
  const claim = await claimFencingAdmission({ stateRoot, lease: inspection.lease }).catch((error) => ({ error }));
  if (claim.error) result = { exitCode: 2, decision: "error", reasonCode: "RECOVERY_CLAIM_UNAVAILABLE", released: false };
  else {
    const claimedInspection = await inspectFencingRecovery({ stateRoot, runId, processIdentity, allowClaimedInspection: true }).catch(() => ({ decision: "error", reasonCode: "RECOVERY_STATE_UNREADABLE", released: false }));
    result = await recoverClaim({ inspection: claimedInspection, releaseClaim: () => releaseClaimedAdmission(claim), writeCompletedRecord: async () => { const record = await writeCompletedRecoveryRecord({ stateRoot, ...inspection.lease }); await finalizeClaimedRecovery(claim); return record; } });
  }
}
else if (inspection.decision !== "releasable") result = classifyRecoveryCommand({ inspection });
else {
  const claim = await claimFencingAdmission({ stateRoot, lease: inspection.lease }).catch((error) => ({ error }));
  if (claim.error) result = { exitCode: 2, decision: "error", reasonCode: claim.error.message === "RECOVERY_ADMISSION_SUPERSEDED" ? "RECOVERY_TARGET_ABSENT_UNPROVEN" : "RECOVERY_CLAIM_UNAVAILABLE", released: false };
  else {
    const claimedInspection = await inspectFencingRecovery({ stateRoot, runId, processIdentity, allowClaimedInspection: true }).catch(() => ({ decision: "error", reasonCode: "RECOVERY_STATE_UNREADABLE", released: false }));
    result = await recoverClaim({ inspection: claimedInspection, releaseClaim: () => releaseClaimedAdmission(claim), writeCompletedRecord: async () => { const record = await writeCompletedRecoveryRecord({ stateRoot, ...inspection.lease }); await finalizeClaimedRecovery(claim); return record; } });
  }
}
process.stdout.write(`${JSON.stringify(result)}\n`); process.exitCode = result.exitCode;
function fail(code, reasonCode) { process.stdout.write(`${JSON.stringify({ exitCode: code, decision: "error", reasonCode, released: false })}\n`); process.exit(code); }
function inspectResult(value) {
  if (value.decision === "error") return { exitCode: 2, ...value };
  if (value.decision === "completed") return { exitCode: 0, ...value };
  return { exitCode: 0, ...value };
}
function processIdentity(helper, child) {
  const observed = [readIdentity(helper), readIdentity(child)];
  if (observed.every((value) => value === "absent")) return false;
  if (observed.every((value, index) => value && value.pid === [helper, child][index].pid && value.creationFileTime === [helper, child][index].creationFileTime)) return true;
  return null;
}
function readIdentity(expected) {
  if (process.platform !== "win32") return null;
  const script = `try { $p=[Diagnostics.Process]::GetProcessById(${expected.pid}); [Console]::Out.Write($p.StartTime.ToUniversalTime().ToFileTimeUtc().ToString([Globalization.CultureInfo]::InvariantCulture)) } catch [System.ArgumentException] { [Console]::Out.Write('ABSENT') } catch { [Console]::Out.Write('ERROR') }`;
  const child = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", windowsHide: true });
  const output = child.stdout?.trim();
  if (child.error || child.status !== 0 || output === "ERROR" || !/^(?:0|[1-9][0-9]*)$/.test(output ?? "")) return output === "ABSENT" ? "absent" : null;
  return { pid: expected.pid, creationFileTime: output };
}
