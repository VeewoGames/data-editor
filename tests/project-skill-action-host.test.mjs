import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

test("project-skill host runs the cli from its disposable project snapshot", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "project-skill-host-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = path.join(root, "input"); const output = path.join(root, "output");
  await Promise.all([mkdir(input), mkdir(output, { recursive: true })]);
  const fake = path.join(input, "exec");
  const prompt = path.join(output, "prompt.md"); const reply = path.join(output, "reply.json"); const events = path.join(output, "events.jsonl"); const diagnostics = path.join(output, "diagnostics.log");
  await writeFile(prompt, "return result-only", "utf8");
  await writeFile(fake, "import fs from 'node:fs'; const i=process.argv.indexOf('-o'); fs.writeFileSync(process.argv[i+1], JSON.stringify({kind:'project-skill-result',resultOnly:true,cwd:process.cwd(),argv:process.argv.slice(2)})); process.stdin.resume();", "utf8");
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.resolve("scripts/run-project-skill-action-host.mjs"), "--codex", process.execPath, "--workspace-root", input, "--output-root", output, "--prompt", prompt, "--reply", reply, "--events", events, "--diagnostics", diagnostics, "--model", "fixture", "--reasoning", "low", "--verbosity", "low", "--ignore-rules"], { cwd: root, env: process.env });
    child.once("error", reject); child.once("exit", resolve);
  });
  assert.equal(code, 0);
  const result = JSON.parse(await readFile(reply, "utf8"));
  assert.equal(result.resultOnly, true);
  assert.equal(path.resolve(result.cwd), path.resolve(input));
  const approvalConfigIndex = result.argv.indexOf("approval_policy=\"never\"");
  assert.ok(approvalConfigIndex > 0);
  assert.equal(result.argv[approvalConfigIndex - 1], "-c");
  assert.equal(result.argv.includes("--ignore-rules"), true);
  assert.deepEqual(result.argv.slice(result.argv.indexOf("--sandbox"), result.argv.indexOf("--sandbox") + 2), ["--sandbox", "danger-full-access"]);
});

test("project-skill host rejects an output path escaping output-root", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "project-skill-host-escape-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = path.join(root, "input"); const output = path.join(root, "output");
  await Promise.all([mkdir(input), mkdir(output, { recursive: true })]);
  const prompt = path.join(output, "prompt.md"); await writeFile(prompt, "fixture", "utf8");
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.resolve("scripts/run-project-skill-action-host.mjs"), "--codex", process.execPath, "--workspace-root", input, "--output-root", output, "--prompt", prompt, "--reply", path.join(root, "escaped.json"), "--events", path.join(output, "events.jsonl"), "--diagnostics", path.join(output, "diagnostics.log"), "--model", "fixture", "--reasoning", "low", "--verbosity", "low"], { cwd: root, env: process.env });
    child.once("error", reject); child.once("exit", resolve);
  });
  assert.notEqual(code, 0);
});
