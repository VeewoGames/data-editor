import assert from "node:assert/strict";
import test from "node:test";
import { loadAutomationProfile, saveAutomationProfile } from "../src/api/client.ts";

test("loading and saving project-command settings preserves its required validator", async () => {
  const originalFetch = globalThis.fetch;
  const command = { path: "tools/generate.mjs", args: [], readDependencies: [], timeoutMs: 1000 };
  const proposalValidator = { version: 1, command: { ...command, path: "tools/validate.mjs", readDependencies: ["contracts/input.json"] } };
  const execution = { kind: "project-command", resultPolicy: "proposal", allowConcurrentSave: true, command, proposalValidator };
  const profile = { rules: [{ id: "compile", label: "Compile", icon: "refresh", targets: [{ file: "data/items.json", collection: "$" }], payload: { includeRow: true, includeNeighbors: false }, execution, contractId: "fixture.command.v1" }] };
  let saved;
  globalThis.fetch = async (_url, options) => {
    if (options?.method === "POST") saved = JSON.parse(options.body).profile;
    return new Response(JSON.stringify(options?.method === "POST" ? { ok: true } : profile), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const loaded = await loadAutomationProfile("fixture");
    assert.deepEqual(loaded.rules[0].execution, execution);
    await saveAutomationProfile(loaded, "fixture");
    assert.deepEqual(saved.rules[0].execution, execution);
  } finally { globalThis.fetch = originalFetch; }
});
