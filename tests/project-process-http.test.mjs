import assert from "node:assert/strict";
import test from "node:test";
import { assertProjectProcessHttpSource } from "../src/project-process-http.mjs";
import { spawn } from "node:child_process";
import path from "node:path";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { fixture, repoRoot } from "./project-process-support.mjs";

const req = (headers = {}) => ({ headers: { host: "127.0.0.1:18787", origin: "http://127.0.0.1:18787", "content-type": "application/json", "sec-fetch-site": "same-origin", ...headers } });
test("process writes accept only JSON from configured static or dev frontend origin", () => {
  assert.doesNotThrow(() => assertProjectProcessHttpSource(req(), 18787));
  assert.doesNotThrow(() => assertProjectProcessHttpSource(req({ "content-type": "application/json; charset=utf-8" }), 18787));
  for (const headers of [{ origin: undefined }, { origin: "http://evil.example" }, { origin: "http://127.0.0.1:18788" },
    { host: "evil.example:18787" }, { "sec-fetch-site": "cross-site" }, { "content-type": "text/plain" },
    { host: "127.0.0.1:18788", "x-forwarded-host": "127.0.0.1:18787" }]) assert.throws(() => assertProjectProcessHttpSource(req(headers), 18787));
});

test("isolated actual HTTP route rejects missing project and cross-origin before action", { skip: process.platform !== "win32", timeout: 60000 }, async t => {
  const f = await fixture(t);
  const reserving = net.createServer(); await new Promise(resolve => reserving.listen(0, "127.0.0.1", resolve));
  const port = reserving.address().port; await new Promise(resolve => reserving.close(resolve));
  const child = spawn(process.execPath, [path.join(repoRoot, "server.mjs"), "--project", f.root, "--registry-home", f.home,
    "--port", String(port), "--bridge-port", "1"], { cwd: repoRoot, env: { ...process.env, DATA_EDITOR_HOME: f.home }, windowsHide: true, stdio: "pipe" });
  const exit = new Promise(resolve => child.once("exit", resolve));
  t.after(async () => { if (child.exitCode === null) child.kill("SIGTERM"); await exit; });
  let stderr = ""; child.stderr.on("data", data => { stderr += data; });
  const base = `http://127.0.0.1:${port}`; const deadline = Date.now() + 10000;
  while (true) {
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* bounded startup */ }
    if (child.exitCode !== null || Date.now() > deadline) throw Error(`fixture server startup failed: ${stderr}`);
    await delay(100);
  }
  assert.equal((await fetch(`${base}/api/project-processes`)).status, 400);
  const snapshot = await (await fetch(`${base}/api/project-processes?projectId=fixture-project`)).json();
  const request = f.request(snapshot.processes[0], "stop");
  const send = headers => fetch(`${base}/api/project-processes/control`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(request) });
  assert.equal((await send({})).status, 403);
  assert.equal((await send({ origin: "http://evil.example" })).status, 403);
  assert.equal((await f.current()).intentVersion, 0);
  const allowed = await send({ origin: base }); assert.equal(allowed.status, 200);
  const pending = await allowed.json(); assert.equal(pending.code, "AUTH_REQUIRED"); assert.equal(pending.desiredEnabled, false); assert.equal(pending.intentVersion, 1);
});
