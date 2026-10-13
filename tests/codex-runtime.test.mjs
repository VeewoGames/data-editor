import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, writeFile, utimes, rm } from "node:fs/promises";
import { resolveCodexCli } from "../src/codex-runtime.mjs";

test("Codex discovery skips a newer incomplete installation", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-discovery-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = path.join(root, "OpenAI", "Codex", "bin");
  for (const name of ["complete", "incomplete"]) {
    await mkdir(path.join(bin, name), { recursive: true });
    await writeFile(path.join(bin, name, "codex.exe"), "fixture");
  }
  await writeFile(path.join(bin, "complete", "codex-code-mode-host.exe"), "fixture");
  await utimes(path.join(bin, "complete"), 1000, 1000);
  await utimes(path.join(bin, "incomplete"), 2000, 2000);
  const result = await resolveCodexCli({ env: { LOCALAPPDATA: root }, cwd: root });
  assert.equal(result.path, path.join(bin, "complete", "codex.exe"));
});

test("an explicit incomplete Codex override reports its missing helper", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-override-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cli = path.join(root, "codex.exe");
  await writeFile(cli, "fixture");
  const result = await resolveCodexCli({ env: { DATA_EDITOR_CODEX_CLI: cli }, cwd: root });
  assert.equal(result.available, false);
  assert.equal(result.reason, "codex_helper_missing");
  assert.match(result.message, /codex-code-mode-host.exe/);
});
