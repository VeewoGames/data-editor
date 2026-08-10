import path from "node:path";
import { spawnSync } from "node:child_process";
import { claimFencingAdmission, classifyRecoveryCommand, finalizeClaimedRecovery, inspectFencingRecovery, recoverClaim, releaseClaimedAdmission, writeCompletedRecoveryRecord } from "../src/entry-action-recovery.mjs";
import { createProjectContext } from "../src/project-context.mjs";
import { publishEntryActionResultIdempotently, readEntryActionResult, readEntryActionStarted } from "../src/entry-actions.mjs";
import { recoverProposalOnlyEntryActionGroup } from "../src/entry-action-service.mjs";
import { recoverCandidateCreate } from "../src/entry-action-candidate-create-service.mjs";
import { loadAutomationProfile, ruleAuthorityDigest } from "../src/automation-profile.mjs";
import { assertEntryActionResultPolicies, loadEntryActionContracts, resolveEntryActionContract } from "../src/entry-action-contracts.mjs";
import { findAutomationEntryAction } from "../src/entry-actions.mjs";
import { recoverDurableEntryActionOperation } from "../src/entry-action-durable-recovery.mjs";
const args = process.argv.slice(2); const [command] = args;
const value = (name) => { const i=args.indexOf(name); return i < 0 ? null : args[i+1] ?? null; };
const project = value("--project"), runId = value("--run-id");
if (!project || !runId || !["inspect", "recover"].includes(command)) fail(2, "RECOVERY_ARGUMENT_INVALID");
const projectContext = createProjectContext(path.resolve(project));
// Keep recovery on the same durable fencing root used by the HTTP route.
const stateRoot = path.join(projectContext.projectRoot, projectContext.runtimeDir, "entry-action-fencing");
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
    result = await finishClaimedRecovery({ claim, inspection, claimedInspection });
  }
}
else if (inspection.decision !== "releasable") result = classifyRecoveryCommand({ inspection });
else {
  const claim = await claimFencingAdmission({ stateRoot, lease: inspection.lease }).catch((error) => ({ error }));
  if (claim.error) result = { exitCode: 2, decision: "error", reasonCode: claim.error.message === "RECOVERY_ADMISSION_SUPERSEDED" ? "RECOVERY_TARGET_ABSENT_UNPROVEN" : "RECOVERY_CLAIM_UNAVAILABLE", released: false };
  else {
    const claimedInspection = await inspectFencingRecovery({ stateRoot, runId, processIdentity, allowClaimedInspection: true }).catch(() => ({ decision: "error", reasonCode: "RECOVERY_STATE_UNREADABLE", released: false }));
    result = await finishClaimedRecovery({ claim, inspection, claimedInspection });
  }
}
process.stdout.write(`${JSON.stringify(result)}\n`); process.exitCode = result.exitCode;
function fail(code, reasonCode) { process.stdout.write(`${JSON.stringify({ exitCode: code, decision: "error", reasonCode, released: false })}\n`); process.exit(code); }
function inspectResult(value) {
  if (value.decision === "error") return { exitCode: 2, ...value };
  if (value.decision === "completed") return { exitCode: 0, ...value };
  return { exitCode: 0, ...value };
}
async function finishClaimedRecovery({ claim, inspection, claimedInspection }) {
  if (claimedInspection.decision !== "releasable") return classifyRecoveryCommand({ inspection: claimedInspection });
  let groupRecovery;
  const terminalResult = await readEntryActionResult(projectContext, runId).catch(() => null);
  if (terminalResult?.phase === "terminal") {
    groupRecovery = { recovered: false, skipped: "terminal_result_exists" };
  } else {
    try {
      const started = await readEntryActionStarted(projectContext, runId).catch(() => null);
      groupRecovery = await recoverDurableEntryActionOperation({ started, recoverCandidate: () => recoverCandidateCreate({
          projectContext, runId, idempotencyKey: started.idempotencyKey, recoveryLease: inspection.lease,
          verifyAuthority: async (expected) => {
            const [profile, registry] = await Promise.all([loadAutomationProfile(projectContext), loadEntryActionContracts(projectContext)]);
            const action = findAutomationEntryAction(profile, started.actionId);
            const contract = resolveEntryActionContract(registry, action.contractId);
            if (ruleAuthorityDigest(action) !== expected.ruleDigest || contract.createAuthority?.digest !== expected.createContractDigest || expected.candidateId !== started.candidateId) throw Object.assign(new Error("CANDIDATE_CREATE_AUTHORITY_STALE"), { code: "CANDIDATE_CREATE_AUTHORITY_STALE" });
            assertEntryActionResultPolicies(contract, { textArtifact: expected.textArtifact, evidence: expected.evidence });
          },
          publishResultIdempotently: () => publishEntryActionResultIdempotently(projectContext, runId, { version: 2, runId, actionId: started.actionId, phase: "terminal", outcome: "completed_with_writeback", message: "Candidate create recovery completed.", operation: "candidate_create", candidateId: started.candidateId, idempotencyKey: started.idempotencyKey }),
        }), recoverProposal: () => recoverProposalOnlyEntryActionGroup({ projectContext, runId, recoveryLease: inspection.lease }) });
    } catch (error) {
      return { exitCode: 2, decision: "error", reasonCode: error?.code ?? "RECOVERY_GROUP_COMMIT_FAILED", released: false };
    }
  }
  const recovered = await recoverClaim({
    inspection: claimedInspection,
    releaseClaim: () => releaseClaimedAdmission(claim),
    writeCompletedRecord: async () => {
      const record = await writeCompletedRecoveryRecord({ stateRoot, ...inspection.lease });
      await finalizeClaimedRecovery(claim);
      return record;
    },
  });
  if (recovered.exitCode === 0 && !groupRecovery.recovered) {
    const started = await readEntryActionStarted(projectContext, runId).catch(() => null);
    if (started?.actionId) {
      await publishEntryActionResultIdempotently(projectContext, runId, {
        version: 2,
        runId,
        actionId: started.actionId,
        phase: "terminal",
        outcome: "failed",
        message: "自动化进程中断，恢复检查已安全释放任务占用。",
      });
    }
  }
  return recovered;
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
