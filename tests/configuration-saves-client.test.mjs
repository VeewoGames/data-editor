import assert from 'node:assert/strict';
import test from 'node:test';
import { createConfigurationSaves } from '../src/api/configuration-saves.mjs';

function fixture(kind = 'view-profile') {
  let value = { width: 100 }, revision = 1, instance = 'boot-1', writes = 0;
  let dropAck = false, offline = false, failWrite = false, registrationPending = false, disconnectAfterSave = false, failRegistration = false;
  const calls = [], permits = new Set();
  const descriptor = { kind, projectId: 'project-a', ...(kind === 'view-profile' ? { name: 'Lans' } : {}) };
  const version = () => ({ exists: revision > 0, digest: revision > 0 ? String(revision).padStart(64, '0') : null });
  const snapshot = () => ({ value: structuredClone(value), version: version(), resourceKey: 'target-a', serverInstance: instance, descriptor });
  const reject = code => { throw Object.assign(new Error(code), { code, status: 409 }); };
  const request = async (url, options) => {
    calls.push({ url, body: options?.body ? JSON.parse(options.body) : null });
    if (offline) throw new TypeError('offline');
    if (url.startsWith('/api/configuration-snapshot?')) return snapshot();
    const body = JSON.parse(options.body);
    if (body.resourceKey !== 'target-a') reject('CONFIG_RESOURCE_CHANGED');
    if (url === '/api/configuration-reconcile') {
      permits.delete(body.permit);
      const outcome = JSON.stringify(body.value) === JSON.stringify(value) ? 'satisfied'
        : JSON.stringify(body.expectedVersion) === JSON.stringify(version()) ? 'unchanged' : 'conflict';
      return { outcome, configuration: snapshot(), needsRegistration: registrationPending, terminalProof: 'current-admission-quiescent' };
    }
    if (url === '/api/configuration-begin') {
      if (body.serverInstance !== instance) reject('CONFIG_SERVER_CHANGED');
      assert.match(body.session, /^[a-f0-9-]{36}$/);
      const permit = 'permit-' + calls.length;
      permits.add(permit);
      return { permit };
    }
    assert.equal(url, '/api/configuration-save');
    if (!permits.delete(body.permit)) reject('ATTEMPT_REVOKED');
    if (JSON.stringify(body.expectedVersion) !== JSON.stringify(version())) reject('CONFIG_VERSION_CHANGED');
    if (failWrite) throw new Error('disk failure');
    if (body.mode !== 'register-only') { value = structuredClone(body.value); revision++; writes++; }
    if (failRegistration) { failRegistration = false; registrationPending = true; throw new Error('registration failed'); }
    registrationPending = false;
    if (dropAck) { dropAck = false; offline = disconnectAfterSave; throw new TypeError('ACK lost'); }
    return { ok: true, configuration: snapshot() };
  };
  return { client: createConfigurationSaves(request), descriptor, calls, snapshot,
    get writes() { return writes; },
    external(valueNext) { value = valueNext; revision++; },
    absent() { value = {}; revision = 0; },
    restart() { instance = 'boot-2'; },
    loseAck(disconnect = false) { dropAck = true; disconnectAfterSave = disconnect; },
    offline(valueNext) { offline = valueNext; },
    failWrite(valueNext) { failWrite = valueNext; },
    partialRegistration() { failRegistration = true; },
  };
}

for (const kind of ['view-profile', 'view-config', 'shared-views']) {
  test(`${kind}: save carries the loaded identity, version and permit, then advances its baseline`, async () => {
    const f = fixture(kind);
    assert.deepEqual(await f.client.load(f.descriptor), { width: 100 });
    await f.client.save(f.descriptor, { width: 200 });
    await f.client.save(f.descriptor, { width: 300 });
    assert.equal(f.writes, 2);
    assert.deepEqual(await f.client.load(f.descriptor), { width: 300 });
    assert.equal(f.calls.filter(call => call.url.startsWith('/api/configuration-snapshot?')).length, 2);
    const saves = f.calls.filter(call => call.url === '/api/configuration-save');
    assert.equal(saves[0].body.expectedVersion.digest, '1'.padStart(64, '0'));
    assert.equal(saves[1].body.expectedVersion.digest, '2'.padStart(64, '0'));
  });
}

test('external changes are never adopted as the baseline of an existing draft', async () => {
  const f = fixture();
  await f.client.load(f.descriptor);
  f.external({ width: 900 });
  await assert.rejects(f.client.save(f.descriptor, { width: 200 }), { code: 'CONFIG_VERSION_CHANGED' });
  await assert.rejects(f.client.save(f.descriptor, { width: 200 }));
  assert.equal(f.writes, 0);
  assert.equal(f.snapshot().value.width, 900);
  assert.deepEqual(await f.client.load(f.descriptor), { width: 900 });
  await f.client.save(f.descriptor, { width: 1000 });
  assert.equal(f.writes, 1);
});

test('an unloaded existing target cannot be overwritten; a missing profile can be created', async () => {
  const existing = fixture();
  await assert.rejects(existing.client.save(existing.descriptor, { width: 200 }), { code: 'CONFIG_NOT_LOADED' });
  assert.equal(existing.writes, 0);
  const absent = fixture();
  absent.absent();
  await absent.client.save(absent.descriptor, { width: 200 });
  assert.equal(absent.writes, 1);
});

test('a lost save ACK is reconciled without repeating the write', async () => {
  const f = fixture();
  await f.client.load(f.descriptor);
  f.loseAck();
  await f.client.save(f.descriptor, { width: 200 });
  assert.equal(f.writes, 1);
  assert.equal(f.calls.at(-1).url, '/api/configuration-reconcile');
});

test('failed writes preserve the original baseline and can be retried', async () => {
  const f = fixture();
  await f.client.load(f.descriptor);
  f.failWrite(true);
  await assert.rejects(f.client.save(f.descriptor, { width: 200 }), /disk failure/);
  assert.equal(f.writes, 0);
  f.failWrite(false);
  await f.client.save(f.descriptor, { width: 200 });
  assert.equal(f.writes, 1);
});

test('concurrent saves serialize per owner and capture their input before waiting', async () => {
  const f = fixture();
  await f.client.load(f.descriptor);
  const draft = { width: 200 };
  const first = f.client.save(f.descriptor, draft);
  draft.width = 900;
  const second = f.client.save(f.descriptor, { width: 300 });
  await Promise.all([first, second]);
  const saves = f.calls.filter(call => call.url === '/api/configuration-save');
  assert.deepEqual(saves.map(call => call.body.value.width), [200, 300]);
});

test('a service restart is reconciled against the original version before retrying', async () => {
  const f = fixture();
  await f.client.load(f.descriptor);
  f.restart();
  await f.client.save(f.descriptor, { width: 200 });
  assert.equal(f.writes, 1);
  const begin = f.calls.filter(call => call.url === '/api/configuration-begin');
  assert.equal(begin[0].body.serverInstance, 'boot-1');
  assert.equal(begin[1].body.serverInstance, 'boot-2');
});

test('an unconfirmed attempt survives an outage and is reconciled before saving a newer draft', async () => {
  const f = fixture();
  await f.client.load(f.descriptor);
  f.loseAck(true);
  await assert.rejects(f.client.save(f.descriptor, { width: 200 }), /ACK lost/);
  assert.equal(f.writes, 1);
  f.offline(false);
  await f.client.save(f.descriptor, { width: 300 });
  assert.equal(f.writes, 2);
  assert.equal(f.snapshot().value.width, 300);
  const reconcileIndex = f.calls.findLastIndex(call => call.url === '/api/configuration-reconcile');
  assert.equal(f.calls[reconcileIndex + 1].url, '/api/configuration-begin');
});

test('a partial profile save retries only name registration before acknowledging success', async () => {
  const f = fixture();
  await f.client.load(f.descriptor);
  f.partialRegistration();
  await assert.rejects(f.client.save(f.descriptor, { width: 200 }), /registration failed/);
  assert.equal(f.writes, 1);
  await f.client.save(f.descriptor, { width: 200 });
  assert.equal(f.writes, 1);
  const saves = f.calls.filter(call => call.url === '/api/configuration-save');
  assert.equal(saves.at(-1).body.mode, 'register-only');
});
