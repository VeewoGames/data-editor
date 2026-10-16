import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { withProjectProcessLock } from "../src/project-process-lock.mjs";
import { fixture, repoRoot, binding } from "./project-process-support.mjs";
const exec = promisify(execFile);
const windows = { skip: process.platform !== "win32", timeout: 120000 };

test("independent Node controllers share OS lock and reject one stale CAS", windows, async t => {
  const f = await fixture(t); const request = f.request(await f.current(), "stop");
  const serviceUrl = new URL("../src/project-process-service.mjs", import.meta.url).href;
  const code = `import {createProjectProcessService} from ${JSON.stringify(serviceUrl)};const [home,request]=process.argv.slice(1);try{const result=await createProjectProcessService({home}).control(JSON.parse(request));console.log(JSON.stringify({ok:true,result}));}catch(error){console.log(JSON.stringify({ok:false,code:error.code}));}`;
  const invoke = () => exec(process.execPath, ["--input-type=module", "-e", code, f.home, JSON.stringify(request)], { windowsHide: true, timeout: 45000 });
  const results = (await Promise.all([invoke(), invoke()])).map(result => JSON.parse(result.stdout));
  assert.equal(results.filter(result => result.ok).length, 1);
  assert.equal(results.find(result => !result.ok).code, "PROCESS_INTENT_STALE");
  const current = await f.current(); assert.equal(current.intentVersion, 1); assert.equal(current.desiredEnabled, false);
});

test("offline CLI stop and repeated open preserve the same off record", windows, async t => {
  const f = await fixture(t); assert.equal((await f.permit()).state, "running");
  const cli = path.join(repoRoot, "scripts", "project-process.mjs");
  const args = ["--project", f.root, "--process-id", binding.id, "--registry-home", f.home];
  const stop = JSON.parse((await exec(process.execPath, [cli, "stop", ...args], { windowsHide: true, timeout: 45000 })).stdout);
  assert.equal(stop.state, "stopped"); assert.equal(stop.desiredEnabled, false);
  const before = await readFile(path.join(f.root, "starts.log"), "utf8");
  const opened = JSON.parse((await exec(process.execPath, [cli, "open", ...args], { windowsHide: true, timeout: 45000 })).stdout);
  assert.equal(opened.processes[0].desiredEnabled, false); assert.equal(await readFile(path.join(f.root, "starts.log"), "utf8"), before);
  assert.equal((await f.current()).intentVersion, stop.intentVersion);
});

test("operation mutex is released after owner process exits and busy wait is bounded", windows, async () => {
  const key = `fixture-crash-${process.pid}-${Date.now()}`;
  const lockUrl = new URL("../src/project-process-lock.mjs", import.meta.url).href;
  const code = `import {withProjectProcessLock} from ${JSON.stringify(lockUrl)};await withProjectProcessLock(process.argv[1],async()=>{console.log("acquired");setTimeout(()=>process.exit(7),500);await new Promise(()=>{});});`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", code, key], { windowsHide: true });
  const exited = new Promise(resolve => child.once("exit", resolve));
  await new Promise((resolve, reject) => { child.once("error", reject); child.stdout.once("data", resolve); });
  await assert.rejects(withProjectProcessLock(key, async () => {}, { timeoutMs: 100 }), { code: "PROCESS_OPERATION_BUSY" });
  await exited;
  assert.equal(await withProjectProcessLock(key, async () => "recovered", { timeoutMs: 1000 }), "recovered");
});
