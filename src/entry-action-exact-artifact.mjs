import crypto from "node:crypto";

const DIGEST = /^[0-9a-f]{64}$/;
const SAFE = /^[A-Za-z0-9._-]+$/;

export async function submitExactArtifact(request, {
  readArtifact,
  admitFreshRun,
  submitAdmittedResult,
  submitFreshArtifact,
  createRunId = () => crypto.randomUUID(),
}) {
  const value = validateExactArtifactSubmission(request);
  if (typeof readArtifact !== "function" || (typeof submitFreshArtifact !== "function" && (typeof admitFreshRun !== "function" || typeof submitAdmittedResult !== "function"))) fail("EXACT_ARTIFACT_DEPENDENCY_INVALID", 500);
  const artifact = await readArtifact({ artifactId: value.artifactId });
  if (!artifact || typeof artifact.content !== "string" || digest(artifact.content) !== value.artifactDigest) fail("EXACT_ARTIFACT_DIGEST_MISMATCH", 409);
  const runId = createRunId();
  if (typeof submitFreshArtifact === "function") {
    const submitted = await submitFreshArtifact({ ...value, runId, artifact });
    if (!submitted || submitted.runId !== runId) fail("EXACT_ARTIFACT_ADMISSION_INVALID", 409);
    return submitted;
  }
  const admission = await admitFreshRun({ ...value, runId, artifact });
  if (!admission || admission.runId !== runId || !admission.authoritySnapshot || !admission.lease || !admission.baseDocumentEtag) fail("EXACT_ARTIFACT_ADMISSION_INVALID", 409);
  return submitAdmittedResult({ runId, request: value, artifact, admission });
}

export function validateExactArtifactSubmission(value) {
  const fields = ["actionId", "artifactDigest", "artifactId", "projectId", "target"];
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== fields.length || fields.some((field) => !Object.hasOwn(value, field))) fail("EXACT_ARTIFACT_REQUEST_INVALID");
  for (const field of ["projectId", "actionId", "artifactId"]) if (typeof value[field] !== "string" || !SAFE.test(value[field])) fail("EXACT_ARTIFACT_REQUEST_INVALID");
  if (!DIGEST.test(value.artifactDigest) || !value.target || typeof value.target !== "object" || Array.isArray(value.target)) fail("EXACT_ARTIFACT_REQUEST_INVALID");
  const targetFields = ["collectionPath", "sourcePath"];
  if (Object.keys(value.target).length !== targetFields.length || targetFields.some((field) => typeof value.target[field] !== "string" || !value.target[field] || value.target[field].includes("\\") || value.target[field].split("/").includes(".."))) fail("EXACT_ARTIFACT_REQUEST_INVALID");
  return structuredClone(value);
}

function digest(value) { return crypto.createHash("sha256").update(value, "utf8").digest("hex"); }
function fail(code, status = 400) { throw Object.assign(new Error(code), { code, status }); }
