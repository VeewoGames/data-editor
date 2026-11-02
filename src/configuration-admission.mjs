import { withProjectProcessLock } from './project-process-lock.mjs';

/** Current OS-held eligibility lifetime, never a saved receipt. A successful
 * acquisition proves preceding HTTP grants have lost eligibility; keep it held
 * while waiting for already-admitted effect IO and reading the current file.
 */
export async function acquireConfigurationAdmission(resourceKey, { timeoutMs = 15000 } = {}) {
  let release, acquired, failed;
  const held = new Promise(resolve => { release = resolve; });
  const ready = new Promise((resolve, reject) => { acquired = resolve; failed = reject; });
  const lifetime = withProjectProcessLock('configuration-admission:' + resourceKey, async () => {
    acquired();
    await held;
  }, { timeoutMs });
  void lifetime.catch(failed);
  await ready;
  return { close() { release(); return lifetime; } };
}
