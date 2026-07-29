import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";

test("proposal host streams events and diagnostics before the supervised command exits", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "entry-action-proposal-host-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fakeExec = path.join(root, "exec");
  const prompt = path.join(root, "prompt.md");
  const reply = path.join(root, "reply.json");
  const events = path.join(root, "events.jsonl");
  const diagnostics = path.join(root, "diagnostics.log");
  await writeFile(fakeExec, [
    "const { writeFile } = require('node:fs/promises');",
    "(async () => {",
    "  const args = process.argv.slice(2);",
    "  const output = args[args.indexOf('-o') + 1];",
    "  process.stdout.write('{\"type\":\"turn.started\"}\\n');",
    "  process.stderr.write('fixture diagnostic\\n');",
    "  await new Promise((resolve) => setTimeout(resolve, 300));",
    "  await writeFile(output, '{\"ok\":true}\\n');",
    "})();",
  ].join("\n"));
  await writeFile(prompt, "fixture prompt\n");

  const child = spawn(process.execPath, [
    path.resolve("scripts/run-entry-action-proposal-host.mjs"),
    "--codex", process.execPath,
    "--scratch", root,
    "--prompt", prompt,
    "--reply", reply,
    "--events", events,
    "--diagnostics", diagnostics,
    "--model", "fixture-model",
    "--reasoning", "low",
    "--verbosity", "low",
  ], {
    cwd: path.resolve("."),
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let hostStderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { hostStderr += chunk; });

  await waitForText(events, "turn.started", child, () => hostStderr);
  await waitForText(diagnostics, "fixture diagnostic", child, () => hostStderr);
  assert.equal(child.exitCode, null);
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  assert.equal(exitCode, 0);
  assert.deepEqual(JSON.parse(await readFile(reply, "utf8")), { ok: true });
});

async function waitForText(file, expected, child, describeError) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      if ((await readFile(file, "utf8")).includes(expected)) return;
    } catch {}
    if (child.exitCode != null) {
      const diagnosticText = await readFile(path.join(path.dirname(file), "diagnostics.log"), "utf8").catch(() => "");
      assert.fail(`Host exited ${child.exitCode}: ${describeError()} ${diagnosticText}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`Timed out waiting for ${expected}: ${describeError()}`);
}
