import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

export function configurationVersion(bytes) {
  return bytes === null ? { exists: false, digest: null }
    : { exists: true, digest: createHash('sha256').update(bytes).digest('hex') };
}

export async function readConfigurationVersion(target) {
  try { return configurationVersion(await readFile(target)); }
  catch (error) { if (error.code === 'ENOENT') return configurationVersion(null); throw error; }
}

export async function readConfigurationSnapshot(target, normalize, empty) {
  let bytes;
  try { bytes = await readFile(target); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { value: empty(), version: configurationVersion(null) };
  }
  return { value: normalize(JSON.parse(bytes.toString('utf8'))), version: configurationVersion(bytes) };
}

export async function verifyConfigurationWrite(target, text, normalize, empty) {
  const snapshot = await readConfigurationSnapshot(target, normalize, empty);
  if (!isDeepStrictEqual(snapshot.version, configurationVersion(Buffer.from(text)))) {
    throw Object.assign(new Error('配置写入后已变化，改动已保留，需核对当前内容。'), { code: 'CONFIG_POSTWRITE_CHANGED', status: 409 });
  }
  return snapshot;
}

export async function physicalConfigurationPath(target) {
  const absolute = path.resolve(target);
  try { return await realpath(absolute); }
  catch (error) {
    if (error.code !== 'ENOENT' || path.dirname(absolute) === absolute) throw error;
    return path.join(await physicalConfigurationPath(path.dirname(absolute)), path.basename(absolute));
  }
}

export function configurationIdentity(target) {
  const absolute = path.resolve(target).replaceAll('\\', '/');
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
}
