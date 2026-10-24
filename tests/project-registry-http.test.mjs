import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

test("project registry HTTP add, reorder, remove and failure contracts", { timeout: 60000 }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "data-editor-project-management-"));
  const home = path.join(root, "home");
  const projects = ["A", "B", "C"].map(name => path.join(root, name));
  await Promise.all(projects.map(project => mkdir(path.join(project, "data"), { recursive: true })));
  const keep = path.join(projects[1], "data", "items.json");
  await writeFile(keep, '[{"id":"keep"}]');
  const reserve = net.createServer(); await new Promise(resolve => reserve.listen(0, "127.0.0.1", resolve));
  const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
  const repo = fileURLToPath(new URL("../", import.meta.url));
  const child = spawn(process.execPath, ["server.mjs", "--project", projects[0], "--registry-home", home, "--port", String(port), "--bridge-port", "1"], { cwd: repo, windowsHide: true, stdio: "pipe" });
  const exited = new Promise(resolve => child.once("exit", resolve));
  let logs = ""; child.stderr.on("data", chunk => { logs += chunk; });
  t.after(async () => { if (child.exitCode === null) child.kill(); await exited; await rm(root, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20000;
  while (true) {
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {}
    if (child.exitCode !== null || Date.now() > deadline) throw Error(`startup failed: ${logs}`);
    await delay(100);
  }
  const post = async (route, body, expected = 200) => {
    const response = await fetch(base + route, { method: "POST", headers: { "content-type": "application/json", origin: base }, body: JSON.stringify(body) });
    const result = await response.json();
    assert.equal(response.status, expected, JSON.stringify(result)); return result;
  };
  const read = async () => (await fetch(base + "/api/projects")).json();
  const a = (await read()).projects[0];
  const b = (await post("/api/projects", { root: projects[1], name: "B" })).project;
  const c = (await post("/api/projects", { root: projects[2], name: "C" })).project;
  assert.equal((await post("/api/projects", { root: projects[1] })).registry.projects.length, 3);
  await post("/api/projects", { root: path.join(root, "missing") }, 500);
  const reordered = await post("/api/projects/reorder", { projectIds: [c.id, a.id, b.id] });
  assert.deepEqual(reordered.registry.projects.map(p => p.id), [c.id, a.id, b.id]);
  await post("/api/projects/reorder", { projectIds: [a.id, a.id, b.id] }, 400);
  await post("/api/project-delete", { projectId: b.id });
  assert.equal(await readFile(keep, "utf8"), '[{"id":"keep"}]');
  await post("/api/projects/reorder", { projectIds: [c.id, a.id, b.id] }, 409);
  assert.deepEqual((await read()).projects.map(p => p.id), [c.id, a.id]);
  // An unfinished automation needs the registration for subsequent publication.
  const runtime = path.join(projects[2], ".data-editor", "runtime", "entry-actions");
  await mkdir(runtime, { recursive: true });
  await writeFile(path.join(runtime, "running.json"), JSON.stringify({ runId: "running", entry: { sourcePath: "data/items.json" } }));
  await post("/api/project-delete", { projectId: c.id }, 409);
  await rm(path.join(runtime, "running.json"));
  await post("/api/project-delete", { projectId: c.id });
  await post("/api/project-delete", { projectId: a.id }, 409);
  assert.equal((await read()).projects.length, 1);
});
