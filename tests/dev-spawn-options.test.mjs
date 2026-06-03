import test from "node:test";
import assert from "node:assert/strict";
import { buildDevChildSpawnOptions, isBackgroundDevProcess } from "../src/dev-spawn-options.mjs";

test("background dev child processes hide windows and detach from inherited stdio", () => {
  assert.equal(isBackgroundDevProcess({ DATA_EDITOR_BACKGROUND: "1" }), true);
  assert.deepEqual(buildDevChildSpawnOptions(true), {
    shell: false,
    stdio: ["ignore", "ignore", "ignore"],
    windowsHide: true,
  });
});

test("interactive dev child processes keep inherited stdio", () => {
  assert.equal(isBackgroundDevProcess({}), false);
  assert.deepEqual(buildDevChildSpawnOptions(false), {
    shell: false,
    stdio: "inherit",
    windowsHide: false,
  });
});
