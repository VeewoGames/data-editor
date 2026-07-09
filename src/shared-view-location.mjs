function normalizeString(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function normalizeCollectionPath(value) {
  return normalizeString(value) ?? "$";
}

export function readSharedViewUrlLocation(input) {
  const url = input instanceof URL ? input : new URL(input.href);
  const params = url.searchParams;
  return {
    projectId: normalizeString(params.get("projectId")),
    path: normalizeString(params.get("path")),
    collectionPath: normalizeCollectionPath(params.get("collectionPath")),
    viewId: normalizeString(params.get("viewId")),
  };
}

export function writeSharedViewUrlLocation(url, location) {
  const nextUrl = url instanceof URL ? new URL(url.toString()) : new URL(String(url));
  const params = nextUrl.searchParams;
  const projectId = normalizeString(location?.projectId);
  const path = normalizeString(location?.path);
  const collectionPath = normalizeCollectionPath(location?.collectionPath);
  const viewId = normalizeString(location?.viewId);

  if (projectId) params.set("projectId", projectId);
  else params.delete("projectId");

  if (path) params.set("path", path);
  else params.delete("path");

  if (collectionPath) params.set("collectionPath", collectionPath);
  else params.delete("collectionPath");

  if (viewId) params.set("viewId", viewId);
  else params.delete("viewId");

  return nextUrl;
}

export function clearSharedViewUrlLocation(url) {
  const nextUrl = url instanceof URL ? new URL(url.toString()) : new URL(String(url));
  nextUrl.searchParams.delete("projectId");
  nextUrl.searchParams.delete("path");
  nextUrl.searchParams.delete("collectionPath");
  nextUrl.searchParams.delete("viewId");
  return nextUrl;
}

export function buildSharedViewUrl(currentUrl, input) {
  const nextUrl = writeSharedViewUrlLocation(new URL(currentUrl), input);
  if (/^#view=/i.test(nextUrl.hash)) nextUrl.hash = "";
  return nextUrl.toString();
}
