import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import test from "node:test";
import { rowDigestBrowser } from "../src/row-digest-browser.mjs";

test("browser row digest matches the server admission digest", async () => {
  const originalCrypto = globalThis.crypto;
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: webcrypto });
  try {
    const row = { name: "Strike", nested: { z: 1, a: [true, 0] } };
    const stable = '{"name":"Strike","nested":{"a":[true,0],"z":1}}';
    assert.equal(await rowDigestBrowser(row), createHash("sha256").update(stable).digest("hex"));
  } finally {
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: originalCrypto });
  }
});
