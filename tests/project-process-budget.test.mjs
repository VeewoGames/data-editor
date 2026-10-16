import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { createProjectProcessService } from "../src/project-process-service.mjs";
import { spawnPersistentProcess } from "../src/persistent-process.mjs";
import { fixture } from "./project-process-support.mjs";

const windows = { skip: process.platform !== "win32", timeout: 60000 };
const stoppedStatus = { stdout: '{"protocolVersion":1,"state":"stopped","instance":null}' };

test("hung real broker is terminated and its control mutex becomes available", windows, async t => {
  const f = await fixture(t); let broker, budget, stdout = "";
  const owner = createProjectProcessService({ home: f.home }, {
    operationTimeoutMs: 150,
    spawnPersistentProcess: (command, args, options) => {
      budget = options.timeoutMs;
      return spawnPersistentProcess(command, args, options, { platform: "win32", execFileImpl: (_file, _args, execOptions, callback) => {
        broker = execFile(process.execPath, ["-e", "setTimeout(()=>console.log('late-spawn'),5000)"], execOptions,
          (error, output, stderr) => { stdout = output; callback(error, output, stderr); });
        return broker;
      } });
    },
  });
  const initial = (await owner.list("fixture-project")).processes[0];
  const pending = await owner.control(f.request(initial, "start"));
  const result = await owner.authorize(pending.authorizationRequest);
  assert.ok(budget > 0 && budget <= 150);
  assert.equal(result.state, "failed"); assert.match(result.error, /broker timed out/);
  assert.equal(broker.killed, true); assert.ok(broker.exitCode !== null || broker.signalCode !== null); assert.equal(stdout, "");
  const current = (await owner.list("fixture-project")).processes[0];
  assert.notEqual(current.state, "starting");
  // A subsequent action takes the same real OS lock, rather than timing out
  // behind an abandoned Promise.race/spawn operation.
  const off = await owner.control(f.request(current, "stop"));
  assert.equal(off.state, "stopped"); assert.equal(off.desiredEnabled, false);
});

test("broker elapsed time reduces the ready-probe budget instead of resetting it", windows, async t => {
  const f = await fixture(t); let spawned = false, brokerBudget;
  const remaining = [];
  const owner = createProjectProcessService({ home: f.home }, {
    operationTimeoutMs: 180,
    inspect: async (_pid, options) => { if (options?.timeoutMs) remaining.push(options.timeoutMs); return []; },
    execFile: async (_command, _args, options) => { if (spawned) remaining.push(options.timeout); return stoppedStatus; },
    spawnPersistentProcess: async (_command, _args, options) => { brokerBudget = options.timeoutMs; await delay(100); spawned = true; return { pid: 123 }; },
  });
  const initial = (await owner.list("fixture-project")).processes[0];
  const pending = await owner.control(f.request(initial, "start"));
  const result = await owner.authorize(pending.authorizationRequest);
  assert.ok(brokerBudget > 0 && brokerBudget <= 180);
  assert.ok(remaining.length > 0);
  assert.ok(remaining.every(value => value > 0 && value <= 90), "ready probes receive only the remainder after broker elapsed time");
  assert.equal(result.state, "failed");
});
