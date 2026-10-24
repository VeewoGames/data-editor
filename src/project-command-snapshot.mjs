import crypto from "node:crypto";
import path from "node:path";
import { readFile, realpath } from "node:fs/promises";
import { resolveInsideRoot } from "./project-context.mjs";
import { normalizeAutomationProfile, ruleAuthorityDigest } from "./automation-profile.mjs";
import { canonicalFileIdentity } from "./canonical-file-identity.mjs";

const accepted = new WeakSet();
export const commandDigest = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
export function commandError(code, message = code) { return Object.assign(new Error(message), { code, status: 409 }); }
// The same realpath/platform normalization as canonicalFileIdentity, including
// files that are project inputs rather than selectable data documents.
async function dependencyIdentity(file) {
  let physical;
  try { physical = await realpath(file); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    physical = path.join(await realpath(path.dirname(file)), path.basename(file));
  }
  let canonicalPath = path.resolve(physical).replaceAll("\\", "/");
  if (process.platform === "win32") canonicalPath = canonicalPath.toLowerCase();
  return { canonicalPath, canonicalFileKey: commandDigest(canonicalPath) };
}
export async function projectCommandFile(context, relative) {
  if (typeof relative !== "string" || !relative || relative.includes("\\") || path.posix.normalize(relative) !== relative || path.isAbsolute(relative) || /^[a-z]:/i.test(relative)) throw commandError("PROJECT_COMMAND_PATH_INVALID");
  const root = await realpath(context.projectRoot);
  const target = await realpath(resolveInsideRoot(root, relative));
  resolveInsideRoot(root, target);
  return target;
}
export async function captureProjectCommandSnapshot(context, { sourcePath, documentText, command, action, requestContext }) {
  const validator = action.execution?.proposalValidator?.command;
  const paths = [...new Set([command.path, ...command.readDependencies, ...(validator ? [validator.path, ...validator.readDependencies] : []), ".data-editor/entry-action-contracts.json"])];
  const files = [];
  for (const relative of paths) {
    const file = await projectCommandFile(context, relative);
    files.push({ path: relative, file, digest: commandDigest(await readFile(file)) });
  }
  const profileFile = context.automationProfilePath ?? path.join(context.projectRoot, ".data-editor/automation-profile.json");
  const profileBytes = await readFile(profileFile);
  const declared = normalizeAutomationProfile(JSON.parse(profileBytes)).rules.find(rule => rule.id === action.id);
  if (!declared || ruleAuthorityDigest(declared) !== ruleAuthorityDigest(action)) throw commandError("PROJECT_COMMAND_DEPENDENCY_STALE");
  files.push({ path: null, file: profileFile, digest: commandDigest(profileBytes) });
  const policyFile = path.join(context.projectRoot, ".data-editor", "field-write-policy.json");
  const policyBytes = await readFile(policyFile).catch(error => { if (error.code === "ENOENT") return null; throw error; });
  files.push({ path: null, file: policyFile, digest: policyBytes === null ? null : commandDigest(policyBytes) });
  const sourceIdentity = await canonicalFileIdentity(context, sourcePath);
  for (const item of files) item.identity = await dependencyIdentity(item.file);
  const baseline = { baseDocumentEtag: `"${commandDigest(documentText)}"`, documentText, sourcePath, sourceCanonicalFileKey: sourceIdentity.canonicalFileKey, files };
  if (action.execution?.proposalValidator) {
    if (!requestContext) throw commandError("PROJECT_COMMAND_REQUEST_CONTEXT_REQUIRED");
    baseline.requestContext = structuredClone(requestContext);
    baseline.requestContextDigest = commandDigest(JSON.stringify(baseline.requestContext));
  }
  accepted.add(baseline);
  return baseline;
}
export async function projectCommandCommitIdentities(context, baseline) {
  if (!accepted.has(baseline)) throw commandError("PROJECT_COMMAND_ADMISSION_REQUIRED");
  const sourceIdentity = await canonicalFileIdentity(context, baseline.sourcePath);
  return [sourceIdentity, ...baseline.files.map(item => item.identity)];
}
export async function assertProjectCommandSnapshot(context, baseline, documentText) {
  if (!accepted.has(baseline)) throw commandError("PROJECT_COMMAND_ADMISSION_REQUIRED");
  if ((await canonicalFileIdentity(context, baseline.sourcePath)).canonicalFileKey !== baseline.sourceCanonicalFileKey) throw commandError("PROJECT_COMMAND_DOCUMENT_STALE");
  if (`"${commandDigest(documentText)}"` !== baseline.baseDocumentEtag) throw commandError("PROJECT_COMMAND_DOCUMENT_STALE");
  await assertProjectCommandDependencies(context, baseline);
}

export async function assertProjectCommandDependencies(context, baseline) {
  if (!accepted.has(baseline)) throw commandError("PROJECT_COMMAND_ADMISSION_REQUIRED");
  for (const item of baseline.files) {
    let file;
    try { file = item.path ? await projectCommandFile(context, item.path) : item.file; }
    catch { throw commandError("PROJECT_COMMAND_DEPENDENCY_STALE"); }
    const bytes = await readFile(file).catch(error => { if (error.code === "ENOENT") return null; throw error; });
    if (file !== item.file || (await dependencyIdentity(file)).canonicalFileKey !== item.identity.canonicalFileKey || (bytes === null ? null : commandDigest(bytes)) !== item.digest) throw commandError("PROJECT_COMMAND_DEPENDENCY_STALE");
  }
}

// Recovery authenticates a private durable snapshot against the original rule,
// complete dependency set and exact original document before admitting it.
export async function restoreProjectCommandSnapshot(context, stored, action) {
  if (!stored || typeof stored.documentText !== "string") throw commandError("PROJECT_COMMAND_RECOVERY_BASELINE_INVALID");
  const fresh = await captureProjectCommandSnapshot(context, { sourcePath: stored.sourcePath, documentText: stored.documentText, command: action.execution.command, action, requestContext: stored.requestContext });
  if (JSON.stringify(fresh) !== JSON.stringify(stored)) throw commandError("PROJECT_COMMAND_RECOVERY_DEPENDENCY_STALE");
  return fresh;
}
