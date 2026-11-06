const failure = (code, message) => Object.assign(new Error(message), { code });
/** Loaded baselines and unfinished attempts have one owner, shared by all three
 * configuration categories. A save never fetches a fresh version to overwrite
 * an existing target; only an explicit load establishes that editing baseline.
 */
export function createConfigurationSaves(request) {
    const slots = new Map();
    let session;
    function slotFor(descriptor) {
        const key = JSON.stringify([descriptor.projectId ?? null, descriptor.kind, descriptor.name ?? null]);
        let slot = slots.get(key);
        if (!slot) {
            slot = { tail: Promise.resolve() };
            slots.set(key, slot);
        }
        return slot;
    }
    function enqueue(slot, action) {
        const task = slot.tail.catch(() => { }).then(action);
        slot.tail = task.catch(() => { });
        return task;
    }
    async function post(route, body) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20000);
        try {
            return await request('/api/configuration-' + route, {
                method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify(body), signal: controller.signal,
            });
        }
        finally {
            clearTimeout(timer);
        }
    }
    async function read(descriptor) {
        const query = new URLSearchParams({ kind: descriptor.kind });
        if (descriptor.projectId)
            query.set('projectId', descriptor.projectId);
        if (descriptor.name)
            query.set('name', descriptor.name);
        const snapshot = await request('/api/configuration-snapshot?' + query);
        if (!snapshot?.resourceKey || !snapshot.serverInstance || !snapshot.descriptor
            || typeof snapshot.version?.exists !== 'boolean') {
            throw failure('CONFIG_SNAPSHOT_INVALID', '配置快照不完整，未发送保存，请重新加载。');
        }
        return snapshot;
    }
    function attemptFor(snapshot, value, mode, expected) {
        session ??= globalThis.crypto.randomUUID();
        return { descriptor: snapshot.descriptor, resourceKey: snapshot.resourceKey,
            expectedVersion: snapshot.version, serverInstance: snapshot.serverInstance,
            value, session, mode, ...(expected === undefined ? {} : { expected }) };
    }
    async function reconcile(slot, attempt) {
        const result = await post('reconcile', attempt);
        if (result.terminalProof !== 'current-admission-quiescent') {
            throw failure('CONFIG_SAVE_UNKNOWN', '无法确认配置保存结果，改动已保留。');
        }
        if (result.outcome === 'conflict') {
            // The old attempt is finished, but its editing baseline stays old.
            // Explicit load may refresh it; an autosave retry may not.
            slot.pending = undefined;
            throw Object.assign(failure('CONFIG_VERSION_CHANGED', '配置已在其他窗口发生变化，改动已保留，请重新核对。'), { configurationAttemptEnded: true });
        }
        if (result.outcome !== 'satisfied' && result.outcome !== 'unchanged') {
            throw failure('CONFIG_SAVE_UNKNOWN', '无法确认配置保存结果，改动已保留。');
        }
        slot.snapshot = result.configuration;
        slot.pending = undefined;
        return result;
    }
    async function write(slot, attempt) {
        let grant;
        try {
            grant = await post('begin', attempt);
        }
        catch (error) {
            if (error.code !== 'CONFIG_SERVER_CHANGED')
                throw error;
            // A new boot is usable only after checking the original target/version.
            const result = await reconcile(slot, attempt);
            if (result.outcome === 'satisfied' && !result.needsRegistration)
                return { ok: true, configuration: result.configuration };
            if (result.outcome === 'satisfied') slot.pending = attempt;
            attempt = attemptFor(result.configuration, attempt.value, result.needsRegistration && result.outcome === 'satisfied' ? 'register-only' : attempt.mode, attempt.expected);
            grant = await post('begin', attempt);
        }
        attempt = { ...attempt, permit: grant.permit };
        slot.pending = attempt;
        try {
            const result = await post('save', attempt);
            slot.snapshot = result.configuration;
            slot.pending = undefined;
            return result;
        }
        catch (error) {
            // An HTTP failure can follow a partial write too. Revoke/quiesce the
            // original attempt and compare its exact output before deciding success.
            const result = await reconcile(slot, attempt).catch(reconciliationError => {
                if (!reconciliationError.configurationAttemptEnded) slot.pending = attempt;
                throw error;
            });
            if (result.outcome === 'satisfied' && !result.needsRegistration)
                return { ok: true, configuration: result.configuration };
            if (result.outcome === 'satisfied')
                slot.pending = attempt;
            throw error;
        }
    }
    return {
        load(descriptor) {
            const slot = slotFor(descriptor);
            return enqueue(slot, async () => {
                if (slot.pending) {
                    const attempt = slot.pending;
                    const result = await reconcile(slot, attempt);
                    if (result.outcome === 'satisfied' && result.needsRegistration) {
                        slot.pending = attempt;
                        await write(slot, attemptFor(result.configuration, attempt.value, 'register-only'));
                    }
                }
                const snapshot = await read(descriptor);
                slot.snapshot = structuredClone(snapshot);
                return snapshot.value;
            });
        },
        save(descriptor, value, expected) {
            const slot = slotFor(descriptor);
            // Capture before entering the queue; page mutations cannot alter an attempt.
            const draft = structuredClone(value), preimage = structuredClone(expected);
            return enqueue(slot, async () => {
                if (slot.pending) {
                    const previous = slot.pending;
                    const result = await reconcile(slot, previous);
                    if (result.outcome === 'satisfied') {
                        if (result.needsRegistration) {
                            slot.pending = previous;
                            await write(slot, attemptFor(result.configuration, previous.value, 'register-only'));
                        }
                        if (JSON.stringify(previous.value) === JSON.stringify(draft))
                            return { ok: true, configuration: slot.snapshot };
                    }
                }
                if (!slot.snapshot) {
                    const snapshot = await read(descriptor);
                    if (snapshot.version.exists) {
                        throw failure('CONFIG_NOT_LOADED', '此配置已存在但尚未加载，未覆盖，请先加载后修改。');
                    }
                    slot.snapshot = snapshot;
                }
                return write(slot, attemptFor(slot.snapshot, draft, 'write', preimage));
            });
        },
    };
}
