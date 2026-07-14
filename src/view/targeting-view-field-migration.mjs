export const targetingViewFieldMap = Object.freeze({
  range_type_show: "@selection_type",
  range_value_show: "@selection_distance",
});

const sharedViewDraftsStorageKey = "data-editor:shared-view-drafts";
const fieldListKeys = new Set(["hidden", "wrapped", "order", "detailOrder"]);

export function migrateTargetingViewValue(value, { store = "unknown", location = "<memory>", availableFields = null } = {}) {
  const next = structuredClone(value);
  const report = createReport();
  visitValue(next, { store, location, path: [], report, availableFields: normalizeAvailableFields(availableFields) });
  return { value: next, changed: report.migrated.length > 0, report };
}

export function migrateTargetingViewLocalStorage(localStorage, options = {}) {
	if (options.apply === true) {
		const preview = migrateTargetingViewLocalStorage(localStorage, { ...options, apply: false });
		if (preview.report.manual.length > 0) return { ...preview, applied: false };
	}
  const report = createReport();
  const draftRaw = localStorage.getItem(sharedViewDraftsStorageKey);
  if (draftRaw) {
    try {
      const result = migrateTargetingViewValue(JSON.parse(draftRaw), {
        store: "drafts",
        location: sharedViewDraftsStorageKey,
        availableFields: options.availableFields,
      });
      mergeReport(report, result.report);
      if (result.changed && options.apply === true) {
        localStorage.setItem(sharedViewDraftsStorageKey, JSON.stringify(result.value));
      }
    } catch (error) {
      report.manual.push(issue("drafts", sharedViewDraftsStorageKey, [], null, null, "invalid_json", error.message));
    }
  }

  const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).filter(Boolean);
  for (const key of keys) {
    const fieldMigration = migrateLocalStorageFieldKey(key);
    if (fieldMigration) {
      if (localStorage.getItem(fieldMigration.nextKey) != null) {
        report.manual.push(issue("local_storage", key, [], fieldMigration.oldField, fieldMigration.newField, "key_conflict"));
        continue;
      }
		report.migrated.push(issue("local_storage", key, [], fieldMigration.oldField, fieldMigration.newField, "field_key"));
      if (options.apply === true) {
        localStorage.setItem(fieldMigration.nextKey, localStorage.getItem(key));
        localStorage.removeItem(key);
      }
      continue;
    }
    if (key.endsWith(":__order") || key.endsWith(":__detail-order")) {
      const result = migrateCommaSeparatedFieldList(localStorage.getItem(key));
      if (result.conflict) {
        report.manual.push(issue(
          "local_storage",
          key,
          [result.conflict.index],
          result.conflict.oldField,
          result.conflict.newField,
          "field_conflict",
        ));
        continue;
      }
      if (!result.changed) continue;
      for (const change of result.changes) {
        report.migrated.push(issue("local_storage", key, [], change.oldField, change.newField, "field_list"));
      }
      if (options.apply === true) localStorage.setItem(key, result.value);
    }
  }
  return { changed: report.migrated.length > 0, applied: options.apply === true, report };
}

function visitValue(value, context) {
  if (Array.isArray(value)) {
    const conflict = findObjectFieldReferenceConflict(value);
    if (conflict) {
      context.report.manual.push(issue(
        context.store,
        context.location,
        [...context.path, conflict.index, conflict.key],
        conflict.oldField,
        conflict.newField,
        "field_conflict",
      ));
      return;
    }
    value.forEach((item, index) => visitValue(item, { ...context, path: [...context.path, index] }));
    return;
  }
  if (!isPlainObject(value)) return;

  if (typeof value.field === "string") migrateFieldProperty(value, "field", context);
  if (typeof value.fieldName === "string") migrateFieldProperty(value, "fieldName", context);
  for (const key of fieldListKeys) {
    if (Array.isArray(value[key])) migrateFieldArray(value, key, context);
  }
  if (isPlainObject(value.widths)) migrateFieldRecord(value, "widths", context);
  for (const [key, child] of Object.entries(value)) {
    visitValue(child, { ...context, path: [...context.path, key] });
  }
}

function migrateFieldProperty(owner, key, context) {
  const oldField = owner[key];
  const newField = targetingViewFieldMap[oldField];
  if (newField) {
    owner[key] = newField;
    context.report.migrated.push(issue(context.store, context.location, [...context.path, key], oldField, newField, "field_reference"));
    return;
  }
  reportUnavailableField(oldField, context, [...context.path, key]);
}

function migrateFieldArray(owner, key, context) {
  const conflict = findFieldReferenceConflict(owner[key]);
  if (conflict) {
    context.report.manual.push(issue(
      context.store,
      context.location,
      [...context.path, key, conflict.index],
      conflict.oldField,
      conflict.newField,
      "field_conflict",
    ));
    return;
  }
  owner[key] = owner[key].map((oldField, index) => {
    if (typeof oldField !== "string") return oldField;
    const newField = targetingViewFieldMap[oldField];
    if (newField) {
      context.report.migrated.push(issue(context.store, context.location, [...context.path, key, index], oldField, newField, "field_reference"));
      return newField;
    }
    reportUnavailableField(oldField, context, [...context.path, key, index]);
    return oldField;
  });
}

function migrateFieldRecord(owner, key, context) {
	const entries = Object.entries(owner[key]);
	for (const [oldField] of entries) {
		const newField = targetingViewFieldMap[oldField];
		if (newField && Object.hasOwn(owner[key], newField)) {
			context.report.manual.push(issue(context.store, context.location, [...context.path, key, oldField], oldField, newField, "field_conflict"));
			return;
		}
	}
  const next = {};
	for (const [oldField, fieldValue] of entries) {
    const newField = targetingViewFieldMap[oldField] ?? oldField;
    if (newField !== oldField) {
      context.report.migrated.push(issue(context.store, context.location, [...context.path, key, oldField], oldField, newField, "field_reference"));
    } else {
      reportUnavailableField(oldField, context, [...context.path, key, oldField]);
    }
    if (Object.hasOwn(next, newField)) {
      context.report.manual.push(issue(context.store, context.location, [...context.path, key, oldField], oldField, newField, "field_conflict"));
      next[oldField] = fieldValue;
    } else {
      next[newField] = fieldValue;
    }
  }
  owner[key] = next;
}

function reportUnavailableField(fieldName, context, fieldPath) {
  if (!context.availableFields || context.availableFields.has(fieldName)) return;
  context.report.manual.push(issue(
    context.store,
    context.location,
    fieldPath,
    fieldName,
    null,
    "unavailable_field_preserved",
    "The field reference was preserved for manual migration.",
  ));
}

function migrateLocalStorageFieldKey(key) {
  for (const [oldField, newField] of Object.entries(targetingViewFieldMap)) {
    for (const suffix of ["hidden", "wrapped", "width"]) {
      const tail = `:${oldField}:${suffix}`;
      if (key.endsWith(tail)) {
        return { oldField, newField, nextKey: `${key.slice(0, -tail.length)}:${newField}:${suffix}` };
      }
    }
  }
  return null;
}

function migrateCommaSeparatedFieldList(value) {
  const fields = String(value ?? "").split(",");
  const conflict = findFieldReferenceConflict(fields);
  if (conflict) return { changed: false, value: String(value ?? ""), changes: [], conflict };
  const changes = [];
  const next = fields.map((field) => {
    const newField = targetingViewFieldMap[field];
    if (!newField) return field;
    changes.push({ oldField: field, newField });
    return newField;
  });
  return { changed: changes.length > 0, value: next.join(","), changes, conflict: null };
}

function findObjectFieldReferenceConflict(values) {
  const references = values.map((value) => {
    if (!isPlainObject(value)) return null;
    if (typeof value.field === "string") return { field: value.field, key: "field" };
    if (typeof value.fieldName === "string") return { field: value.fieldName, key: "fieldName" };
    return null;
  });
  return findFieldReferenceConflict(references, (reference) => reference?.field, (reference) => reference?.key);
}

function findFieldReferenceConflict(values, getField = (value) => typeof value === "string" ? value : null, getKey = () => null) {
  const seen = new Map();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    const oldField = getField(value);
    if (oldField == null) continue;
    const newField = targetingViewFieldMap[oldField] ?? oldField;
    const previous = seen.get(newField);
    if (previous && previous.oldField !== oldField
      && (targetingViewFieldMap[previous.oldField] || targetingViewFieldMap[oldField])) {
      return {
        index,
        key: getKey(value),
        oldField,
        newField,
      };
    }
    if (!previous) seen.set(newField, { oldField, index });
  }
  return null;
}

function normalizeAvailableFields(value) {
  if (value == null) return null;
  return value instanceof Set ? value : new Set(value);
}

function createReport() {
  return { migrated: [], manual: [] };
}

function mergeReport(target, source) {
  target.migrated.push(...source.migrated);
  target.manual.push(...source.manual);
}

function issue(store, location, fieldPath, oldField, newField, reason, message = null) {
  return { store, location, fieldPath, oldField, newField, reason, message };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
