import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

test("project-skill host runs the cli from the declared project root", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "project-skill-host-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fake = path.join(root, "exec");
  const prompt = path.join(root, "prompt.md"); const reply = path.join(root, "reply.json"); const events = path.join(root, "events.jsonl"); const diagnostics = path.join(root, "diagnostics.log");
  await writeFile(prompt, "return result-only", "utf8");
  await writeFile(fake, "import fs from 'node:fs'; const i=process.argv.indexOf('-o'); fs.writeFileSync(process.argv[i+1], JSON.stringify({kind:'project-skill-result',resultOnly:true,cwd:process.cwd()})); process.stdin.resume();", "utf8");
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.resolve("scripts/run-project-skill-action-host.mjs"), "--codex", process.execPath, "--project-root", root, "--prompt", prompt, "--reply", reply, "--events", events, "--diagnostics", diagnostics, "--model", "fixture", "--reasoning", "low", "--verbosity", "low"], { cwd: root, env: process.env });
    child.once("error", reject); child.once("exit", resolve);
  });
  assert.equal(code, 0);
  const result = JSON.parse(await readFile(reply, "utf8"));
  assert.equal(result.resultOnly, true);
  assert.equal(path.resolve(result.cwd), path.resolve(root));
});
