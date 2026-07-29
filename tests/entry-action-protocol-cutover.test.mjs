import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { access, readFile } from "node:fs/promises";

test("production route reaches only proposal-only orchestration", async () => {
  const server = await readFile(path.resolve("server.mjs"), "utf8");
  const route = await readFile(path.resolve("src/entry-action-route.mjs"), "utf8");
  assert.match(server, /createEntryActionRunRoute/);
  assert.match(server, /import \{ resolveCodexBindingStatus \} from "\.\/src\/codex-runtime\.mjs"/);
  assert.match(route, /startProposalOnlyEntryAction/);
  assert.doesNotMatch(server, /run-entry-action\.mjs/);
  assert.doesNotMatch(route, /run-entry-action\.mjs/);
  assert.doesNotMatch(server, /legacy-disabled/);
  assert.doesNotMatch(server, /dangerously-bypass-approvals-and-sandbox/);
});

test("legacy direct-write runner is physically removed", async () => {
  await assert.rejects(() => access(path.resolve("scripts/run-entry-action.mjs")), (error) => error?.code === "ENOENT");
  const host = await readFile(path.resolve("scripts/run-entry-action-proposal-host.mjs"), "utf8");
  assert.doesNotMatch(host, /dangerously-bypass-approvals-and-sandbox/);
  assert.match(host, /--ignore-user-config/);
  assert.match(host, /--ignore-rules/);
  assert.match(host, /--ephemeral/);
  assert.match(host, /--sandbox/);
  assert.match(host, /read-only/);
  assert.doesNotMatch(host, /--output-schema/);
  assert.match(host, /--skip-git-repo-check/);
});

test("production recovery resumes a group journal before releasing fencing ownership", async () => {
  const recovery = await readFile(path.resolve("scripts/entry-action-recover.mjs"), "utf8");
  const resumeIndex = recovery.indexOf("recoverProposalOnlyEntryActionGroup({");
  const releaseIndex = recovery.indexOf("recoverClaim({", resumeIndex);
  assert.ok(resumeIndex >= 0);
  assert.ok(releaseIndex > resumeIndex);
  assert.match(recovery, /publishEntryActionResultIdempotently/);
  assert.match(recovery, /outcome: "failed"/);
});
