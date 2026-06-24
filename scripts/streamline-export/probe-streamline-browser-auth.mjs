import { extractStreamlineBrowserAuth } from "./extract-streamline-browser-auth.mjs";

async function hit(url, headers = {}) {
  try {
    const response = await fetch(url, {
      headers,
      redirect: "manual",
    });
    const text = await response.text();
    return {
      url,
      status: response.status,
      contentType: response.headers.get("content-type") || null,
      location: response.headers.get("location") || null,
      bodyHead: text.slice(0, 180).replace(/\s+/g, " "),
    };
  } catch (error) {
    return {
      url,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    };
  }
}

export async function probeStreamlineBrowserAuth() {
  const auth = await extractStreamlineBrowserAuth();
  const bearer = auth.accessToken ? { Authorization: `Bearer ${auth.accessToken}` } : {};
  const both = auth.apiKey ? { ...bearer, "X-API-Key": auth.apiKey } : bearer;
  const results = [];

  results.push(await hit(
    "https://www.streamlinehq.com/icons/download/book-flip-previous-page-arrow--23736",
    bearer,
  ));
  results.push(await hit(
    "https://www.streamlinehq.com/icons/download/book-flip-previous-page-arrow--23736",
    both,
  ));
  results.push(await hit(
    "https://public-api.streamlinehq.com/mcp",
    {
      ...both,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    },
  ));

  return {
    authSummary: {
      hasApiKey: Boolean(auth.apiKey),
      apiKeyLength: auth.apiKey.length,
      hasAccessToken: Boolean(auth.accessToken),
      accessTokenLength: auth.accessToken.length,
      hasRefreshToken: Boolean(auth.refreshToken),
      refreshTokenLength: auth.refreshToken.length,
      scannedFiles: auth.scannedFiles,
    },
    results,
  };
}

async function main() {
  console.log(JSON.stringify(await probeStreamlineBrowserAuth(), null, 2));
}

if (typeof process !== "undefined" && process.argv?.[1]?.endsWith("probe-streamline-browser-auth.mjs")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
