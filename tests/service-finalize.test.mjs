import assert from "node:assert/strict";
import test from "node:test";
import { parseArgs } from "../scripts/service-finalize.mjs";

test("service-finalize enables recovery before cleanup and keeps the configured temp root", () => {
  const options = parseArgs(["--cleanup", "--recover", "--temp-root", "C:/temp", "--main-port", "9123", "--bridge-port", "9124"]);
  assert.equal(options.cleanup, true);
  assert.equal(options.recover, true);
  assert.equal(options.mainPort, 9123);
  assert.equal(options.bridgePort, 9124);
  assert.match(options.tempRoot, /temp$/i);
});
