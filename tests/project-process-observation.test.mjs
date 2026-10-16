import assert from "node:assert/strict";
import test from "node:test";
import { acceptsProjectProcessObservation, singleFlightPoll } from "../src/project-process-observation.mjs";

test("late observations never regress another page/CLI intent or declaration", () => {
  const current = { projectId: "one", processId: "process", generation: 4, declarationDigest: "decl", intentVersion: 9 };
  assert.equal(acceptsProjectProcessObservation(current, { ...current, intentVersion: 8 }, 4), false);
  assert.equal(acceptsProjectProcessObservation(current, { ...current, intentVersion: 9 }, 3), false);
  assert.equal(acceptsProjectProcessObservation(current, { ...current, projectId: "another" }, 4), false);
  assert.equal(acceptsProjectProcessObservation(current, { ...current, declarationDigest: "old" }, 4), false);
  assert.equal(acceptsProjectProcessObservation(current, { ...current, intentVersion: 10 }, 4), true);
  assert.equal(acceptsProjectProcessObservation(current, { ...current, declarationDigest: "new", intentVersion: 0 }, 5), true);
  assert.equal(acceptsProjectProcessObservation(current, null, 3), false);
  assert.equal(acceptsProjectProcessObservation(current, null, 5), true);
});

test("slow or failed polling remains single flight and releases its gate", async () => {
  let resolve, calls = 0;
  const poll = singleFlightPoll(() => { calls++; return new Promise(done => { resolve = done; }); });
  const first = poll(); assert.equal(await poll(), false); assert.equal(calls, 1);
  resolve(); assert.equal(await first, true);
  const next = poll(); assert.equal(calls, 2); resolve(); await next;
  let attempt = 0;
  const failing = singleFlightPoll(async () => { if (++attempt === 1) throw Error("temporary"); });
  await assert.rejects(failing(), /temporary/); assert.equal(await failing(), true);
});
