import test from "node:test";
import assert from "node:assert/strict";
import { extractStreamlineBrowserAuthFromText } from "../../scripts/streamline-export/extract-streamline-browser-auth.mjs";

test("extractStreamlineBrowserAuthFromText parses firebase api key and tokens from leveldb text", () => {
  const sample = [
    'refreshToken"\u00e2\u0003AMf-refresh-token-12345"',
    'accessToken"\u0092\teyJ.header.payload.signature"',
    'apiKey"\'AIzaSyBrowserKey_123456789"',
  ].join(" ");

  const result = extractStreamlineBrowserAuthFromText(sample);

  assert.equal(result.apiKey, "AIzaSyBrowserKey_123456789");
  assert.equal(result.accessToken, "eyJ.header.payload.signature");
  assert.equal(result.refreshToken, "AMf-refresh-token-12345");
});
