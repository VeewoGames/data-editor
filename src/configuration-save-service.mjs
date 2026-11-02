import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { resolveConfigurationSaveTarget, normalizeProfileName } from './project-context.mjs';
import { configurationIdentity, physicalConfigurationPath, configurationVersion } from './configuration-version.mjs';
import { withConfigurationTargetLock, withConfigWrite } from './config-write-precondition.mjs';
import { createConfigurationPermitOwner } from './configuration-permit-owner.mjs';
import { acquireConfigurationAdmission } from './configuration-admission.mjs';
import { loadViewProfileSnapshot, saveViewProfile, serializeViewProfile } from './view-profile.mjs';
import { loadViewConfigSnapshot, saveViewConfig, normalizeViewConfig } from './view-config.mjs';
import { loadSharedViewsSnapshot, saveSharedViews, normalizeSharedViewsConfig } from './shared-views.mjs';
import { userProfileRegistryPath, loadUserProfileNames, registerUserProfileName } from './user-profile-registry.mjs';
import { withProjectProcessLock } from './project-process-lock.mjs';

const bad = (code, message) => Object.assign(new Error(message), { code, status: 409 });
const hash = value => createHash('sha256').update(value).digest('hex');
const validVersion = version => version && typeof version.exists === 'boolean'
  && (version.exists ? /^[a-f0-9]{64}$/.test(version.digest ?? '') : version.digest === null);

/** One attempt/CAS owner for the three exact configuration categories. Main HTTP
 * uses current admission; default library callers retain their protected writers.
 */
export function createConfigurationSaveService({ contextForId, registryOptions, isWritable, validateViewConfig, currentConfigurationStore }) {
  let ownerPromise;
  const owner = () => ownerPromise ??= createConfigurationPermitOwner();
  function assertWritable() {
    if (!isWritable()) throw bad('HISTORY_DEPLOYMENT_MAINTENANCE', '维护期间暂不能保存，改动已保留。');
  }
  async function resolve(descriptor) {
    const context = await contextForId(descriptor.projectId);
    const { target } = resolveConfigurationSaveTarget(context, descriptor);
    const physical = await physicalConfigurationPath(target);
    if (configurationIdentity(physical) !== configurationIdentity(target)) throw bad('CONFIG_ALIAS_REJECTED', '配置路径别名不可写入。');
    const names = await physicalConfigurationPath(userProfileRegistryPath(registryOptions));
    const namesIdentity = process.platform === 'win32' ? names.toLowerCase() : names;
    const kind = descriptor.kind;
    const canonical = { kind, projectId: context.projectId, ...(kind === 'view-profile' ? { name: normalizeProfileName(descriptor.name) } : {}) };
    const read = kind === 'view-profile' ? () => loadViewProfileSnapshot(context, canonical.name)
      : kind === 'view-config' ? () => loadViewConfigSnapshot(context) : () => loadSharedViewsSnapshot(context);
    return { context, target, namesIdentity, descriptor: canonical, read,
      resourceKey: hash(configurationIdentity(physical)),
      effects: { configuration: configurationIdentity(physical), ...(kind === 'view-profile' ? { names: namesIdentity } : {}) },
    };
  }
  async function metadata(scope, snapshot) {
    return { ...snapshot, resourceKey: scope.resourceKey, serverInstance: (await owner()).ownerId, descriptor: scope.descriptor };
  }
  async function prepare(body) {
    const scope = await resolve(body.descriptor);
    if (body.resourceKey !== scope.resourceKey) throw bad('CONFIG_RESOURCE_CHANGED', '配置目标已变化，未发送旧页面保存。');
    if (!validVersion(body.expectedVersion)) throw bad('CONFIG_VERSION_REQUIRED', '缺少已加载的配置版本，改动已保留。');
    if (scope.descriptor.kind === 'view-config') validateViewConfig(body.value);
    const value = scope.descriptor.kind === 'view-profile' ? serializeViewProfile(body.value)
      : scope.descriptor.kind === 'view-config' ? normalizeViewConfig(body.value) : normalizeSharedViewsConfig(body.value);
    const outputVersion = configurationVersion(Buffer.from(JSON.stringify(value, null, 2) + '\n'));
    const binding = hash(JSON.stringify({ descriptor: scope.descriptor, resourceKey: scope.resourceKey, effects: scope.effects,
      expectedVersion: body.expectedVersion, outputVersion, mode: body.mode ?? 'write' }));
    return { ...scope, outputVersion, binding };
  }
  async function namesSnapshot(scope) {
    return withProjectProcessLock('user-profiles:' + scope.namesIdentity, () => loadUserProfileNames(registryOptions));
  }
  return {
    async snapshot(descriptor) {
      const scope = await resolve(descriptor);
      return withConfigurationTargetLock(scope.target, async () => metadata(scope, await scope.read()));
    },
    async preview(body) {
      const scope = await prepare(body), currentOwner = await owner();
      if (body.serverInstance !== currentOwner.ownerId) throw bad('CONFIG_SERVER_CHANGED', '服务实例已变化，需核对已加载配置。');
      return { outputVersion: scope.outputVersion, serverInstance: currentOwner.ownerId };
    },
    async begin(body, { isCurrent = () => true } = {}) {
      const deadline = Date.now() + Math.min(15000, Math.max(1, Number(body.waitMs ?? 15000)));
      if (!Number.isFinite(deadline)) throw bad('CONFIG_DEADLINE_INVALID', '配置保存期限无效。');
      assertWritable();
      const scope = await prepare(body), currentOwner = await owner();
      if (body.serverInstance !== currentOwner.ownerId) throw bad('CONFIG_SERVER_CHANGED', '服务实例已变化，需核对已加载配置。');
      if (!isCurrent() || Date.now() >= deadline) throw bad('CONFIG_SAVE_NOT_SENT_TIMEOUT', '配置保存准备已结束，未发许可。');
      const admission = await acquireConfigurationAdmission(scope.resourceKey, { timeoutMs: Math.max(1, deadline - Date.now()) });
      try {
        if (!isCurrent() || Date.now() >= deadline) throw bad('CONFIG_SAVE_NOT_SENT_TIMEOUT', '配置保存准备已结束，未发许可。');
        const fresh = await prepare(body);
        if (fresh.binding !== scope.binding) throw bad('CONFIG_RESOURCE_CHANGED', '等待期间配置归属已变化，未发许可。');
        assertWritable();
        if (!isCurrent() || Date.now() >= deadline) throw bad('CONFIG_SAVE_NOT_SENT_TIMEOUT', '配置保存准备已结束，未发许可。');
        const permit = currentOwner.issue(scope.binding, { session: body.session, effects: scope.effects,
          onTerminal: () => { void admission.close().catch(() => {}); } });
        return { permit, outputVersion: scope.outputVersion };
      } catch (error) { await admission.close(); throw error; }
    },
    async save(body) {
      assertWritable();
      const scope = await prepare(body), currentOwner = await owner();
      const resource = { effect: 'configuration', target: scope.effects.configuration };
      const validateAttempt = async () => {
        assertWritable();
        const fresh = await prepare(body);
        if (fresh.binding !== scope.binding) throw bad('CONFIG_RESOURCE_CHANGED', '配置目标已变化，未继续旧写入。');
        currentOwner.assert(body.permit, scope.binding, resource);
      };
      await validateAttempt();
      try {
      const options = { expectedVersion: body.expectedVersion, validateAttempt,
        ...(Object.hasOwn(body, 'expected') ? { expected: body.expected } : {}) };
      let result;
      if (currentConfigurationStore) {
        result = await currentConfigurationStore.save(scope.descriptor, body.value, {...options,
          resourceKey: scope.resourceKey, outputVersion: scope.outputVersion, mode: body.mode,
          validateNamesAttempt: async () => {
            assertWritable();
            currentOwner.assert(body.permit, scope.binding, {effect: 'names', target: scope.namesIdentity});
            const fresh = await prepare(body);
            if (fresh.binding !== scope.binding) throw bad('CONFIG_RESOURCE_CHANGED', '配置归属已变化，未继续名称登记。');
          }});
      } else if (body.mode === 'register-only') {
        if (scope.descriptor.kind !== 'view-profile') throw bad('CONFIG_MODE_INVALID', '不支持此配置保存模式。');
        const configuration = await withConfigWrite(scope.target, options, () => null, async () => {
          const current = await scope.read();
          if (!isDeepStrictEqual(current.version, scope.outputVersion)) throw bad('CONFIG_VERSION_CHANGED', '当前视图设置不再满足原保存，未覆盖。');
          return current;
        });
        result = { configuration };
      } else {
        if (body.mode && body.mode !== 'write') throw bad('CONFIG_MODE_INVALID', '不支持此配置保存模式。');
        result = scope.descriptor.kind === 'view-profile' ? await saveViewProfile(scope.context, scope.descriptor.name, body.value, options)
          : scope.descriptor.kind === 'view-config' ? await saveViewConfig(scope.context, body.value, options)
            : await saveSharedViews(scope.context, body.value, options);
      }
      if (!isDeepStrictEqual(result.configuration.version, scope.outputVersion)) throw bad('CONFIG_OUTPUT_CHANGED', '实际保存内容与许可输出不一致，需核对当前内容。');
      if (scope.descriptor.kind === 'view-profile' && !currentConfigurationStore) {
        await registerUserProfileName(scope.descriptor.name, { ...registryOptions, validateAttempt: async () => {
          assertWritable(); currentOwner.assert(body.permit, scope.binding, { effect: 'names', target: scope.namesIdentity });
          const fresh = await prepare(body);
          if (fresh.binding !== scope.binding) throw bad('CONFIG_RESOURCE_CHANGED', '配置归属已变化，未继续名称登记。');
        } });
      }
      return { ok: true, ...result, configuration: await metadata(scope, result.configuration) };
      } finally {
        // Successful and failed completed handlers cannot later reuse this grant.
        // A lost ACK remains reconcilable through the authenticated boot ticket.
        currentOwner.revoke(body.permit, scope.binding);
      }
    },
    async reconcile(body) {
      const scope = await prepare(body), currentOwner = await owner();
      // Only a genuine local ticket gets the fast revoke path. Never accept a
      // client-nominated PID/creationTime as the ended original owner.
      if (body.permit?.claim?.ownerId === currentOwner.ownerId) currentOwner.revoke(body.permit, scope.binding);
      const admission = await acquireConfigurationAdmission(scope.resourceKey);
      try {
      const snapshot = await withConfigurationTargetLock(scope.target, async () => {
        const fresh = await prepare(body);
        if (fresh.binding !== scope.binding) throw bad('CONFIG_RESOURCE_CHANGED', '核对期间配置归属已变化。');
        return scope.read();
      });
      const names = scope.descriptor.kind === 'view-profile' ? await namesSnapshot(scope) : [];
      const outcome = isDeepStrictEqual(snapshot.version, scope.outputVersion) ? 'satisfied'
        : isDeepStrictEqual(snapshot.version, body.expectedVersion) ? 'unchanged' : 'conflict';
      return { outcome, configuration: await metadata(scope, snapshot),
        terminalProof: 'current-admission-quiescent',
        needsRegistration: outcome === 'satisfied' && scope.descriptor.kind === 'view-profile' && !names.includes(scope.descriptor.name) };
      } finally { await admission.close(); }
    },
    async finish(body) {
      const scope = await prepare(body), currentOwner = await owner();
      return { outcome: currentOwner.finish(body.permit, scope.binding) };
    },
    async close() { if (ownerPromise) await (await ownerPromise).close(); },
  };
}
