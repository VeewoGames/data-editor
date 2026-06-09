import type { PendingDocumentSave, SaveDocumentsResult } from "../api/client";
import type { DocumentModel } from "./documentModel";
import type { PrimaryKeySyncPlan } from "./relationMaintenance";

export type PrimaryKeySyncSaveSnapshot = {
  plan: PrimaryKeySyncPlan;
  pendingSaves: PendingDocumentSave[];
};

export function describePrimaryKeySyncBlockingIssues(plan: PrimaryKeySyncPlan): string;
export function describePrimaryKeySyncSaveResult(result: SaveDocumentsResult): string;
export function buildPrimaryKeySyncSaveSnapshot(input: {
  plan: PrimaryKeySyncPlan;
  currentModel: DocumentModel;
  currentPath: string;
  loadDocument: (path: string) => Promise<DocumentModel>;
}): Promise<PrimaryKeySyncSaveSnapshot>;
