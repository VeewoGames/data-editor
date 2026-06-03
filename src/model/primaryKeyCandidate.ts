import type { DocumentModel } from "./documentModel";

export type PrimaryKeyCandidateConfidence = "high" | "secondary";
export type PrimaryKeyCandidateRule = "suffix-id" | "bare-id";
export type PrimaryKeyCandidate = {
  fieldName: string;
  confidence: PrimaryKeyCandidateConfidence;
  presentCount: number;
  missingCount: number;
  uniqueCount: number;
  rule: PrimaryKeyCandidateRule;
};

export type FilteredPrimaryKeyCandidateReason = "duplicate-values" | "too-many-missing";

export type FilteredPrimaryKeyCandidate = {
  fieldName: string;
  presentCount: number;
  missingCount: number;
  uniqueCount: number;
  rule: PrimaryKeyCandidateRule;
  reasons: FilteredPrimaryKeyCandidateReason[];
};

export type PrimaryKeyCandidateStatus = "configured" | "unconfigured" | "candidate-detected";

export type PrimaryKeyCandidateAnalysis = {
  status: PrimaryKeyCandidateStatus;
  candidates: PrimaryKeyCandidate[];
  filtered: FilteredPrimaryKeyCandidate[];
};

export type AnalyzePrimaryKeyCandidatesInput = {
  model: DocumentModel | null | undefined;
  collectionPath: string;
  configuredPrimaryKey: string | null | undefined;
};

export {
  analyzePrimaryKeyCandidates,
  buildCollectionKey,
  isRecordMapCollection,
} from "./primary-key-candidate.mjs";
