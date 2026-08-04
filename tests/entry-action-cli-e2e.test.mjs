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
import { loadAutomationProfile } from "../src/automation-profile.mjs";
import { createAuthoritySnapshot } from "../src/entry-action-authority.mjs";
import { commitEntryActionProposal, prepareEntryActionProposalCommit } from "../src/entry-action-proposal-commit.mjs";
import { createCommitJournal } from "../src/commit-journal.mjs";
import { defaultAutomationRuntime } from "../src/automation-runtime.mjs";

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
    assert.match(help.output, /--ignore-user-config/, "preflight must confirm isolated config support");
    assert.match(help.output, /--ignore-rules/, "preflight must confirm isolated rules support");
    const record = {
      version: 1, status: "passed", startedAt, completedAt: new Date().toISOString(), cliPath,
      fixedExecArgs: ["exec", "--ignore-user-config", "--ignore-rules", "--ephemeral", "--json", "--skip-git-repo-check", "--sandbox", "read-only", "-C", "<scratch>", "-"],
      proposalSchemaVersion: 2, authorityContractVersion: 2, baseline: BASELINE,
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

test("real Codex CLI success publishes and commits a validated v3 proposal", { timeout: BASELINE.scriptMs }, async (t) => {
  const env = await setup(t); const runId = crypto.randomUUID(); const beforeText = await readFile(env.source, "utf8"); const before = digest(beforeText);
  const identity = await canonicalFileIdentity(env.scratch, "data/items.json"); const canonicalFileKey = identity.canonicalFileKey; const profile = await loadAutomationProfile(env.scratch); const snapshot = createAuthoritySnapshot({ profile, actionId: "fixture-rename", file: "data/items.json", collection: "$", row: JSON.parse(beforeText)[0] }); const ruleDigest = snapshot.ruleDigest;
  const baseDocumentEtag = `"${digest(beforeText)}"`;
  const prompt = (await readFile(path.join(fixture, "success.prompt.md"), "utf8")).replace("{{RUN_ID}}", runId).replace("{{CANONICAL_FILE_KEY}}", canonicalFileKey).replace("{{RULE_DIGEST}}", ruleDigest).replace("{{BASE_DOCUMENT_ETAG}}", JSON.stringify(baseDocumentEtag));
  const promptPath = path.join(env.root, "success.md"); await writeFile(promptPath, prompt);
  const output = path.join(env.root, "events.jsonl");
  const replyPath = path.join(env.root, "reply.json");
  const diagnosticsPath = path.join(env.root, "diagnostics.log");
  const allocator = createFencingAllocator({ stateRoot: path.join(env.root, "fencing") });
  const supervisor = createJobSupervisor({ toolRoot: path.resolve(".") }); t.after(() => supervisor.shutdown()); const jobInstanceId = crypto.randomUUID();
  const lease = await allocator.allocate({ canonicalFileKey, runId, jobInstanceId }); const handle = await supervisor.start({
    command: process.execPath,
    args: [
      path.resolve("scripts/run-entry-action-proposal-host.mjs"),
      "--codex", env.cliPath,
      "--scratch", env.scratch,
      "--prompt", promptPath,
      "--reply", replyPath,
      "--events", output,
      "--diagnostics", diagnosticsPath,
      "--model", defaultAutomationRuntime.model,
      "--reasoning", defaultAutomationRuntime.reasoning,
      "--verbosity", defaultAutomationRuntime.verbosity,
    ],
    cwd: env.scratch,
    timeoutMs: BASELINE.successMs,
    jobInstanceId,
  });
  const ownershipEvidence = {
    jobInstanceId: handle.jobInstanceId,
    helper: { pid: String(handle.helper.pid), creationFileTime: handle.helper.creationFileTime },
    child: { pid: String(handle.child.pid), creationFileTime: handle.child.creationFileTime },
  };
  await allocator.persistOwnedEvidence(lease, ownershipEvidence);
  const completion = await handle.completion; assert.equal(completion.exitCode, 0); assert.equal(completion.timedOut, false);
  const proposal = JSON.parse(await readFile(replyPath, "utf8"));
  await publishEntryActionProposal({ directory: path.join(env.root, "proposals"), runId, exitCode: completion.exitCode, proposal });
  assert.equal(digest(await readFile(env.source)), before);
  const prepared = await prepareEntryActionProposalCommit({
    proposal,
    lease,
    authoritySnapshot: snapshot,
    profile,
    documentText: beforeText,
    probeLease: (value) => allocator.probe(value),
  });
  await commitEntryActionProposal({
    journal: createCommitJournal({ directory: path.join(env.root, "commit-journal") }),
    prepared,
    lease,
    documentText: beforeText,
    writeText: (next) => writeFile(env.source, next, "utf8"),
    readText: () => readFile(env.source, "utf8"),
    publishResult: async () => {},
  });
  assert.equal(JSON.parse(await readFile(env.source, "utf8"))[0].name, "Beta");
  await allocator.release(lease); env.markPassed();
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
