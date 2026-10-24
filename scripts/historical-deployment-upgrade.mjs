// Explicit offline administration. No HTTP route, automatic migration, or bypass.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import { historyBinding, withHistoryProjectLock, prepareHistoricalDeploymentUpgrade, assertHistoricalRunAllowed } from '../src/historical-disposition.mjs';
import { historyDeploymentFile, historyPhysicalKey } from '../src/historical-deployment.mjs';
import { artifactReference, readDeploymentArtifact, deploymentDigest } from '../src/historical-deployment-successor.mjs';
import { atomicWrite } from '../src/atomic-file.mjs';
import { withProjectProcessLock } from '../src/project-process-lock.mjs';

const encode = value => `${JSON.stringify(value, null, 2)}\n`;
const stable = value => JSON.stringify(value);
const fail = code => { throw Object.assign(new Error(code), { code, status: 409 }); };

async function withUpgradeLock(context, operation) {
  // All projects share one delivery configuration; lock delivery before project.
  return withProjectProcessLock(`history-delivery:${historyPhysicalKey(historyDeploymentFile)}`, async () =>
    withHistoryProjectLock(await historyBinding(context), operation));
}

async function prepareLocked(context, sourceBytes) {
  const current = await readFile(historyDeploymentFile);
  const prepared = await prepareHistoricalDeploymentUpgrade(context, sourceBytes);
  const config = JSON.parse(current.toString('utf8'));
  const entry = config.entries.find(entry => entry.projectRoot === prepared.certificate.root);
  if (!entry) fail('HISTORY_UPGRADE_SOURCE_INVALID');
  entry.managedNonReplay = prepared.targetPolicy;
  entry.deploymentSuccessor = artifactReference(Buffer.from(encode(prepared.certificate)), 'certificate');
  return { version: 1, expectedConfigDigest: deploymentDigest(current), sourceSnapshotBase64: sourceBytes.toString('base64'),
    certificate: prepared.certificate, targetConfig: config, businessBaseline: prepared.businessBaseline };
}

export async function prepareDeploymentUpgrade(context, sourceBytes) {
  return withUpgradeLock(context, () => prepareLocked(context, sourceBytes));
}

async function persistArtifact(ref, bytes, kind) {
  const directory = path.join(path.dirname(historyDeploymentFile), 'historical-deployment-upgrades');
  await mkdir(directory, { recursive: true });
  if (historyPhysicalKey(await realpath(directory)) !== historyPhysicalKey(directory)) fail('HISTORY_SUCCESSOR_INVALID');
  const file = path.join(path.dirname(historyDeploymentFile), ref.path);
  try { await writeFile(file, bytes, { flag: 'wx' }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  if (!bytes.equals(await readDeploymentArtifact(ref, kind))) fail('HISTORY_SUCCESSOR_INVALID');
}

export async function applyDeploymentUpgrade(context, bundle) {
  return withUpgradeLock(context, async () => {
    if (!bundle || Object.keys(bundle).sort().join(',') !== 'businessBaseline,certificate,expectedConfigDigest,sourceSnapshotBase64,targetConfig,version'
      || bundle.version !== 1 || typeof bundle.sourceSnapshotBase64 !== 'string') fail('HISTORY_UPGRADE_BUNDLE_INVALID');
    const targetBytes = Buffer.from(encode(bundle.targetConfig));
    const current = await readFile(historyDeploymentFile);
    if (current.equals(targetBytes)) {
      await assertHistoricalRunAllowed(context, ['deployment-upgrade-verification'], { fullInventory: true });
      return { status: 'already_applied', configDigest: deploymentDigest(current) };
    }
    if (deploymentDigest(current) !== bundle.expectedConfigDigest) fail('HISTORY_UPGRADE_CONFIG_STALE');
    const source = Buffer.from(bundle.sourceSnapshotBase64, 'base64');
    const verified = await prepareLocked(context, source);
    if (stable(verified) !== stable(bundle)) fail('HISTORY_UPGRADE_INPUT_DRIFT');
    const certificateBytes = Buffer.from(encode(verified.certificate));
    const entry = verified.targetConfig.entries.find(entry => entry.projectRoot === verified.certificate.root);
    await persistArtifact(verified.certificate.sourceSnapshot, source, 'snapshot');
    await persistArtifact(entry.deploymentSuccessor, certificateBytes, 'certificate');
    // Immutable proof files are inert until this sole selection point.
    if (deploymentDigest(await readFile(historyDeploymentFile)) !== bundle.expectedConfigDigest) fail('HISTORY_UPGRADE_CONFIG_STALE');
    const finalCheck = await prepareLocked(context, source);
    if (stable(finalCheck) !== stable(bundle)) fail('HISTORY_UPGRADE_INPUT_DRIFT');
    await atomicWrite(historyDeploymentFile, targetBytes);
    await assertHistoricalRunAllowed(context, ['deployment-upgrade-verification'], { fullInventory: true });
    return { status: 'applied', configDigest: deploymentDigest(targetBytes), certificate: entry.deploymentSuccessor };
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [operation, root, sourceOrBundle, output] = process.argv.slice(2);
    if (!root || !path.isAbsolute(root) || !sourceOrBundle || !path.isAbsolute(sourceOrBundle)) throw Error('Use prepare <absolute project> <absolute original config snapshot> <absolute bundle output>, or apply <absolute project> <absolute bundle>.');
    const context = { projectRoot: root, runtimeDir: '.data-editor/runtime' };
    if (operation === 'prepare') {
      if (!output || !path.isAbsolute(output)) throw Error('An absolute bundle output is required.');
      const bundle = await prepareDeploymentUpgrade(context, await readFile(sourceOrBundle));
      const bytes = Buffer.from(encode(bundle));
      try { await writeFile(output, bytes, { flag: 'wx' }); }
      catch (error) { if (error.code !== 'EEXIST' || !bytes.equals(await readFile(output))) throw error; }
      process.stdout.write(`${JSON.stringify({ status: 'prepared', output, expectedConfigDigest: bundle.expectedConfigDigest, targetPolicyDigest: bundle.certificate.targetPolicyDigest })}\n`);
    } else if (operation === 'apply') {
      process.stdout.write(`${JSON.stringify(await applyDeploymentUpgrade(context, JSON.parse(await readFile(sourceOrBundle, 'utf8'))))}\n`);
    } else throw Error('Use prepare or apply.');
  } catch (error) { process.stderr.write(`${JSON.stringify({ code: error.code ?? 'HISTORY_UPGRADE_FAILED', message: error.message })}\n`); process.exitCode = 1; }
}
