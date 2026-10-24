import path from 'node:path';
import {historicalObligations,projectHistoricalObligations,withHistoryProjectLock} from './historical-disposition.mjs';
import { readdir, readFile } from 'node:fs/promises';
import { isTerminalEntryActionState } from './entry-action-state.mjs';

// Pure inventory. No recovery, migrations, lock release or business disposition.
export async function inventoryPublicationObligations(binding) {
  const blockers = [];
  const names = async dir => readdir(dir, { withFileTypes: true }).catch(e => e.code === 'ENOENT' ? [] : Promise.reject(e));
  const read = async file => { try { return JSON.parse(await readFile(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
  const dir = path.join(binding.runtime, 'entry-actions');
  const starts = await names(dir);
  for (const e of starts) {
    if (!e.name.endsWith('.started.json')) continue;
    const runId = e.name.slice(0, -'.started.json'.length);
    const result = await read(path.join(dir, `${runId}.result.json`));
    if (!isTerminalEntryActionState(result) || result.outcome === 'failed_needs_recovery') blockers.push({ kind: 'run', runId });
  }
  // Orphan handoff can be a crash after accepting and before started publication.
  for (const e of starts.filter(e => /^[a-f0-9-]{36}\.json$/i.test(e.name))) {
    const id = e.name.slice(0, -5);
    if (!await read(path.join(dir, `${id}.started.json`)) && !await read(path.join(dir, `${id}.result.json`))) blockers.push({ kind:'orphan_handoff', runId:id });
  }
  for (const name of ['entry-action-commit-journal','entry-action-group-journal','identity-promotion-journal']) {
    for (const e of await names(path.join(binding.runtime, name))) {
      if (!e.isFile() || !e.name.endsWith('.json')) continue;
      const entry = await read(path.join(binding.runtime, name, e.name));
      if (entry?.stage !== (name === 'identity-promotion-journal' ? 'receipt' : 'result_published')) blockers.push({ kind:name, runId:entry?.runId, file:e.name });
    }
  }
  for (const e of await names(path.join(binding.runtime, 'pending-entry-actions'))) {
    if (!e.isFile() || !e.name.endsWith('.json')) continue;
    const entry = await read(path.join(binding.runtime,'pending-entry-actions',e.name));
    if (entry?.state === 'pending') blockers.push({ kind:'pending_promotion', runId:entry.runId });
  }
  async function fence(dir) {
    for (const e of await names(dir)) {
      const file = path.join(dir,e.name);
      if (e.name === 'admission.lock' || e.name === 'allocator.lock') blockers.push({ kind:'fencing', file });
      if (e.isDirectory()) {
        if (e.name === 'quarantine' && (await names(file)).length) blockers.push({ kind:'recovery_claim', file });
        await fence(file);
      }
    }
  }
  await fence(path.join(binding.runtime,'entry-action-fencing'));
  return blockers;
}

export async function scanPublicationObligations(binding) {
 return withHistoryProjectLock(binding,async()=>{
  const raw=await inventoryPublicationObligations(binding),validation={receipts:new Map(),snapshot:null};
  return [...await projectHistoricalObligations(binding,raw,validation),...await historicalObligations(binding,validation)];
 });
}
