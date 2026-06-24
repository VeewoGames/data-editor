import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const defaultIndexedDbDir = "C:/Users/lans/AppData/Local/Google/Chrome/User Data/Default/IndexedDB/https_www.streamlinehq.com_0.indexeddb.leveldb";

function takeNewestFiles(entries, limit = 5) {
  return [...entries]
    .filter((entry) => entry.isFile() && (entry.name.endsWith(".ldb") || entry.name.endsWith(".log")))
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, limit);
}

function collectMatches(text, pattern) {
  const matches = [];
  for (const match of text.matchAll(pattern)) {
    if (match[1]) {
      matches.push(match[1]);
    }
  }
  return matches;
}

function pickLongest(values) {
  return [...values]
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)[0] ?? "";
}

export function extractStreamlineBrowserAuthFromText(text) {
  const source = String(text ?? "");
  const apiKey = pickLongest(collectMatches(source, /apiKey"[^A-Za-z0-9_-]*(AIza[0-9A-Za-z_-]+)/g));
  const accessToken = pickLongest(collectMatches(source, /accessToken"[^A-Za-z0-9._-]*(eyJ[0-9A-Za-z._-]+)/g));
  const refreshToken = pickLongest(collectMatches(source, /refreshToken"[^A-Za-z0-9._-]*(AMf-[0-9A-Za-z._-]+)/g));
  return {
    apiKey,
    accessToken,
    refreshToken,
  };
}

export async function extractStreamlineBrowserAuth({
  indexedDbDir = defaultIndexedDbDir,
  fileLimit = 5,
} = {}) {
  const entries = await readdir(indexedDbDir, { withFileTypes: true });
  const files = takeNewestFiles(entries, fileLimit);
  const texts = await Promise.all(files.map(async (entry) => {
    const statPath = join(indexedDbDir, entry.name);
    return readFile(statPath, "latin1");
  }));
  const combined = texts.join("\n");
  const auth = extractStreamlineBrowserAuthFromText(combined);
  return {
    indexedDbDir,
    scannedFiles: files.map((entry) => entry.name),
    ...auth,
  };
}

async function main() {
  const result = await extractStreamlineBrowserAuth();
  console.log(JSON.stringify({
    indexedDbDir: result.indexedDbDir,
    scannedFiles: result.scannedFiles,
    hasApiKey: Boolean(result.apiKey),
    apiKeyLength: result.apiKey.length,
    hasAccessToken: Boolean(result.accessToken),
    accessTokenLength: result.accessToken.length,
    hasRefreshToken: Boolean(result.refreshToken),
    refreshTokenLength: result.refreshToken.length,
  }, null, 2));
}

if (typeof process !== "undefined" && process.argv?.[1]?.endsWith("extract-streamline-browser-auth.mjs")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
