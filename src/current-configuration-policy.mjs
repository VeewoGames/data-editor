import path from 'node:path';
import {readFile, stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {requiredFilesForProtocol} from './historical-required-files.mjs';
import {loadCatalog, readObject, authorityPhysical} from './deployment-authority-io.mjs';
import {decode, assertPolicy, normalize, digest, encode} from './deployment-authority-schema.mjs';

const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fail = code => {throw Object.assign(new Error(code), {code, status: 409});};

// The caller holds the pure store lock through the complete effect. These are
// current selected permission/code configurations, never proof or result reads.
export async function readCurrentConfigurationPolicy({projectRoot} = {}) {
  const selected = await loadCatalog(false);
  const activeDelivery = await stat(path.join(selected.directory, 'active-delivery.json')).then(() => true, error => {if (error.code === 'ENOENT') return false; throw error;});
  const projects = [];
  for (const entry of selected.catalog.entries) {
    const policy = decode(await readObject(selected.directory, entry.intent.policyRef));
    assertPolicy(policy);
    if (requiredFilesForProtocol(entry.intent.minReaderProtocol).some(file => !policy.deploymentFiles.some(pin => pin.path === file))) fail('HISTORY_DEPLOYMENT_INCOMPLETE');
    if (entry.intent.root === projectRoot) {
      for (const pin of policy.deploymentFiles) {
        const target = path.resolve(toolRoot, pin.path);
        if (normalize(await authorityPhysical(target)) !== normalize(target)
          || digest(await readFile(target)) !== pin.digest) fail('HISTORY_DEPLOYMENT_DRIFT');
      }
    }
    projects.push(Object.freeze({root: entry.intent.root, runtime: entry.intent.runtime, anchorId: entry.intent.anchorId,
      businessFiles: Object.freeze([...policy.businessFiles]),
      protocol: entry.intent.minReaderProtocol,
      selection: digest(encode(entry.intent))}));
  }
  return Object.freeze({directory: selected.directory, selectionStamp: selected.stamp,
    generation: selected.catalog.generation, activeDelivery, projects: Object.freeze(projects)});
}
