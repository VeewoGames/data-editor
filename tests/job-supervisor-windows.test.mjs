import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  createJobSupervisor,
  ProcessOwnershipError,
  resolveJobHelperPaths,
  verifyJobHelper,
} from "../src/job-supervisor.mjs";

assert.equal(process.platform, "win32", "Windows Job Object tests must run on Windows; this gate cannot be skipped.");
assert.equal(process.arch, "x64", "Windows Job Object tests require the x64 Node runtime.");

const execFileAsync = promisify(execFile);
const toolRoot = path.resolve(".");
const workerPath = path.resolve("tests/fixtures/job-tree-worker.mjs");
const hostPath = path.resolve("tests/fixtures/job-supervisor-host.mjs");
const formalPaths = resolveJobHelperPaths(toolRoot);
let faultRoot;
let faultPaths;

test.before(async () => {
  await verifyJobHelper(formalPaths);
  faultRoot = await mkdtemp(path.join(os.tmpdir(), "data-editor-job-helper-fault-"));
  await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", path.resolve("scripts/build-job-helper.ps1"),
    "-OutputDirectory", faultRoot,
    "-TestFaults",
  ], { cwd: toolRoot, windowsHide: true });
  faultPaths = {
    directory: faultRoot,
    sourcePath: path.resolve("native/job-helper/JobHelper.cs"),
    executablePath: path.join(faultRoot, "data-editor-job-helper.exe"),
    manifestPath: path.join(faultRoot, "job-helper.manifest.json"),
  };
  const manifest = await verifyJobHelper(faultPaths, { allowTestFaults: true });
  assert.equal(manifest.testFaults, true);
});

test.after(async () => {
  if (faultRoot) await rm(faultRoot, { recursive: true, force: true });
});

test("real helper owns a normal process before it runs and reports completion", async (t) => {
  const root = await makeRoot(t);
  const marker = path.join(root, "normal.marker");
  const pidFile = path.join(root, "normal.pids");
  const supervisor = createJobSupervisor({ toolRoot });
  t.after(() => supervisor.shutdown());
  const handle = await supervisor.start({
    command: process.execPath,
    args: [workerPath, "--mode=normal", `--pid-file=${pidFile}`, `--marker=${marker}`, "--lifetime-ms=150"],
  });
  assert.equal(handle.pid > 0, true);
  assert.equal(handle.helper.pid, supervisor.helperPid);
  assert.match(handle.helper.creationFileTime, /^(?:0|[1-9][0-9]*)$/);
  assert.match(handle.child.creationFileTime, /^(?:0|[1-9][0-9]*)$/);
  assert.match(handle.jobInstanceId, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  const completion = await handle.completion;
  assert.equal(completion.exitCode, 0);
  assert.equal(existsSync(marker), true);
  await assertPidsGone(await readPids(pidFile));
});

test("timeout closes the Job and removes the whole process tree", async (t) => {
  const root = await makeRoot(t);
  const pidFile = path.join(root, "timeout.pids");
  const supervisor = createJobSupervisor({ toolRoot });
  t.after(() => supervisor.shutdown());
  const handle = await supervisor.start({
    command: process.execPath,
    args: [workerPath, "--mode=tree", `--pid-file=${pidFile}`],
    timeoutMs: 500,
  });
  await waitForPidCount(pidFile, 2);
  const completion = await handle.completion;
  assert.equal(completion.timedOut, true);
  assert.equal(completion.reason, "timeout");
  await assertPidsGone(await readPids(pidFile));
});

test("shutdown is idempotent and drains every active Job tree", async (t) => {
  const root = await makeRoot(t);
  const pidFile = path.join(root, "shutdown.pids");
  const supervisor = createJobSupervisor({ toolRoot });
  const handle = await supervisor.start({
    command: process.execPath,
    args: [workerPath, "--mode=tree", `--pid-file=${pidFile}`],
  });
  await waitForPidCount(pidFile, 2);
  await Promise.all([supervisor.shutdown(), supervisor.shutdown()]);
  const completion = await handle.completion;
  assert.equal(completion.reason, "terminated");
  assert.equal(supervisor.activeCount, 0);
  await assertPidsGone(await readPids(pidFile));
});

test("root exit closes the Job and removes a still-running descendant before completion", async (t) => {
  const root = await makeRoot(t);
  const pidFile = path.join(root, "root-exit.pids");
  const supervisor = createJobSupervisor({ toolRoot });
  t.after(() => supervisor.shutdown());
  const handle = await supervisor.start({
    command: process.execPath,
    args: [workerPath, "--mode=root-exit", `--pid-file=${pidFile}`],
  });
  const pids = await waitForPidCount(pidFile, 2);
  const completion = await handle.completion;
  assert.equal(completion.exitCode, 0);
  await assertPidsGone(pids);
});

test("helper crash relies on KILL_ON_JOB_CLOSE to remove descendants", async (t) => {
  const root = await makeRoot(t);
  const pidFile = path.join(root, "helper-crash.pids");
  const supervisor = createJobSupervisor({ toolRoot });
  t.after(() => supervisor.shutdown());
  const handle = await supervisor.start({
    command: process.execPath,
    args: [workerPath, "--mode=tree", `--pid-file=${pidFile}`],
  });
  const pids = await waitForPidCount(pidFile, 2);
  const helperPid = supervisor.helperPid;
  process.kill(helperPid);
  await assert.rejects(handle.completion, (error) =>
    error instanceof ProcessOwnershipError &&
    error.code === "ENTRY_ACTION_PROCESS_OWNERSHIP_UNAVAILABLE");
  await assertPidsGone([...pids, helperPid]);
});

test("host crash closes helper stdin/parent handle and removes the process tree", async (t) => {
  const root = await makeRoot(t);
  const pidFile = path.join(root, "host-crash.pids");
  const infoPath = path.join(root, "host.json");
  const host = spawn(process.execPath, [hostPath, infoPath, pidFile, formalPaths.directory], {
    cwd: toolRoot,
    stdio: "ignore",
    windowsHide: true,
  });
  t.after(() => {
    if (isProcessAlive(host.pid)) process.kill(host.pid);
  });
  await waitFor(() => existsSync(infoPath), 10_000, "host did not publish ownership info");
  const info = JSON.parse(await readFile(infoPath, "utf8"));
  const pids = await waitForPidCount(pidFile, 2);
  process.kill(host.pid);
  await assertPidsGone([...pids, info.helperPid, info.hostPid], 10_000);
});

test("repeated completion, terminate, and shutdown races preserve handle ownership", async (t) => {
  const root = await makeRoot(t);
  const supervisor = createJobSupervisor({ toolRoot });
  const handles = [];
  const terminateAttempts = [];
  for (let index = 0; index < 24; index += 1) {
    const pidFile = path.join(root, `race-${index}.pids`);
    const handle = await supervisor.start({
      command: process.execPath,
      args: [
        workerPath,
        "--mode=normal",
        `--pid-file=${pidFile}`,
        `--lifetime-ms=${10 + (index % 4) * 5}`,
      ],
    });
    handles.push({ handle, pidFile });
    if (index % 2 === 0) {
      terminateAttempts.push(
        new Promise((resolve) => setTimeout(resolve, index % 5))
          .then(() => handle.terminate()),
      );
    }
  }
  const completionOutcomes = assertAllFulfilled(
    await Promise.allSettled(handles.map(({ handle }) => handle.completion)),
    "completion/terminate race completion",
  );
  assertAllFulfilled(
    await Promise.allSettled(terminateAttempts),
    "completion/terminate race terminate",
  );
  for (const [index, outcome] of completionOutcomes.entries()) {
    assert.equal(outcome.id, handles[index].handle.id);
    assert.equal(outcome.pid, handles[index].handle.pid);
    assert.equal(outcome.timedOut, false);
    assert.match(outcome.reason, /^(exit|terminated)$/);
  }
  assert.equal(supervisor.activeCount, 0, "all race completions must drain before supervisor shutdown");
  await supervisor.shutdown();
  assert.equal(supervisor.activeCount, 0, "supervisor shutdown must preserve the drained state");
  for (const { pidFile } of handles) {
    if (existsSync(pidFile)) await assertPidsGone(await readPids(pidFile));
  }

  for (let iteration = 0; iteration < 6; iteration += 1) {
    const shutdownSupervisor = createJobSupervisor({ toolRoot });
    const pidFile = path.join(root, `shutdown-race-${iteration}.pids`);
    const handle = await shutdownSupervisor.start({
      command: process.execPath,
      args: [workerPath, "--mode=tree", `--pid-file=${pidFile}`],
    });
    assert.equal(shutdownSupervisor.activeCount, 1, "owned tree must be active before shutdown");
    await shutdownSupervisor.shutdown();
    const [completion] = assertAllFulfilled(
      await Promise.allSettled([handle.completion]),
      `shutdown race ${iteration} completion`,
    );
    assert.equal(completion.id, handle.id);
    assert.equal(completion.pid, handle.pid);
    assert.equal(completion.timedOut, false);
    assert.equal(completion.reason, "terminated");
    assert.equal(shutdownSupervisor.activeCount, 0, "shutdown must drain the owned tree");
    if (existsSync(pidFile)) await assertPidsGone(await readPids(pidFile));
  }

  assert.throws(
    () => assertAllFulfilled(
      [{ status: "rejected", reason: new Error("injected stress rejection") }],
      "stress assertion seam",
    ),
    /stress assertion seam[\s\S]*injected stress rejection/,
    "the stress assertion seam must fail on any injected rejection",
  );
});

test("helper FailFast after atomic create leaves the suspended child inside the closing Job", async (t) => {
  const root = await makeRoot(t);
  const marker = path.join(root, "failfast.marker");
  const pidFile = path.join(root, "failfast-worker.pids");
  const evidencePath = path.join(root, "failfast-created.pid");
  const supervisor = createJobSupervisor({
    toolRoot,
    helperPaths: faultPaths,
    allowTestFaults: true,
  });
  t.after(() => supervisor.shutdown());
  await assert.rejects(
    () => supervisor.start({
      command: process.execPath,
      args: [
        workerPath,
        "--mode=normal",
        `--pid-file=${pidFile}`,
        `--marker=${marker}`,
        "--marker-delay-ms=1000",
        "--lifetime-ms=5000",
      ],
      testFault: "failfast-after-create-with-job",
      testEvidencePath: evidencePath,
    }),
    (error) => error instanceof ProcessOwnershipError &&
      error.code === "ENTRY_ACTION_PROCESS_OWNERSHIP_UNAVAILABLE",
  );
  await waitFor(() => existsSync(evidencePath), 5000, "FailFast evidence PID was not published");
  const createdPid = Number((await readFile(evidencePath, "utf8")).trim());
  await assertPidsGone([createdPid]);
  assert.equal(existsSync(marker), false);
  assert.equal(existsSync(pidFile), false);
});

test("build refuses publication when helper source changes after compilation", async (t) => {
  const root = await makeRoot(t);
  const sourcePath = path.join(root, "JobHelper.cs");
  const outputDirectory = path.join(root, "output");
  const pausePath = path.join(root, "pause.signal");
  const continuePath = path.join(root, "continue.signal");
  await copyFile(path.resolve("native/job-helper/JobHelper.cs"), sourcePath);
  await writeFile(path.join(root, "old.exe"), "old");
  await writeFile(path.join(root, "old.manifest"), "old manifest");
  await mkdir(outputDirectory, { recursive: true });
  const finalExe = path.join(outputDirectory, "data-editor-job-helper.exe");
  const finalManifest = path.join(outputDirectory, "job-helper.manifest.json");
  await copyFile(path.join(root, "old.exe"), finalExe);
  await copyFile(path.join(root, "old.manifest"), finalManifest);

  const build = execFileAsync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", path.resolve("scripts/build-job-helper.ps1"),
    "-SourcePath", sourcePath,
    "-OutputDirectory", outputDirectory,
    "-TestPauseBeforePublishPath", pausePath,
    "-TestContinuePublishPath", continuePath,
  ], { cwd: toolRoot, windowsHide: true });
  await waitFor(() => existsSync(pausePath), 10_000, "build did not reach pre-publish gate");
  await writeFile(sourcePath, `${await readFile(sourcePath, "utf8")}\n// changed during build\n`);
  await writeFile(continuePath, "continue");
  await assert.rejects(build, /source changed during build/i);
  assert.equal(await readFile(finalExe, "utf8"), "old");
  assert.equal(await readFile(finalManifest, "utf8"), "old manifest");
});

for (const fault of [
  "after-create-before-assign",
  "after-assign-before-resume",
  "resume-fail",
  "close-job-after-resume",
]) {
  test(`fault ${fault} fails closed and leaves no runnable process`, async (t) => {
    const root = await makeRoot(t);
    const marker = path.join(root, `${fault}.marker`);
    const pidFile = path.join(root, `${fault}.pids`);
    const supervisor = createJobSupervisor({
      toolRoot,
      helperPaths: faultPaths,
      allowTestFaults: true,
    });
    t.after(() => supervisor.shutdown());
    let failure;
    await assert.rejects(
      () => supervisor.start({
        command: process.execPath,
        args: [
          workerPath,
          "--mode=normal",
          `--pid-file=${pidFile}`,
          `--marker=${marker}`,
          "--marker-delay-ms=1000",
          "--lifetime-ms=5000",
        ],
        testFault: fault,
      }),
      (error) => {
        failure = error;
        return error instanceof ProcessOwnershipError &&
          error.code === "ENTRY_ACTION_PROCESS_OWNERSHIP_UNAVAILABLE";
      },
    );
    assert.equal(existsSync(marker), false);
    if (failure.details?.pid) await assertPidsGone([failure.details.pid]);
    if (existsSync(pidFile)) await assertPidsGone(await readPids(pidFile));
  });
}

async function makeRoot(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "data-editor-job-supervisor-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function waitForPidCount(pidFile, expected) {
  await waitFor(async () => {
    if (!existsSync(pidFile)) return false;
    return (await readPids(pidFile)).length >= expected;
  }, 10_000, `expected ${expected} process ids in ${pidFile}`);
  return readPids(pidFile);
}

async function readPids(pidFile) {
  return (await readFile(pidFile, "utf8"))
    .split(/\r?\n/)
    .filter(Boolean)
    .map(Number);
}

async function assertPidsGone(pids, timeoutMs = 5000) {
  await waitFor(() => pids.every((pid) => !isProcessAlive(pid)), timeoutMs, `processes still alive: ${pids.join(", ")}`);
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(predicate, timeoutMs, message) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(message);
}

function assertAllFulfilled(results, label) {
  const failures = results
    .map((result, index) => ({ result, index }))
    .filter(({ result }) => result.status === "rejected")
    .map(({ result, index }) => {
      const reason = result.reason instanceof Error
        ? result.reason.stack ?? result.reason.message
        : String(result.reason);
      return `[${index}] ${reason}`;
    });
  assert.deepEqual(failures, [], `${label} rejected:\n${failures.join("\n")}`);
  return results.map((result) => result.value);
}
