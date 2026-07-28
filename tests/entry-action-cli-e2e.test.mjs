import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createJobSupervisor } from "../src/job-supervisor.mjs";
import { resolveCodexCli } from "../src/codex-runtime.mjs";
import { createFencingAllocator } from "../src/fencing-lock.mjs";
import { publishEntryActionProposal } from "../src/entry-action-proposal-publisher.mjs";
import { canonicalFileIdentity } from "../src/canonical-file-identity.mjs";
import { loadEntryActionPolicy } from "../src/entry-action-policy.mjs";
import { loadAutomationProfile } from "../src/automation-profile.mjs";
import { createAuthoritySnapshot } from "../src/entry-action-authority.mjs";

const fixture = path.resolve("tests/fixtures/entry-action-cli-e2e");
const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const execFileAsync = promisify(execFile);
const BASELINE = Object.freeze({ preflightMs: 30_000, successMs: 600_000, readinessMs: 60_000, cutoffMs: 1_000, observationMs: 10_000, scriptMs: 720_000 });

async function preflightCodexCli({ root, cliPath }) {
  const startedAt = new Date().toISOString();
  const artifactPath = path.join(root, "preflight.json");
  const invoke = async (args) => {
    const result = await execFileAsync(cliPath, args, { windowsHide: true, timeout: BASELINE.preflightMs, maxBuffer: 1024 * 1024 });
    const stdout = result.stdout.trim(); const stderr = result.stderr.trim();
    return { args, stdout, stderr, output: [stdout, stderr].filter(Boolean).join("\n") };
  };
  try {
    const [version, authentication, help] = await Promise.all([invoke(["--version"]), invoke(["login", "status"]), invoke(["exec", "--help"])]);
    assert.match(version.output, /codex-cli\s+\S+/, "preflight must identify a real Codex CLI");
    assert.match(authentication.output, /Logged in/i, "preflight must confirm Codex authentication");
    assert.match(help.output, /--json/, "preflight must confirm --json support");
    assert.match(help.output, /--skip-git-repo-check/, "preflight must confirm fixed exec arguments");
    const record = {
      version: 1, status: "passed", startedAt, completedAt: new Date().toISOString(), cliPath,
      fixedExecArgs: ["exec", "--json", "--skip-git-repo-check", "-C", "<scratch>", "-"],
      proposalSchemaVersion: 1, policyVersion: 1, baseline: BASELINE,
      checks: { version, authentication, execHelp: { args: help.args, supportsJson: true, supportsSkipGitRepoCheck: true } },
    };
    await writeFile(artifactPath, `${JSON.stringify(record, null, 2)}\n`);
    return record;
  } catch (error) {
    await writeFile(artifactPath, `${JSON.stringify({ version: 1, status: "failed", startedAt, completedAt: new Date().toISOString(), cliPath, baseline: BASELINE, error: String(error?.message ?? error) }, null, 2)}\n`);
    throw error;
  }
}

async function waitForReady(outputPath) {
  for (let i = 0; i < BASELINE.readinessMs / 250; i += 1) {
    try {
      const events = (await readFile(outputPath, "utf8")).trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
      if (events.some((event) => event.type === "item.completed" && event.item?.type === "agent_message" && event.item.text === "READY")) return true;
    } catch {}
    await wait(250);
  }
  return false;
}

function isProcessAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { if (error?.code === "ESRCH") return false; throw error; }
}

async function setup(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "entry-action-cli-e2e-"));
  let passed = false;
  t.after(async () => {
    if (passed) await rm(root, { recursive: true, force: true });
    else console.error(`D3 diagnostic artifacts retained: ${root}`);
  });
  const scratch = path.join(root, "scratch"); await cp(path.join(fixture, "fixture-project"), scratch, { recursive: true }); await mkdir(path.join(scratch, ".data-editor")); await cp(path.join(fixture, "automation-profile.json"), path.join(scratch, ".data-editor", "automation-profile.json"));
  const cli = await resolveCodexCli(); assert.equal(cli.available, true, cli.message);
  const preflight = await preflightCodexCli({ root, cliPath: cli.path });
  return { root, scratch, cliPath: cli.path, preflight, source: path.join(scratch, "data", "items.json"), markPassed: () => { passed = true; } };
}

test("real Codex CLI success publishes only a validated proposal", { timeout: BASELINE.scriptMs }, async (t) => {
  const env = await setup(t); const runId = crypto.randomUUID(); const before = digest(await readFile(env.source));
  const identity = await canonicalFileIdentity(env.scratch, "data/items.json"); const canonicalFileKey = identity.canonicalFileKey; const policy = await loadEntryActionPolicy(path.join(fixture, "entry-action-policy.json")); const profile = await loadAutomationProfile(env.scratch); const snapshot = createAuthoritySnapshot({ policy, profile, actionId: "fixture-rename", file: "data/items.json", collection: "items" }); const authorityDigest = snapshot.authorityDigest;
  const prompt = (await readFile(path.join(fixture, "success.prompt.md"), "utf8")).replace("{{RUN_ID}}", runId).replace("{{CANONICAL_FILE_KEY}}", canonicalFileKey).replace("{{AUTHORITY_DIGEST}}", authorityDigest).replace('"fixture-profile"', snapshot.automationProfileEtag);
  const promptPath = path.join(env.root, "success.md"); await writeFile(promptPath, prompt);
  const output = path.join(env.root, "events.jsonl"); const allocator = createFencingAllocator({ stateRoot: path.join(env.root, "fencing") });
  const supervisor = createJobSupervisor({ toolRoot: path.resolve(".") }); t.after(() => supervisor.shutdown()); const jobInstanceId = crypto.randomUUID();
  const lease = await allocator.allocate({ canonicalFileKey, runId, jobInstanceId }); const handle = await supervisor.start({ command: process.execPath, args: [path.join(fixture, "codex-cli-host.mjs"), env.cliPath, env.scratch, promptPath, output], cwd: env.scratch, timeoutMs: BASELINE.successMs, jobInstanceId });
  const ownershipEvidence = {
    jobInstanceId: handle.jobInstanceId,
    helper: { pid: String(handle.helper.pid), creationFileTime: handle.helper.creationFileTime },
    child: { pid: String(handle.child.pid), creationFileTime: handle.child.creationFileTime },
  };
  await allocator.persistOwnedEvidence(lease, ownershipEvidence);
  const completion = await handle.completion; assert.equal(completion.exitCode, 0); assert.equal(completion.timedOut, false);
  const events = (await readFile(output, "utf8")).trim().split(/\r?\n/).map((line) => JSON.parse(line));
  const text = events.find((event) => event.type === "item.completed" && event.item?.type === "agent_message")?.item.text;
  assert.equal(typeof text, "string", "Codex must emit a proposal message");
  const proposal = JSON.parse(text); await publishEntryActionProposal({ directory: path.join(env.root, "proposals"), runId, exitCode: completion.exitCode, proposal });
  assert.equal(digest(await readFile(env.source)), before); await allocator.release(lease); env.markPassed();
});

test("real Codex CLI timeout terminates its Job and publishes nothing", { timeout: BASELINE.scriptMs }, async (t) => {
  const env = await setup(t); const before = digest(await readFile(env.source)); const output = path.join(env.root, "events.jsonl"); const supervisor = createJobSupervisor({ toolRoot: path.resolve(".") }); t.after(() => supervisor.shutdown());
  const allocator = createFencingAllocator({ stateRoot: path.join(env.root, "fencing") }); const key = (await canonicalFileIdentity(env.scratch, "data/items.json")).canonicalFileKey; const jobInstanceId = crypto.randomUUID(); const lease = await allocator.allocate({ canonicalFileKey: key, runId: crypto.randomUUID(), jobInstanceId });
  const handle = await supervisor.start({ command: process.execPath, args: [path.join(fixture, "codex-cli-host.mjs"), env.cliPath, env.scratch, path.join(fixture, "timeout.prompt.md"), output], cwd: env.scratch, jobInstanceId });
  await allocator.persistOwnedEvidence(lease, { jobInstanceId: handle.jobInstanceId, helper: { pid: String(handle.helper.pid), creationFileTime: handle.helper.creationFileTime }, child: { pid: String(handle.child.pid), creationFileTime: handle.child.creationFileTime } });
  const ready = await waitForReady(output);
  assert.equal(ready, true, "timeout case must observe CLI readiness before cutoff");
  const pids = JSON.parse(await readFile(`${output}.pids.json`, "utf8"));
  await wait(BASELINE.cutoffMs); const completion = await handle.terminate("timeout"); assert.equal(completion.reason, "timeout"); assert.equal(completion.timedOut, true); assert.equal(supervisor.activeCount, 0, "terminated Job must not retain active supervisor records");
  const treeExited = !isProcessAlive(handle.child.pid) && !isProcessAlive(pids.codexPid);
  await writeFile(path.join(env.root, "timeout-tree-exit.json"), `${JSON.stringify({ version: 1, completion, supervisorActiveCount: supervisor.activeCount, pids: { hostPid: handle.child.pid, codexPid: pids.codexPid }, treeExited, checkedAt: new Date().toISOString() }, null, 2)}\n`);
  assert.equal(treeExited, true, "Job termination must end both host and Codex CLI processes");
  await allocator.release(lease); await wait(BASELINE.observationMs); assert.equal(digest(await readFile(env.source)), before); const proposals = await readdir(path.join(env.root, "proposals")).catch((error) => error.code === "ENOENT" ? [] : Promise.reject(error)); assert.deepEqual(proposals, []); env.markPassed();
});
