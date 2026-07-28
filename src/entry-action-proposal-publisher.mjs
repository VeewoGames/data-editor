import path from "node:path";
import { mkdir } from "node:fs/promises";
import { atomicWrite } from "./atomic-file.mjs";
import { validateEntryActionProposal } from "./entry-action-proposal.mjs";

export async function publishEntryActionProposal({ directory, runId, exitCode, proposal }) {
  if (exitCode !== 0) throw Object.assign(new Error("Codex did not complete successfully; proposal is not published."), { code: "ENTRY_ACTION_PROPOSAL_NOT_ELIGIBLE" });
  const validated = validateEntryActionProposal(proposal);
  if (validated.runId !== runId) throw Object.assign(new Error("Proposal runId does not match the execution."), { code: "ENTRY_ACTION_PROPOSAL_INVALID" });
  await mkdir(directory, { recursive: true });
  const root = path.resolve(directory);
  const target = path.resolve(root, `${runId}.proposal.json`);
  if (!target.startsWith(`${root}${path.sep}`)) throw Object.assign(new Error("Proposal target escapes its isolated directory."), { code: "ENTRY_ACTION_PROPOSAL_INVALID" });
  await atomicWrite(target, `${JSON.stringify(validated, null, 2)}\n`);
  return { path: target, proposal: validated };
}
