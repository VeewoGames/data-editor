import path from 'node:path';
import {createHash} from 'node:crypto';
import {withProjectRegistryLock, loadProjectRegistry} from './project-registry.mjs';
import {withStoreDeliveryLock, authorityPhysical} from './deployment-authority-io.mjs';
import * as schema from './deployment-authority-schema.mjs';
import {resolveConfigurationSaveTarget} from './project-context.mjs';
import {configurationIdentity} from './configuration-version.mjs';
import {userProfileRegistryPath} from './user-profile-registry.mjs';
import {readCurrentConfigurationPolicy} from './current-configuration-policy.mjs';
import {checkCurrentConfigurationTarget} from './current-configuration-target.mjs';

const fail = (code, message) => {throw Object.assign(new Error(message ?? code), {code, status: 409});};
const inside = (file, root) => file === root || file.startsWith(root + '/');

export function createCurrentConfigurationAdmission({registryOptions, contextForProject, getRuntimeState}) {
  if (typeof contextForProject !== 'function' || typeof getRuntimeState !== 'function') throw new TypeError('Current configuration admission requires explicit runtime and context owners');
  return {
    run(descriptor, options, operation) {
      if (!['view-profile','view-config','shared-views'].includes(descriptor?.kind)) fail('CONFIG_CATEGORY_REQUIRED');
      const profile = descriptor.kind === 'view-profile';
      if (options.mode && options.mode !== 'write' && !(profile && options.mode === 'register-only')) fail('CONFIG_MODE_INVALID');
      return withProjectRegistryLock(() => withStoreDeliveryLock(async () => {
        const registry = await loadProjectRegistry(registryOptions);
        const project = registry.projects.find(item => item.id === descriptor.projectId);
        if (!project) fail('CONFIG_PROJECT_CHANGED', '当前项目已移除，改动已保留。');
        const context = contextForProject(project);
        const root = schema.normalize(await authorityPhysical(context.projectRoot));
        const protection = await readCurrentConfigurationPolicy({projectRoot: root});
        const io = {authorityPhysical};
        const dependencies = {io, schema, resolveConfigurationSaveTarget};
        const admitted = await checkCurrentConfigurationTarget(context, descriptor, dependencies, protection, {readOnly: profile && options.mode === 'register-only'});
        const resourceKey = createHash('sha256').update(configurationIdentity(admitted.target)).digest('hex');
        if (options.resourceKey !== resourceKey) fail('CONFIG_RESOURCE_CHANGED');
        const namesTarget = profile ? userProfileRegistryPath(registryOptions) : null;
        const namesIdentity = profile ? configurationIdentity(await authorityPhysical(namesTarget)) : null;
        let active = true;
        function assertRuntime() {
          const state = getRuntimeState();
          if (!active || state.maintenance || state.shuttingDown || protection.activeDelivery) fail('HISTORY_DEPLOYMENT_MAINTENANCE');
          for (const item of protection.projects) {
            if (item.protocol === 3 && state.readySelections?.get(item.root) !== item.selection) fail('CONFIG_CURRENT_SELECTION_NOT_READY');
          }
        }
        async function validateConfigurationEffect() {
          assertRuntime();
          const fresh = await checkCurrentConfigurationTarget(context, descriptor, dependencies, protection, {readOnly: profile && options.mode === 'register-only'});
          if (fresh.physicalTarget !== admitted.physicalTarget) fail('CONFIG_RESOURCE_CHANGED');
          await options.validateAttempt?.();
          assertRuntime();
        }
        async function validateNamesEffect() {
          if (!profile) fail('CONFIG_NAMES_CATEGORY_REQUIRED');
          assertRuntime();
          if (configurationIdentity(await authorityPhysical(namesTarget)) !== namesIdentity) fail('PROFILE_REGISTRY_IDENTITY_CHANGED');
          await (options.validateNamesAttempt ?? options.validateAttempt)?.();
          assertRuntime();
        }
        async function validateNamesWrite(target) {
          await validateNamesEffect();
          if (path.resolve(target) !== path.resolve(namesTarget)) fail('CONFIG_NAMES_TARGET_CHANGED');
          // The default historical names writer has no project/run scope and
          // cannot write inside an already selected protected project either.
          if (inside(namesIdentity, configurationIdentity(protection.directory))
            || protection.projects.some(item => inside(namesIdentity, item.root))) fail('HISTORY_CONFIGURATION_WRITESET_INVALID');
        }
        try {
          await validateConfigurationEffect();
          return await operation({context, target: admitted.target, validateConfigurationEffect,
            ...(profile ? {namesTarget, validateNamesEffect, validateNamesWrite} : {}), selectionStamp: protection.selectionStamp});
        } finally {active = false;}
      }), registryOptions);
    },
  };
}
