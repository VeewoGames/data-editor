import net from 'node:net';
import os from 'node:os';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readServiceProcessIdentity } from './service-process-identity.mjs';

const unknown = () => Object.assign(new Error('无法确认原保存许可已结束，改动已保留。'), { code: 'PERMIT_UNKNOWN', status: 409 });
const revoked = () => Object.assign(new Error('本次保存许可已失效，未继续写入。'), { code: 'ATTEMPT_REVOKED', status: 409 });
const mac = (key, value) => createHmac('sha256', key).update(JSON.stringify(value)).digest('hex');
const equal = (left, right) => typeof left === 'string' && typeof right === 'string'
  && /^[a-f0-9]{64}$/.test(left) && /^[a-f0-9]{64}$/.test(right)
  && timingSafeEqual(Buffer.from(left), Buffer.from(right));
const digest = value => createHash('sha256').update(value).digest('hex');

function endpoint(ownerId) {
  if (!/^[a-f0-9-]{36}$/.test(ownerId ?? '')) throw unknown();
  const user = os.userInfo();
  return '\\\\.\\pipe\\data-editor-configuration-owner-' + digest(user.username + '\0' + user.homedir + '\0' + ownerId);
}
function responseFields(request, status) {
  return { challenge: request.challenge, op: request.op, binding: request.binding, resource: request.resource ?? null, status };
}

/** One boot owns only current grants. Expired/finished grants are removed;
 * a genuine boot ticket plus absence from active proves no future permission,
 * without retaining an old result, output, or terminal tombstone.
 */
export async function createConfigurationPermitOwner({
  ttlMs = 30000, maxActive = 128, maxPerSession = 16, maxConnections = 64,
  now = () => performance.now(),
} = {}) {
  if (process.platform !== 'win32') throw unknown();
  if (![ttlMs, maxActive, maxPerSession, maxConnections].every(value => Number.isFinite(value) && value > 0)) throw new RangeError('Invalid current permit limits');
  const identity = await readServiceProcessIdentity();
  if (!identity) throw unknown();
  const ownerId = randomUUID(), key = randomBytes(32), active = new Map(), sockets = new Set();
  let closed = false, closePromise, gc;
  function end(id) {
    const entry = active.get(id);
    active.delete(id);
    entry?.onTerminal?.();
  }
  function prune() {
    const time = now();
    for (const [id, entry] of active) if (entry.expiresAt <= time) end(id);
  }
  function authenticate(claim, ticket, binding) {
    if (closed || claim?.ownerId !== ownerId || claim?.binding !== binding
      || !equal(ticket, mac(key, ['ticket', claim]))) throw unknown();
    return mac(key, ['rpc-secret', ticket]);
  }
  function status(claim, binding, op, resource) {
    if (claim.binding !== binding) throw unknown();
    prune();
    if (op === 'revoke' || op === 'finish') {
      end(claim.id);
      return op === 'finish' ? 'finished' : 'revoked';
    }
    if (op !== 'check') throw unknown();
    const live = active.get(claim.id);
    return live && live.expiresAt > now() && resource
      && Object.hasOwn(claim.effects, resource.effect) && claim.effects[resource.effect] === resource.target
      ? 'valid' : 'revoked';
  }
  function local(token, binding, op, resource) {
    const secret = authenticate(token?.claim, token?.ticket, binding);
    if (!equal(token?.secret, secret)) throw unknown();
    return status(token.claim, binding, op, resource);
  }
  const server = net.createServer(socket => {
    if (closed || sockets.size >= maxConnections) { socket.destroy(); return; }
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    socket.setTimeout(1000, () => socket.destroy());
    let bytes = Buffer.alloc(0);
    socket.on('data', chunk => {
      bytes = Buffer.concat([bytes, chunk]);
      if (bytes.length > 16384) { socket.destroy(); return; }
      const end = bytes.indexOf(10);
      if (end < 0) return;
      socket.removeAllListeners('data');
      try {
        const request = JSON.parse(bytes.subarray(0, end).toString('utf8'));
        const secret = authenticate(request.claim, request.ticket, request.binding);
        if (!/^[a-f0-9]{32}$/.test(request.challenge ?? '') || !equal(request.auth, mac(secret, ['request', responseFields(request, null)]))) throw unknown();
        const response = responseFields(request, status(request.claim, request.binding, request.op, request.resource));
        socket.end(JSON.stringify({ ...response, auth: mac(secret, ['response', response]) }) + '\n');
      } catch { socket.destroy(); }
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(endpoint(ownerId), resolve); });
  gc = setInterval(prune, Math.min(ttlMs, 1000));
  gc.unref();
  return {
    ownerId, identity,
    get size() { prune(); return active.size; },
    prune,
    issue(binding, { session, effects, onTerminal }) {
      if (closed || typeof binding !== 'string' || Buffer.byteLength(binding) > 4096
        || !/^[a-f0-9-]{36}$/.test(session ?? '') || !effects || !Object.keys(effects).length
        || Object.keys(effects).length > 8 || Object.values(effects).some(value => typeof value !== 'string' || value.length > 2048)) throw unknown();
      prune();
      if (active.size >= maxActive || [...active.values()].filter(item => item.session === session).length >= maxPerSession) {
        throw Object.assign(new Error('当前保存请求繁忙，请稍后重试，改动已保留。'), { code: 'CONFIG_PERMIT_BUSY', status: 429 });
      }
      const claim = { version: 1, ownerId, process: identity, id: randomUUID(), session, expiresAt: now() + ttlMs, binding, effects: { ...effects } };
      const ticket = mac(key, ['ticket', claim]);
      active.set(claim.id, { expiresAt: claim.expiresAt, session, onTerminal });
      return { claim, ticket, secret: mac(key, ['rpc-secret', ticket]) };
    },
    assert(token, binding, resource) { if (local(token, binding, 'check', resource) !== 'valid') throw revoked(); },
    revoke: (token, binding) => local(token, binding, 'revoke'),
    finish: (token, binding) => local(token, binding, 'finish'),
    close() {
      if (closePromise) return closePromise;
      closed = true; for (const id of active.keys()) end(id); clearInterval(gc);
      closePromise = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      for (const socket of sockets) socket.destroy();
      return closePromise;
    },
  };
}

/** Call only for a ticket obtained from the trusted begin response. HTTP write
 * admission uses its own boot owner's assert(), never a client-nominated pipe.
 * RPC sends a proof, not the capability secret; replies bind all request fields.
 */
export function queryConfigurationPermit(token, binding, op, resource) {
  return new Promise((resolve, reject) => {
    let socket;
    try { socket = net.createConnection(endpoint(token?.claim?.ownerId)); } catch (error) { reject(error); return; }
    const request = { claim: token.claim, ticket: token.ticket, challenge: randomBytes(16).toString('hex'), binding, op, resource: resource ?? null };
    request.auth = mac(token.secret, ['request', responseFields(request, null)]);
    let bytes = Buffer.alloc(0), settled = false;
    const timer = setTimeout(() => socket.destroy(unknown()), 1000);
    function finish(error, result) {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error) reject(error); else resolve(result);
    }
    socket.on('connect', () => socket.write(JSON.stringify(request) + '\n'));
    socket.on('error', error => finish(Object.assign(unknown(), { cause: error, ownerAbsent: error.code === 'ENOENT' })));
    socket.on('data', chunk => {
      bytes = Buffer.concat([bytes, chunk]);
      if (bytes.length > 16384) socket.destroy(unknown());
    });
    socket.on('end', () => {
      try {
        const response = JSON.parse(bytes.toString('utf8'));
        const expected = responseFields(request, response.status);
        if (!equal(response.auth, mac(token.secret, ['response', expected]))) throw unknown();
        finish(null, response.status);
      } catch (error) { finish(error); }
    });
    socket.once('close', () => { if (!settled) finish(unknown()); });
  });
}
