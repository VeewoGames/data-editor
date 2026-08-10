export function deriveTextArtifactPath(policy, row) {
  if (!policy?.pathTemplate || !policy?.pathKeyField || !plain(row)) fail();
  const key = row[policy.pathKeyField];
  if (typeof key !== "string" || !/^[A-Za-z0-9_-]+$/.test(key)) fail();
  const result = policy.pathTemplate.replaceAll("{key}", key);
  if (!result || result.includes("\\") || result.startsWith("/") || /^[A-Za-z]:/.test(result) || result.split("/").includes("..")) fail();
  return result;
}
function plain(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function fail() { throw Object.assign(new Error("Text artifact path policy is invalid."), { code: "CANDIDATE_CREATE_TEXT_ARTIFACT_POLICY_INVALID" }); }
