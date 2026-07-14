import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createProjectContext } from "../project-context.mjs";
import {
  migrateTargetingViewLocalStorage,
  migrateTargetingViewValue,
} from "./targeting-view-field-migration.mjs";

export async function migrateTargetingViewStorage(projectContextOrRoot, { apply = false, availableFields = null } = {}) {
  const context = createProjectContext(projectContextOrRoot);
  const report = createReport();
  const files = [
    { store: "shared_view", file: path.join(context.projectRoot, ".data-editor", "shared-views.json") },
    ...await profileFiles(context),
  ];
  const seen = new Set();
  const pendingWrites = [];

  for (const entry of files) {
    const target = path.resolve(entry.file);
    const key = target.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    let raw;
    try {
      raw = await readFile(target, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      report.manual.push(issue(entry.store, target, "read_error", error.message));
      continue;
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      report.manual.push(issue(entry.store, target, "invalid_json", error.message));
      continue;
    }

    const result = migrateTargetingViewValue(parsed, {
      store: entry.store,
      location: target,
      availableFields,
    });
    mergeReport(report, result.report);
    if (result.changed) pendingWrites.push({ target, value: result.value });
  }

  const applyAllowed = report.manual.length === 0;
  if (apply && applyAllowed) {
    for (const pending of pendingWrites) {
      await mkdir(path.dirname(pending.target), { recursive: true });
      await writeFile(pending.target, `${JSON.stringify(pending.value, null, 2)}\n`, "utf8");
    }
  }

  return { changed: report.migrated.length > 0, applied: apply && applyAllowed, applyAllowed, report };
}

export async function migrateAllTargetingViewStorage({ projectContext, localStorage }, options = {}) {
  const filePreview = await migrateTargetingViewStorage(projectContext, { ...options, apply: false });
  const localPreview = migrateTargetingViewLocalStorage(localStorage, { ...options, apply: false });
  const report = createReport();
  mergeReport(report, filePreview.report);
  mergeReport(report, localPreview.report);
  const applyAllowed = report.manual.length === 0;

  if (options.apply === true && applyAllowed) {
    await migrateTargetingViewStorage(projectContext, { ...options, apply: true });
    migrateTargetingViewLocalStorage(localStorage, { ...options, apply: true });
  }

  return {
    changed: report.migrated.length > 0,
    applied: options.apply === true && applyAllowed,
    applyAllowed,
    report,
  };
}

async function profileFiles(context) {
  const projectProfiles = path.join(context.projectRoot, ".data-editor", "view-configs");
  const dirs = [
    { store: "profile", dir: projectProfiles },
    {
      store: path.resolve(context.userViewProfilesDir) === path.resolve(projectProfiles) ? "profile" : "profile_home",
      dir: context.userViewProfilesDir,
    },
  ];
  const result = [];
  for (const entry of dirs) {
    try {
      const children = await readdir(entry.dir, { withFileTypes: true });
      for (const child of children) {
        if (child.isFile() && path.extname(child.name).toLowerCase() === ".json") {
          result.push({ store: entry.store, file: path.join(entry.dir, child.name) });
        }
      }
    } catch (error) {
      if (error?.code !== "ENOENT") result.push({ store: entry.store, file: entry.dir });
    }
  }
  return result;
}

function createReport() {
  return { migrated: [], manual: [] };
}

function mergeReport(target, source) {
  target.migrated.push(...source.migrated);
  target.manual.push(...source.manual);
}

function issue(store, location, reason, message) {
  return { store, location, fieldPath: [], oldField: null, newField: null, reason, message };
}
