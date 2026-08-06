import crypto from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createProjectContext } from "./project-context.mjs";
import { validateEntryActionPolicy } from "./entry-action-policy.mjs";
import { validateAutomationProfile } from "./automation-profile.mjs";

// This is intentionally a one-way, fail-closed migration. Runtime never reads policy.
export async function migrateLegacyEntryActionPolicy(projectContextOrRoot) {
  const context = createProjectContext(projectContextOrRoot);
  const policyText = await readFile(context.entryActionPolicyPath, "utf8").catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (policyText === null) return { status: "absent" };
  const profileText = await readFile(context.automationProfilePath, "utf8").catch((error) => error?.code === "ENOENT" ? "{\"rules\":[]}" : Promise.reject(error));
  const markerPath = path.join(context.projectRoot, ".data-editor", "entry-action-policy-migration.json");
  const existingMarkerText = await readFile(markerPath, "utf8").catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (existingMarkerText !== null) {
    const marker = parse(existingMarkerText, "migration marker");
    fail("ENTRY_ACTION_POLICY_MIGRATION_RECOVERY_REQUIRED");
  }
  const profileRaw = parse(profileText, "automation profile");
  const policy = validateEntryActionPolicy(parse(policyText, "entry action policy"));
  // A prior migration may have persisted the modern profile before removing the
  // legacy policy. Finish that cleanup instead of re-validating it as legacy.
  try {
    validateAutomationProfile(profileRaw);
    return retireLegacyPolicy({ context, policyText, profileText, markerPath, policy });
  } catch {
    // Continue with the strict legacy conversion path below.
  }
  assertLegacyProfileShape(profileRaw);
  const converted = convertProfile(profileRaw, policy);
  const nextProfileText = `${JSON.stringify(validateAutomationProfile(converted.profile), null, 2)}\n`;
  const migrationId = crypto.randomUUID();
  const backupDirectory = path.join(context.projectRoot, ".data-editor", "entry-action-policy-migration-backups", migrationId);
  const marker = {
    version: 1, migrationId, stage: "profile_ready",
    policyPath: context.entryActionPolicyPath, profilePath: context.automationProfilePath,
    policyDigest: digest(policyText), profileBeforeDigest: digest(profileText), profileAfterDigest: digest(nextProfileText),
    rowMatchActions: converted.rowMatchActions,
    backupDirectory,
  };
  await mkdir(path.dirname(markerPath), { recursive: true });
  await mkdir(backupDirectory, { recursive: true });
  await writeFile(path.join(backupDirectory, "automation-profile.before.json"), profileText, "utf8");
  await copyFile(context.entryActionPolicyPath, path.join(backupDirectory, "entry-action-policy.before.json"));
  await writeFile(markerPath, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
  if (digest(profileText) !== marker.profileBeforeDigest) fail("ENTRY_ACTION_POLICY_MIGRATION_PROFILE_CHANGED");
  await mkdir(path.dirname(context.automationProfilePath), { recursive: true });
  await writeFile(context.automationProfilePath, nextProfileText, "utf8");
  const currentPolicy = await readFile(context.entryActionPolicyPath, "utf8");
  if (digest(currentPolicy) !== marker.policyDigest) fail("ENTRY_ACTION_POLICY_MIGRATION_POLICY_CHANGED");
  await rm(context.entryActionPolicyPath);
  await rm(markerPath, { force: true });
  return converted.rowMatchActions.length
    ? { status: "migrated", droppedRowMatchActions: converted.rowMatchActions }
    : { status: "migrated" };
}

async function retireLegacyPolicy({ context, policyText, profileText, markerPath, policy }) {
  const migrationId = crypto.randomUUID();
  const backupDirectory = path.join(context.projectRoot, ".data-editor", "entry-action-policy-migration-backups", migrationId);
  const marker = {
    version: 1, migrationId, stage: "profile_already_migrated",
    policyPath: context.entryActionPolicyPath, profilePath: context.automationProfilePath,
    policyDigest: digest(policyText), profileBeforeDigest: digest(profileText), profileAfterDigest: digest(profileText),
    rowMatchActions: policy.targets.filter((target) => Object.keys(target.rowMatch).length).map((target) => target.actionId),
    backupDirectory,
  };
  await mkdir(path.dirname(markerPath), { recursive: true });
  await mkdir(backupDirectory, { recursive: true });
  await writeFile(path.join(backupDirectory, "automation-profile.before.json"), profileText, "utf8");
  await copyFile(context.entryActionPolicyPath, path.join(backupDirectory, "entry-action-policy.before.json"));
  await writeFile(markerPath, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
  const currentPolicy = await readFile(context.entryActionPolicyPath, "utf8");
  if (digest(currentPolicy) !== marker.policyDigest) fail("ENTRY_ACTION_POLICY_MIGRATION_POLICY_CHANGED");
  await rm(context.entryActionPolicyPath);
  await rm(markerPath, { force: true });
  return marker.rowMatchActions.length
    ? { status: "already_migrated", droppedRowMatchActions: [...new Set(marker.rowMatchActions)] }
    : { status: "already_migrated" };
}

function convertProfile(profile, policy) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile) || !Array.isArray(profile.rules)) fail("ENTRY_ACTION_POLICY_MIGRATION_PROFILE_INVALID");
  const artifactKeys = new Set(); const rowMatchActions = [];
  const rules = profile.rules.map((rule) => ({ ...rule, execution: rule.execution ?? { kind: "proposal" }, targets: (rule.targets ?? []).map((target) => {
    if (!target || typeof target !== "object" || Array.isArray(target)) fail("ENTRY_ACTION_POLICY_MIGRATION_TARGET_INVALID");
    const legacyId = target.textArtifactId;
    const next = { ...target }; delete next.textArtifactId;
    if (legacyId != null) {
      const artifact = policy.textArtifacts.find((item) => item.actionId === rule.id && item.id === legacyId);
      if (!artifact) fail("ENTRY_ACTION_POLICY_MIGRATION_ARTIFACT_UNMAPPED");
      artifactKeys.add(`${artifact.actionId}\u0000${artifact.id}`);
      next.textArtifact = { pathTemplate: artifact.pathTemplate, sourceField: artifact.sourceField, allowCreate: artifact.allowCreate, allowUpdate: artifact.allowUpdate, maxBytes: artifact.maxBytes };
    }
    return next;
  }) }));
  for (const artifact of policy.textArtifacts) if (!artifactKeys.has(`${artifact.actionId}\u0000${artifact.id}`)) fail("ENTRY_ACTION_POLICY_MIGRATION_ARTIFACT_UNREFERENCED");
  for (const target of policy.targets) if (Object.keys(target.rowMatch).length) rowMatchActions.push(target.actionId);
  return { profile: { rules }, rowMatchActions: [...new Set(rowMatchActions)] };
}
function assertLegacyProfileShape(profile) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile) || !Array.isArray(profile.rules)) fail("ENTRY_ACTION_POLICY_MIGRATION_PROFILE_INVALID");
  const ruleIds = new Set();
  const targets = new Set();
  for (const rule of profile.rules) {
    if (!rule || typeof rule !== "object" || Array.isArray(rule) || typeof rule.id !== "string" || !rule.id.trim() || ruleIds.has(rule.id)) fail("ENTRY_ACTION_POLICY_MIGRATION_PROFILE_INVALID");
    ruleIds.add(rule.id);
    if (!Array.isArray(rule.targets)) fail("ENTRY_ACTION_POLICY_MIGRATION_PROFILE_INVALID");
    for (const target of rule.targets) {
      if (!target || typeof target !== "object" || Array.isArray(target)
        || ![2, 3].includes(Object.keys(target).length)
        || !Object.hasOwn(target, "file") || !Object.hasOwn(target, "collection")
        || (Object.keys(target).length === 3 && !Object.hasOwn(target, "textArtifactId"))
        || typeof target.file !== "string" || !target.file.trim() || typeof target.collection !== "string" || !target.collection.trim()
        || (Object.hasOwn(target, "textArtifactId") && (typeof target.textArtifactId !== "string" || !target.textArtifactId.trim()))) {
        fail("ENTRY_ACTION_POLICY_MIGRATION_PROFILE_INVALID");
      }
      const key = `${rule.id}\u0000${target.file}\u0000${target.collection}`;
      if (targets.has(key)) fail("ENTRY_ACTION_POLICY_MIGRATION_PROFILE_INVALID");
      targets.add(key);
    }
  }
}
function parse(text, label) { try { return JSON.parse(text); } catch { fail(`ENTRY_ACTION_POLICY_MIGRATION_${label.toUpperCase().replaceAll(" ", "_")}_INVALID`); } }
function digest(text) { return crypto.createHash("sha256").update(text, "utf8").digest("hex"); }
function fail(code) { throw Object.assign(new Error(code), { code }); }
