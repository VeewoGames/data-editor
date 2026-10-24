import path from 'node:path';
import { mkdir, realpath, stat } from 'node:fs/promises';
import { withProjectProcessLock } from './project-process-lock.mjs';

// A managed action can spend time awaiting publication bookkeeping between
// allocation and commit. Its fencing probe must not read the allocator's
// multi-file ledger halfway through a different allocation. Serialize only
// these short allocator operations, never a command, commit or publisher.
export async function withManagedFencingState(stateRoot, key, operation) {
  let dir = path.resolve(stateRoot), managed = false;
  while (true) {
    try { await stat(path.join(dir,'.data-editor/publication-admission/anchor.json')); managed = true; break; }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    const parent = path.dirname(dir); if (parent === dir) break; dir = parent;
  }
  if (!managed) return operation();
  await mkdir(stateRoot,{recursive:true});
  let canonical = (await realpath(stateRoot)).replaceAll('\\','/');
  if (process.platform === 'win32') canonical = canonical.toLowerCase();
  return withProjectProcessLock(`publication-fencing:${canonical}:${key}`,operation);
}
