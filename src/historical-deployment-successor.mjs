// Tool-delivery authority, never a project/request-selected verification mode.
// Hash pins detect drift; they are not signatures against a same-account writer.
import crypto from 'node:crypto';
import path from 'node:path';
import { readFile, realpath } from 'node:fs/promises';
import { historyDeploymentFile, historyPhysicalKey } from './historical-deployment.mjs';

export const successorContract = 'managed-deployment-successor-v1';
export const deploymentDigest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const stable = value => JSON.stringify(value);
const bad = () => { throw Object.assign(new Error('HISTORY_SUCCESSOR_INVALID'), { code: 'HISTORY_SUCCESSOR_INVALID', status: 409 }); };
const keys = (value, fields) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === fields.split(',').sort().join(',');
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export function artifactReference(bytes, kind) {
  const digest = deploymentDigest(bytes);
  return { path: `historical-deployment-upgrades/${digest}.${kind}.json`, digest };
}

export async function readDeploymentArtifact(ref, kind) {
  if (!keys(ref, 'path,digest') || !hash(ref.digest) || ref.path !== `historical-deployment-upgrades/${ref.digest}.${kind}.json`) bad();
  const expected = path.join(path.dirname(historyDeploymentFile), ref.path);
  let bytes;
  try {
    // Reject aliases/symlinks, even ones pointing elsewhere within the delivery.
    if (historyPhysicalKey(await realpath(expected)) !== historyPhysicalKey(expected)) bad();
    bytes = await readFile(expected);
  } catch { bad(); }
  if (deploymentDigest(bytes) !== ref.digest) bad();
  return bytes;
}

export function sourceEntryFor(snapshotBytes, binding) {
  let config;
  try { config = JSON.parse(snapshotBytes.toString('utf8')); } catch { bad(); }
  if (!keys(config, 'version,entries') || config.version !== 1 || !Array.isArray(config.entries)) bad();
  const entries = config.entries.filter(entry => entry.projectRoot === binding.root);
  const entry = entries[0];
  if (entries.length !== 1 || !entry || entry.runtime !== binding.runtime || entry.anchorId !== binding.expectedAnchorId || !entry.managedNonReplay) bad();
  const policy = entry.managedNonReplay;
  if (!keys(policy, 'contract,businessFiles,deploymentFiles') || policy.contract !== 'managed-entry-non-replay-v1'
    || !Array.isArray(policy.businessFiles) || !Array.isArray(policy.deploymentFiles) || !policy.deploymentFiles.length
    || stable(policy.businessFiles) !== stable(binding.policy.businessFiles) || policy.contract !== binding.policy.contract
    || policy.deploymentFiles.some(file => !keys(file, 'path,digest') || !hash(file.digest) || typeof file.path !== 'string')) bad();
  return entry;
}

// Called unconditionally by readLedger for upgraded deployments: an empty
// records object must never bypass receipt validation and reopen historical runs.
export async function validateSuccessorLedger(binding, state, ledgerBytes) {
  if (!binding.deploymentSuccessor) return null;
  let certificate;
  try { certificate = JSON.parse((await readDeploymentArtifact(binding.deploymentSuccessor, 'certificate')).toString('utf8')); } catch { bad(); }
  if (!keys(certificate, 'version,contract,root,runtime,anchorId,ledgerDigest,receipts,sourceSnapshot,sourcePolicyDigest,targetPolicyDigest')
    || certificate.version !== 1 || certificate.contract !== successorContract
    || certificate.root !== binding.root || certificate.runtime !== binding.runtime || certificate.anchorId !== binding.expectedAnchorId
    || !hash(certificate.ledgerDigest) || certificate.ledgerDigest !== deploymentDigest(ledgerBytes)
    || certificate.targetPolicyDigest !== deploymentDigest(stable(binding.policy))
    || !Array.isArray(certificate.receipts) || !certificate.receipts.length) bad();
  const source = sourceEntryFor(await readDeploymentArtifact(certificate.sourceSnapshot, 'snapshot'), binding);
  const origin = deploymentDigest(stable(source.managedNonReplay));
  if (certificate.sourcePolicyDigest !== origin) bad();
  const records = Object.values(state.records);
  if (records.length !== certificate.receipts.length || new Set(certificate.receipts.map(pin => pin.runId)).size !== records.length) bad();
  for (const record of records) {
    const pin = certificate.receipts.find(pin => pin.runId === record.runId);
    if (!keys(pin, 'runId,recordDigest,evidenceDigest') || record.phase !== 'receipt'
      || record.contract !== 'managed-entry-non-replay-v1' || pin.recordDigest !== deploymentDigest(stable(record))
      || pin.evidenceDigest !== record.evidenceDigest || record.evidence?.deploymentDigest !== origin) bad();
  }
  return certificate;
}
