export type TargetingViewFieldMigrationIssue = {
  store: string;
  location: string;
  fieldPath: Array<string | number>;
  oldField: string | null;
  newField: string | null;
  reason: string;
  message: string | null;
};
export type TargetingViewFieldMigrationReport = {
  migrated: TargetingViewFieldMigrationIssue[];
  manual: TargetingViewFieldMigrationIssue[];
};
export const targetingViewFieldMap: Readonly<Record<string, string>>;
export function migrateTargetingViewValue(value: unknown, options?: { store?: string; location?: string; availableFields?: Iterable<string> | null }): { value: unknown; changed: boolean; report: TargetingViewFieldMigrationReport };
export function migrateTargetingViewLocalStorage(localStorage: Storage, options?: { apply?: boolean; availableFields?: Iterable<string> | null }): { changed: boolean; applied: boolean; report: TargetingViewFieldMigrationReport };
