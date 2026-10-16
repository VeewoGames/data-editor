import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { readFile, writeFile, rm } from "node:fs/promises";
import { createProjectProcessService } from "../src/project-process-service.mjs";
import { resolveProjectCapabilityState } from "../src/project-capability-registry.mjs";
import { normalizeManifest } from "../src/project-capability-manifest.mjs";
import { loadProjectRegistry, saveProjectRegistry } from "../src/project-registry.mjs";
import { spawnPersistentProcess } from "../src/persistent-process.mjs";
import { randomUUID } from "node:crypto";
import { fixture, binding } from "./project-process-support.mjs";

const windows = { skip: process.platform !== "win32", timeout: 120000 };
test("process declaration is narrow, max one, root-contained and no document match", windows, async t => {
  const f = await fixture(t);
  const context = { projectRoot: f.root, projectId: "fixture-project" };
  assert.equal(normalizeManifest(f.manifest, context).capabilities.projectProcesses[0].id, binding.id);
  for (const bad of [{ ...binding, match: {} }, { ...binding, entry: "../escape.mjs" }, { ...binding, argv: ["anything"] }]) {
    assert.throws(() => normalizeManifest({ ...f.manifest, capabilities: { projectProcesses: [bad] } }, context));
  }
  assert.throws(() => normalizeManifest({ ...f.manifest, capabilities: { projectProcesses: [binding, { ...binding, id: "two" }] } }, context));
  await rm(path.join(f.root, binding.entry));
  const project = (await loadProjectRegistry({ home: f.home })).projects[0];
  assert.equal((await resolveProjectCapabilityState(project, { home: f.home })).status, "active");
  assert.equal((await f.current()).state, "unknown");
});

test("permission required, original action bound, source maintenance does not revoke trust", windows, async t => {
  const f = await fixture(t);
  const initial = await f.current(); assert.equal(initial.desiredEnabled, false); assert.equal(initial.authorized, false); assert.equal(initial.canStart, true);
  const pending = await f.owner.control(f.request(initial, "start"));
  assert.equal(pending.code, "AUTH_REQUIRED"); assert.equal(pending.desiredEnabled, false); assert.equal(pending.intentVersion, 0);
  await assert.rejects(f.owner.authorize({ ...pending.authorizationRequest, action: "stop" }), { code: "PROCESS_AUTHORIZATION_STALE" });
  await assert.rejects(f.owner.authorize({ ...pending.authorizationRequest, trusted: true }), { code: "PROCESS_REQUEST_INVALID" });
  const running = await f.owner.authorize(pending.authorizationRequest); assert.equal(running.state, "running"); assert.equal(running.authorized, true);
  const oldSource = await readFile(path.join(f.root, binding.entry), "utf8"); await writeFile(path.join(f.root, binding.entry), `${oldSource}\n// ordinary code maintenance\n`);
  assert.equal((await f.current()).authorized, true);
  const stopped = await f.owner.control(f.request(await f.current(), "stop")); assert.equal(stopped.state, "stopped"); assert.equal(stopped.desiredEnabled, false);
});

test("first stop persists false without permission and survives cancel/reopen", windows, async t => {
  const f = await fixture(t);
  const stopped = await f.owner.control(f.request(await f.current(), "stop"));
  assert.equal(stopped.code, "AUTH_REQUIRED"); assert.equal(stopped.desiredEnabled, false); assert.equal(stopped.intentVersion, 1);
  // Cancel is absence of authorize; fresh owner/CLI reads the same persisted intent.
  const fresh = createProjectProcessService({ home: f.home });
  assert.equal((await fresh.open("fixture-project", binding.id)).processes[0].desiredEnabled, false);
  assert.equal((await f.current()).authorized, false);
});

test("pending authorization is rejected after opposite intent or declaration changes", windows, async t => {
  const f = await fixture(t);
  const pending = await f.owner.control(f.request(await f.current(), "start"));
  await f.owner.control(f.request(await f.current(), "stop"));
  await assert.rejects(f.owner.authorize(pending.authorizationRequest), { code: "PROCESS_INTENT_STALE" });
  const next = await f.owner.control(f.request(await f.current(), "start"));
  f.manifest.capabilities.projectProcesses[0] = { ...binding, entry: "changed.mjs" };
  await writeFile(path.join(f.root, ".data-editor", "project.json"), JSON.stringify(f.manifest));
  await assert.rejects(f.owner.authorize(next.authorizationRequest), { code: "PROCESS_DECLARATION_STALE" });
});

test("stop failure preserves off intent, fresh open does not restart, generated output untouched", windows, async t => {
  const f = await fixture(t); assert.equal((await f.permit()).state, "running");
  const artifact = path.join(f.root, "generated-result.json"); await writeFile(artifact, '{"value":true}');
  await writeFile(path.join(f.root, "behavior.json"), JSON.stringify({ stopFailure: true }));
  const stopped = await f.owner.control(f.request(await f.current(), "stop"));
  assert.equal(stopped.state, "running"); assert.equal(stopped.desiredEnabled, false); assert.match(stopped.error, /停止尚未完成/);
  const before = await readFile(path.join(f.root, "starts.log"), "utf8");
  const fresh = createProjectProcessService({ home: f.home }); await fresh.open("fixture-project", binding.id);
  assert.equal(await readFile(path.join(f.root, "starts.log"), "utf8"), before); assert.equal(await readFile(artifact, "utf8"), '{"value":true}');
  await writeFile(path.join(f.root, "behavior.json"), "{}");
  assert.equal((await fresh.control(f.request(await f.current(), "stop"))).state, "stopped");
});

test("old artifact cannot establish readiness and native forged identity fails closed", windows, async t => {
  const f = await fixture(t, { operationTimeoutMs: 5000 });
  await writeFile(path.join(f.root, "generated-result.json"), '{"value":true}');
  await writeFile(path.join(f.root, "behavior.json"), JSON.stringify({ readyDelayMs: 60000 }));
  const startup = await f.permit(); assert.notEqual(startup.state, "running"); assert.equal(startup.desiredEnabled, true);
  const starting = await f.current(); assert.equal(starting.state, "starting"); assert.equal(starting.canStop, true);
  await writeFile(path.join(f.root, "behavior.json"), JSON.stringify({ fakeIdentity: true }));
  assert.equal((await f.current()).state, "unknown");
});

test("verified starting instance can be stopped before readiness", windows, async t => {
  const f = await fixture(t, { operationTimeoutMs: 5000 });
  await writeFile(path.join(f.root, "behavior.json"), JSON.stringify({ readyDelayMs: 60000 }));
  await f.permit();
  const current = await f.current(); assert.equal(current.state, "starting"); assert.equal(current.canStop, true);
  const stopped = await f.owner.control(f.request(current, "stop")); assert.equal(stopped.state, "stopped"); assert.equal(stopped.desiredEnabled, false);
});

test("untrusted existing running instance allows first stop permission and stays a stop", windows, async t => {
  const f = await fixture(t); assert.equal((await f.permit()).state, "running");
  const anotherHome = path.join(f.base, "another-home");
  await saveProjectRegistry(await loadProjectRegistry({ home: f.home }), { home: anotherHome });
  const fresh = createProjectProcessService({ home: anotherHome });
  const current = (await fresh.list("fixture-project")).processes[0]; assert.equal(current.state, "running"); assert.equal(current.canStop, true); assert.equal(current.authorized, false);
  const pending = await fresh.control(f.request(current, "stop")); assert.equal(pending.desiredEnabled, false); assert.equal(pending.code, "AUTH_REQUIRED");
  assert.equal((await fresh.open("fixture-project", binding.id)).processes[0].state, "running");
  assert.equal((await fresh.authorize(pending.authorizationRequest)).state, "stopped");
  assert.equal((await readFile(path.join(f.root, "starts.log"), "utf8")).trim().split("\n").length, 1);
});

test("untrusted status never invokes project code and reused PID never becomes running", windows, async t => {
  const f = await fixture(t, { execFile: async () => { throw Error("UNTRUSTED_CODE_EXECUTED"); } });
  assert.equal((await f.current()).state, "stopped");
  await writeFile(path.join(f.root, "instance.json"), JSON.stringify({ protocolVersion: 1, phase: "ready", pid: process.pid,
    projectRoot: f.root, script: path.join(f.root, binding.entry), cwd: f.root, nonce: "a".repeat(36), started: "2000-01-01T00:00:00Z", mode: "--watch", ownerToken: "b".repeat(36) }));
  const observed = await f.current(); assert.equal(observed.state, "unknown"); assert.equal(observed.canStart, false); assert.equal(observed.canStop, false);
});

test("spawned ready must match this startup nonce, not merely another valid owner", windows, async t => {
  const f = await fixture(t, { spawnPersistentProcess: (command, args, options) => {
    const changed = [...args]; changed[5] = randomUUID();
    return spawnPersistentProcess(command, changed, options);
  } });
  const result = await f.permit();
  assert.equal(result.state, "unknown"); assert.match(result.error, /另一个实例/);
});

test("authorized status failure is isolated from registry and preserves off intent", windows, async t => {
  const f = await fixture(t); assert.equal((await f.permit()).state, "running");
  await writeFile(path.join(f.root, "behavior.json"), JSON.stringify({ queryFailure: true }));
  assert.equal((await f.current()).state, "unknown");
  const project = (await loadProjectRegistry({ home: f.home })).projects[0];
  assert.equal((await resolveProjectCapabilityState(project, { home: f.home })).status, "active");
  const result = await f.owner.control(f.request(await f.current(), "stop")); assert.equal(result.desiredEnabled, false); assert.equal(result.state, "unknown");
});
