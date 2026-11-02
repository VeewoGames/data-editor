import { withHistoricalFileEffect } from './historical-disposition.mjs';
import * as io from './atomic-file-core.mjs';
export { defaultAtomicReplaceOptions } from './atomic-file-core.mjs';

// Existing domains keep their existing admission. Current-profile domain uses
// the same durable primitive only inside its complete current admission.
export const exclusiveCreateLock = (target, payload, options = {}) =>
  withHistoricalFileEffect(target, payload, () => io.exclusiveCreateLock(target, payload, options));
export const atomicReplace = (source, target, options = {}) =>
  withHistoricalFileEffect(target, null, () => io.atomicReplace(source, target, options));
export const atomicWrite = (target, data, options = {}) =>
  withHistoricalFileEffect(target, data, () => io.atomicWrite(target, data, options));
