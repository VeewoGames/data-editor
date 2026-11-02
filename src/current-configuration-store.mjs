import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {createCurrentConfigurationAdmission} from './current-configuration-admission.mjs';
import {withConfigWrite} from './config-write-precondition.mjs';
import {atomicWrite} from './atomic-file-core.mjs';
import {configurationVersion} from './configuration-version.mjs';
import {loadViewProfileSnapshot, serializeViewProfile} from './view-profile.mjs';
import {loadViewConfigSnapshot, normalizeViewConfig} from './view-config.mjs';
import {loadSharedViewsSnapshot, normalizeSharedViewsConfig} from './shared-views.mjs';
import {displayProjectPath, normalizeProfileName} from './project-context.mjs';
import {registerUserProfileName} from './user-profile-registry.mjs';

const fail = (code, message) => {throw Object.assign(new Error(message), {code, status: 409});};

// Server adapter: the complete current owner encloses both effects. The generic
// library entry retains its own admission; this adapter never invokes it.
export function createCurrentConfigurationStore(options) {
  const admission = createCurrentConfigurationAdmission(options);
  return {
    save(descriptor, value, saveOptions) {
      return admission.run(descriptor, saveOptions, async authorization => {
        const {context, target} = authorization;
        const profile = descriptor.kind === 'view-profile';
        const read = profile ? () => loadViewProfileSnapshot(context, descriptor.name)
          : descriptor.kind === 'view-config' ? () => loadViewConfigSnapshot(context) : () => loadSharedViewsSnapshot(context);
        const normalize = profile ? serializeViewProfile : descriptor.kind === 'view-config' ? normalizeViewConfig : normalizeSharedViewsConfig;
        const writeOptions = {...saveOptions, validateAttempt: authorization.validateConfigurationEffect};
        const result = await withConfigWrite(target, writeOptions,
          async () => (await read()).value, async () => {
            if (saveOptions.mode === 'register-only') {
              const configuration = await read();
              if (!isDeepStrictEqual(configuration.version, saveOptions.outputVersion)) fail('CONFIG_VERSION_CHANGED', '当前视图设置不再满足原保存，未覆盖。');
              return {configuration};
            }
            if (saveOptions.mode && saveOptions.mode !== 'write') fail('CONFIG_MODE_INVALID', '不支持此配置保存模式。');
            await mkdir(path.dirname(target), {recursive: true});
            const text = JSON.stringify(normalize(value), null, 2) + '\n';
            await atomicWrite(target, text);
            const configuration = await read();
            if (!isDeepStrictEqual(configuration.version, configurationVersion(Buffer.from(text)))) fail('CONFIG_POSTWRITE_CHANGED', '配置写入后已变化，改动已保留，需核对当前内容。');
            return {path: displayProjectPath(context, target), ...(profile ? {name: normalizeProfileName(descriptor.name)} : {}), configuration};
          });
        if (profile) await registerUserProfileName(descriptor.name, {...options.registryOptions,
          validateAttempt: authorization.validateNamesEffect,
          validateWrite: authorization.validateNamesWrite,
          writeAtomic: atomicWrite});
        return result;
      });
    },
  };
}
