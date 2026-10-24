import crypto from 'node:crypto';
import {assertHistoricalRunAllowed,withHistoricalRun} from './historical-disposition.mjs';
import path from 'node:path';
import {stat,realpath} from 'node:fs/promises';
import { AsyncLocalStorage } from 'node:async_hooks';
import { inspectPublicationWindow, mutatePublication, publicationBinding, publicationError, savePublicationState } from './publication-window-state.mjs';
import { createDocumentCommitCoordinator } from './document-commit-coordinator.mjs';
import {readServiceProcessIdentity} from './service-process-identity.mjs';
import {readFile} from 'node:fs/promises';

const scope = new AsyncLocalStorage();
let ownProcess;
const closed = () => publicationError('PUBLICATION_WINDOW_CLOSED', '共享依赖正在发布，输入已保留，请在窗口开放后重试。');

// All reservations are durable. Process death never releases them by timeout.
export async function withPublicationOperation(context, options, operation) {
  const binding = await publicationBinding(context);
  const parent = scope.getStore();
  const runId = options.runId ?? crypto.randomUUID();
  const inherited = !options.fork && parent?.key === binding.key && parent.runId === runId && options.mode !== 'new' && !(parent.mode==='observe'&&options.mode!=='observe');
  // Observations do not authorize new work. Every independent mutating admission
  // rechecks the complete historical relation inventory before dispatch.
  await assertHistoricalRunAllowed(context,[runId,...(options.relatedRunIds??[])],{fullInventory:options.mode!=='observe'&&!inherited});
  if(typeof runId!=='string'||!/^[A-Za-z0-9:_-]{1,160}$/.test(runId)||['__proto__','constructor','prototype'].includes(runId))throw publicationError('PUBLICATION_RUN_ID_INVALID');
  if (inherited) {
    await assertPublicationContinuation(context);
    return withHistoricalRun(context,[runId,...(options.relatedRunIds??[])],()=>operation(runId));
  }
  const id = crypto.randomUUID();
  const registered = await mutatePublication(context, async (state, b) => {
    if (!state) return false;
    const owner=await (ownProcess??=readServiceProcessIdentity());
    if(!owner)throw publicationError('PUBLICATION_WRITER_UNVERIFIABLE');
    const open = state.state === 'OPEN';
    const oldAccepted = state.accepted[runId];
    if (options.mode === 'observe' && !open) return 'skipped';
    if (!open && !(state.state === 'DRAINING' && options.mode === 'recovery')
      && !(state.state === 'DRAINING' && options.mode === 'continue' && oldAccepted && !oldAccepted.settled)) throw closed();
    if (options.mode === 'new') {
      if (state.accepted[runId]) throw publicationError('PUBLICATION_RUN_ALREADY_REGISTERED');
      state.accepted[runId] = { runId, actionId: options.actionId ?? null, generation: state.generation, reservationId:id, settled:false,owner };
    } else {
      state.continuations[id] = { runId, mode:options.mode, generation:state.generation,owner };
    }
    await savePublicationState(b,state);
    return true;
  });
  if (registered === 'skipped') return { recovered:false, reason:'publication_window_closed' };
  const token = { key:binding.key, id, runId, mode:options.mode, registered, context };
  const finish = async () => {
    if (!registered) return;
    await mutatePublication(context, async (state,b) => {
      if (!state) throw publicationError('PUBLICATION_STATE_UNVERIFIABLE');
      if (options.mode === 'new') {
        const accepted = state.accepted[runId];
        if (!accepted || accepted.reservationId !== id) throw publicationError('PUBLICATION_RESERVATION_LOST');
        accepted.settled = true;
      } else {
        if (!state.continuations[id]) throw publicationError('PUBLICATION_RESERVATION_LOST');
        delete state.continuations[id];
      }
      await savePublicationState(b,state);
    });
  };
  return scope.run(token, async () => {
    let result;
    try { result = await withHistoricalRun(context,[runId,...(options.relatedRunIds??[])],()=>operation(runId)); }
    catch (error) { await finish(); throw error; }
    if (result?.completion?.then) {
      const completion = result.completion.then(async value => { await finish(); return value; }, async error => { await finish(); throw error; });
      // The caller still owns observing failures; attaching cleanup must not
      // create an unhandled rejection when the original host observes its promise.
      void completion.catch(() => {});
      return { ...result, completion };
    }
    if (!options.pending) await finish();
    return result;
  });
}

export async function assertPublicationContinuation(context) {
  const token = scope.getStore();
  await assertHistoricalRunAllowed(context,[token?.runId].filter(Boolean));
  return mutatePublication(context, async (state,binding) => {
    if (!state) return;
    if (!token || token.key !== binding.key || !token.registered) throw publicationError('PUBLICATION_RESERVATION_REQUIRED');
    const accepted = state.accepted[token.runId];
    const valid = token.mode === 'new' ? accepted?.reservationId === token.id && !accepted.settled : !!state.continuations[token.id];
    if (!valid || !['OPEN','DRAINING'].includes(state.state)) throw closed();
  });
}

export function publicationCoordinator(context, coordinator) {
  const wrap = operation => async (...args) => {
    await assertPublicationContinuation(context);
    return operation(...args);
  };
  return {
    ...coordinator,
    withCommit: (input, operation) => coordinator.withCommit(input, wrap(operation)),
    withIdentities: (ids, operation) => coordinator.withIdentities(ids, wrap(operation)),
  };
}

// Wrappers live at the original public service boundaries, protecting direct
// CLI calls as well as HTTP. Business implementations and result formats stay put.
export function publicationStart(implementation, resolveRunId = input => input.dependencies?.runId) {
  return async input => {
    const parent = scope.getStore();
    const requested = resolveRunId(input);
    const mode = requested && parent?.runId === requested ? 'continue' : 'new';
    return withPublicationOperation(input.projectContext, { mode, runId:requested, relatedRunIds:[input.dependencies?.parentRunId].filter(Boolean), actionId:input.request?.actionId, fork:mode === 'continue' }, runId => implementation({
      ...input, publicationRunId:runId,
      dependencies:{ ...input.dependencies, runId },
      documentCommitCoordinator:publicationCoordinator(input.projectContext,input.documentCommitCoordinator ?? createDocumentCommitCoordinator()),
    }));
  };
}
export function publicationSubmit(implementation, getRunId = input => input.dependencies?.runId) {
  return async input => {
    const runId = getRunId(input);
    return withPublicationOperation(input.projectContext, { mode:runId ? 'continue':'new', runId, actionId:input.request?.actionId }, id => implementation({
      ...input, dependencies:{ ...input.dependencies, runId:id },
      documentCommitCoordinator:publicationCoordinator(input.projectContext,input.documentCommitCoordinator ?? createDocumentCommitCoordinator()),
    }));
  };
}
export function publicationRecovery(implementation) {
  return async input => withPublicationOperation(input.projectContext, { mode:'recovery',runId:input.runId ?? input.recoveryLease?.runId }, () => implementation({
    ...input, documentCommitCoordinator:publicationCoordinator(input.projectContext,input.documentCommitCoordinator ?? createDocumentCommitCoordinator()),
  }));
}
export async function publicationObserve(context, runId, operation) {
  return withPublicationOperation(context, { mode:'observe',runId }, operation);
}
export async function publicationConfigWrite(context, operation) {
  const parent = scope.getStore();
  return withPublicationOperation(context, { mode:'config', runId:parent?.mode === 'config' ? parent.runId : undefined }, operation);
}
export async function publicationExistingOperation(context, runId, operation) {
  const parent = scope.getStore();
  return withPublicationOperation(context, { mode:'continue', runId:runId ?? parent?.runId }, operation);
}
export async function publicationIsOpen(context) {
  return (await inspectPublicationWindow(context)).state === 'OPEN';
}
export async function settlePublicationPending(context, runId) {
  return mutatePublication(context, async (state,binding) => {
    if (!state?.accepted[runId]) return;
    if (!['OPEN','DRAINING'].includes(state.state)) throw closed();
    state.accepted[runId].settled = true;
    await savePublicationState(binding,state);
  });
}
export async function assertPublicationCommitScope(context, runId) {
  const token=scope.getStore();
  const target=context??token?.context;
  if(!target)return; // Pure in-memory primitives carry no project write capability.
  await assertHistoricalRunAllowed(target,[runId].filter(Boolean));
  const status=await inspectPublicationWindow(target);
  if(status.managed===false)return;
  if(token?.runId!==runId)throw publicationError('PUBLICATION_RESERVATION_REQUIRED');
  await assertPublicationContinuation(target);
}
export async function assertPublicationFileCommit(file,runId) {
  if(!file)return;
  const physical=await realpath(file).catch(e=>e.code==='ENOENT'?path.resolve(file):Promise.reject(e));
  let dir=path.dirname(physical);
  while(true){
    const marker=path.join(dir,'.data-editor/publication-admission');
    const exists=await Promise.all(['anchor.json','state.json'].map(name=>stat(path.join(marker,name)).then(()=>true,e=>e.code==='ENOENT'?false:Promise.reject(e))));
    if(exists.some(Boolean)){
      const anchor=JSON.parse(await readFile(path.join(marker,'anchor.json'),'utf8'));
      return assertPublicationCommitScope({projectRoot:dir,automationProfilePath:anchor.binding.profile,runtimeDir:path.relative(dir,anchor.binding.runtime)},runId);
    }
    const parent=path.dirname(dir);if(parent===dir)return;dir=parent;
  }
}
