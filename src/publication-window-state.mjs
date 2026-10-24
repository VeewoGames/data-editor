import crypto from 'node:crypto';
import path from 'node:path';
import { mkdir, readFile, realpath } from 'node:fs/promises';
import { createProjectContext } from './project-context.mjs';
import { atomicWrite, exclusiveCreateLock } from './atomic-file.mjs';
import { withHistoryProjectLock,withHistoricalPublicationState } from './historical-disposition.mjs';
import { scanPublicationObligations } from './publication-window-obligations.mjs';
import { serviceProcessIsAlive } from './service-process-identity.mjs';
import { isTerminalEntryActionState } from './entry-action-state.mjs';

export const digest = value => crypto.createHash('sha256').update(value).digest('hex');
export function publicationError(code, message = code) { return Object.assign(new Error(message), { code, status: 409 }); }
export async function optionalJson(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return null; throw publicationError('PUBLICATION_STATE_UNVERIFIABLE'); }
}
async function physical(file) {
  let resolved;
  try { resolved = await realpath(file); }
  catch (e) { if (e.code !== 'ENOENT') throw e; resolved = path.join(await physical(path.dirname(file)), path.basename(file)); }
  const normalized = path.resolve(resolved).replaceAll('\\', '/');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}
export async function publicationBinding(input) {
  const context = createProjectContext(input);
  const root = await physical(context.projectRoot);
  const binding = { root, profile: await physical(context.automationProfilePath), contracts: await physical(path.join(context.projectRoot, '.data-editor/entry-action-contracts.json')), runtime: await physical(path.join(context.projectRoot, context.runtimeDir)) };
  const directory = path.join(root, '.data-editor/publication-admission');
  return { ...binding, key: digest(root), directory, anchor: path.join(directory, 'anchor.json'), file: path.join(directory, 'state.json') };
}
export async function readPublicationState(binding) {
  const [anchor, state] = await Promise.all([optionalJson(binding.anchor), optionalJson(binding.file)]);
  if (!anchor && !state) return null;
  if (!anchor || !state || anchor.schemaVersion !== 1 || state.schemaVersion !== 1 || state.anchorId !== anchor.anchorId
    || JSON.stringify(anchor.binding) !== JSON.stringify({ root: binding.root, profile: binding.profile, contracts: binding.contracts, runtime: binding.runtime })
    || !['OPEN','DRAINING','READY','DEPLOYING','VERIFYING','HELD'].includes(state.state)
    || !Number.isSafeInteger(state.revision) || !Number.isSafeInteger(state.generation)
    || !state.accepted || !state.continuations || !Array.isArray(state.package ?? [])) throw publicationError('PUBLICATION_STATE_UNVERIFIABLE');
  return state;
}
export async function mutatePublication(context, operation) {
  const binding = await publicationBinding(context);
  return withHistoryProjectLock(binding, async () => {
    const state = await readPublicationState(binding);
    const result = await withHistoricalPublicationState(context,()=>operation(state, binding));
    return result;
  });
}
export async function savePublicationState(binding, state) {
  state.revision += 1;
  await atomicWrite(binding.file, `${JSON.stringify(state, null, 2)}\n`);
  return structuredClone(state);
}
export async function inspectPublicationWindow(context) {
  const binding = await publicationBinding(context);
  const state = await readPublicationState(binding);
  return state ? structuredClone(state) : { managed: false, state: 'OPEN', revision: 0 };
}
// Explicit provisioning only. Ordinary inspection/admission never provisions a project.
export async function initializePublicationWindow(context) {
  return mutatePublication(context, async (existing, binding) => {
    if (existing) return existing;
    if ((await scanPublicationObligations(binding)).some(x=>x.blocking!==false)) throw publicationError('PUBLICATION_HISTORY_PENDING');
    await mkdir(binding.directory, { recursive: true });
    const anchorId = crypto.randomUUID();
    const identity = { root: binding.root, profile: binding.profile, contracts: binding.contracts, runtime: binding.runtime };
    await exclusiveCreateLock(binding.anchor, JSON.stringify({ schemaVersion: 1, anchorId, binding: identity }));
    // An interrupted provision leaves anchor without state and therefore fails closed.
    return savePublicationState(binding, { schemaVersion: 1, anchorId, generation: 0, revision: 0, state: 'OPEN', windowId: null, publisher: null, accepted: {}, continuations: {}, package: [] });
  });
}
async function packageSnapshot(binding, files) {
  const seen = new Set(), output = [];
  for (const entry of files) {
    if (typeof entry.path !== 'string' || entry.path.includes('\\') || path.posix.normalize(entry.path) !== entry.path || path.isAbsolute(entry.path) || entry.path.startsWith('../') || entry.path.includes(':') || entry.path.startsWith('.data-editor/publication-admission/')) throw publicationError('PUBLICATION_PACKAGE_INVALID');
    const file = await physical(path.join(binding.root, entry.path));
    if (!file.startsWith(`${binding.root}/`) || seen.has(file) || !/^[a-f0-9]{64}$/.test(entry.afterDigest)) throw publicationError('PUBLICATION_PACKAGE_INVALID');
    seen.add(file);
    let b; try { b = await readFile(file); } catch (e) { if (e.code !== 'ENOENT') throw e; b = null; }
    output.push({ path: entry.path, file, beforeDigest: b === null ? null : digest(b), afterDigest: entry.afterDigest });
  }
  if (!output.length) throw publicationError('PUBLICATION_PACKAGE_INVALID');
  return output;
}
export async function verifyPublicationPackage(state, mode) {
  for (const entry of state.package) {
    const physicalNow = await physical(entry.file);
    let b; try { b = await readFile(entry.file); } catch (e) { if (e.code !== 'ENOENT') throw e; b = null; }
    if (physicalNow !== entry.file || (b === null ? null : digest(b)) !== entry[`${mode}Digest`]) throw publicationError('PUBLICATION_PACKAGE_DRIFT');
  }
}
export async function closePublicationWindow(context, { publisher, files }) {
  if (typeof publisher !== 'string' || !publisher) throw publicationError('PUBLICATION_PUBLISHER_REQUIRED');
  return mutatePublication(context, async (state, binding) => {
    if (!state || state.state !== 'OPEN') throw publicationError('PUBLICATION_NOT_OPEN');
    state.package = await packageSnapshot(binding, files);
    state.state = 'DRAINING'; state.windowId = crypto.randomUUID(); state.publisher = publisher; state.restoreBefore = false;
    state.bundleDigest = digest(JSON.stringify(state.package)); state.failure = null;
    return savePublicationState(binding, state);
  });
}
export async function advancePublicationWindow(context, { windowId, revision, publisher, transition }) {
  return mutatePublication(context, async (state, binding) => {
    if (!state || state.windowId !== windowId || state.publisher !== publisher || state.revision !== revision) throw publicationError('PUBLICATION_OWNER_STALE');
    const transitions = { READY:['DRAINING'], DEPLOYING:['READY'], VERIFYING:['DEPLOYING','HELD'], OPEN:['VERIFYING'], ABORT:['DRAINING','READY'], DRAINING:['HELD'], HELD:['DRAINING','READY','DEPLOYING','VERIFYING'] };
    if (!transitions[transition]?.includes(state.state)) throw publicationError('PUBLICATION_TRANSITION_INVALID');
    try {
      if (['READY','DEPLOYING','VERIFYING','OPEN','ABORT'].includes(transition)) {
        if (Object.values(state.accepted).some(x => !x.settled) || Object.keys(state.continuations).length) throw publicationError('PUBLICATION_DRAIN_PENDING');
        const obligations = await scanPublicationObligations(binding);
        if (obligations.some(x=>x.blocking!==false)) throw publicationError('PUBLICATION_HISTORY_PENDING', JSON.stringify(obligations));
      }
      if (['READY','DEPLOYING','ABORT','DRAINING'].includes(transition)) await verifyPublicationPackage(state, 'before');
      if (['VERIFYING','OPEN'].includes(transition)) await verifyPublicationPackage(state, state.restoreBefore ? 'before' : 'after');
      if (transition === 'OPEN') await verifyPublicationConfiguration(context);
      state.state = transition === 'ABORT' ? 'OPEN' : transition;
      if (state.state === 'OPEN') { state.generation++; state.accepted = {}; state.windowId = null; state.publisher = null; }
      return savePublicationState(binding, state);
    } catch (e) {
      if (!['PUBLICATION_DRAIN_PENDING','PUBLICATION_HISTORY_PENDING'].includes(e.code) || state.state !== 'DRAINING') {
        state.state = 'HELD'; state.failure = e.code ?? e.message; await savePublicationState(binding, state);
      }
      throw e;
    }
  });
}
async function verifyPublicationConfiguration(context) {
  const { loadAutomationProfile } = await import('./automation-profile.mjs');
  const { loadEntryActionContracts, resolveEntryActionContract } = await import('./entry-action-contracts.mjs');
  const { projectCommandFile } = await import('./project-command-snapshot.mjs');
  const [profile, contracts] = await Promise.all([loadAutomationProfile(context), loadEntryActionContracts(context)]);
  for (const rule of profile.rules.filter(rule => rule.enabled !== false)) {
    const contract = resolveEntryActionContract(contracts, rule.contractId);
    if (contract.resultPolicy !== rule.execution.resultPolicy) throw publicationError('PUBLICATION_CONFIGURATION_INVALID');
    if (rule.execution.kind === 'project-command') {
      for (const command of [rule.execution.command, rule.execution.proposalValidator?.command].filter(Boolean)) {
        for (const file of [command.path, ...command.readDependencies]) await readFile(await projectCommandFile(context,file));
      }
    }
  }
}
export async function recoverPublicationPublisher(context, { windowId, revision, publisher, restoreBefore = false }) {
  return mutatePublication(context, async (state, binding) => {
    if (!state || state.state === 'OPEN' || state.windowId !== windowId || state.revision !== revision || typeof publisher !== 'string' || !publisher) throw publicationError('PUBLICATION_OWNER_STALE');
    // Explicit administrative takeover. No timeout/PID-based automatic release.
    state.publisher = publisher; state.state = 'HELD'; state.restoreBefore = restoreBefore;
    return savePublicationState(binding, state);
  });
}
export async function reconcilePublicationReservation(context, {windowId,revision,publisher,runId}) {
  return mutatePublication(context,async(state,binding)=>{
    if(!state||state.state!=='DRAINING'||state.windowId!==windowId||state.revision!==revision||state.publisher!==publisher)throw publicationError('PUBLICATION_OWNER_STALE');
    const accepted=state.accepted[runId];
    const continuations=Object.entries(state.continuations).filter(([,x])=>x.runId===runId);
    const records=[...(accepted&&!accepted.settled?[accepted]:[]),...continuations.map(([,x])=>x)];
    if(!records.length)return state;
    for(const record of records)if(await serviceProcessIsAlive(record.owner)!==false)throw publicationError('PUBLICATION_WRITER_UNVERIFIABLE');
    const obligations=await scanPublicationObligations(binding);
    if(obligations.some(x=>x.blocking!==false&&(!x.runId||x.runId===runId||['fencing','recovery_claim','pending_promotion'].includes(x.kind))))throw publicationError('PUBLICATION_HISTORY_PENDING');
    const result=await optionalJson(path.join(binding.runtime,'entry-actions',`${runId}.result.json`));
    const started=await optionalJson(path.join(binding.runtime,'entry-actions',`${runId}.started.json`));
    const handoff=await optionalJson(path.join(binding.runtime,'entry-actions',`${runId}.json`));
    const disposition=isTerminalEntryActionState(result)&&result.outcome!=='failed_needs_recovery'?'original_terminal_verified':(!result&&!started&&!handoff?'reservation_never_started':null);
    if(!disposition)throw publicationError('PUBLICATION_HISTORY_PENDING');
    if(accepted){accepted.settled=true;accepted.settlement=disposition;}
    for(const [id]of continuations)delete state.continuations[id];
    return savePublicationState(binding,state);
  });
}
