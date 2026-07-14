import type { TargetingViewFieldMigrationReport } from "./targeting-view-field-migration.mjs";

export type TargetingViewStorageMigrationResult = {
  changed: boolean;
  applied: boolean;
  applyAllowed: boolean;
  report: TargetingViewFieldMigrationReport;
};

export function migrateTargetingViewStorage(
  projectContextOrRoot: unknown,
  options?: { apply?: boolean; availableFields?: Iterable<string> | null },
): Promise<TargetingViewStorageMigrationResult>;

export function migrateAllTargetingViewStorage(
  stores: { projectContext: unknown; localStorage: Storage },
  options?: { apply?: boolean; availableFields?: Iterable<string> | null },
): Promise<TargetingViewStorageMigrationResult>;
