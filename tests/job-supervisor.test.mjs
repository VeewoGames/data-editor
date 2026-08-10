import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  canonicalizeJobHelperSource,
  createJobSupervisor,
  ProcessOwnershipError,
  verifyJobHelper,
} from "../src/job-supervisor.mjs";

test("verifyJobHelper accepts LF or CRLF source and rejects content tampering", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "data-editor-helper-verify-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const executablePath = path.join(root, "data-editor-job-helper.exe");
  const manifestPath = path.join(root, "job-helper.manifest.json");
  const sourcePath = path.join(root, "JobHelper.cs");
  const bytes = Buffer.from("fixture helper");
  const sourceBytes = Buffer.from("fixture source\nsecond line\n");
  await writeFile(executablePath, bytes);
  await writeFile(sourcePath, sourceBytes);
  const hash = (await import("node:crypto")).createHash("sha256").update(bytes).digest("hex");
  const sourceHash = (await import("node:crypto")).createHash("sha256")
    .update(canonicalizeJobHelperSource(sourceBytes)).digest("hex");
  await writeFile(manifestPath, JSON.stringify({
    protocolVersion: 2,
    platform: "win32",
    arch: "x64",
    sourceSha256: sourceHash,
    executableSha256: hash,
    testFaults: false,
  }));
  const manifest = await verifyJobHelper({ executablePath, manifestPath, sourcePath }, { platform: "win32", arch: "x64" });
  assert.equal(manifest.executableSha256, hash);
  await writeFile(sourcePath, "fixture source\r\nsecond line\r\n");
  assert.equal(
    (await verifyJobHelper({ executablePath, manifestPath, sourcePath }, { platform: "win32", arch: "x64" })).sourceSha256,
    sourceHash,
  );
  await writeFile(sourcePath, "fixture source\r\nchanged line\r\n");
  await assert.rejects(
    () => verifyJobHelper({ executablePath, manifestPath, sourcePath }, { platform: "win32", arch: "x64" }),
    (error) => error instanceof ProcessOwnershipError && error.code === "ENTRY_ACTION_PROCESS_OWNERSHIP_UNAVAILABLE",
  );
  await writeFile(sourcePath, sourceBytes);
  await writeFile(executablePath, "tampered");
  await assert.rejects(
    () => verifyJobHelper({ executablePath, manifestPath, sourcePath }, { platform: "win32", arch: "x64" }),
    (error) => error instanceof ProcessOwnershipError && error.code === "ENTRY_ACTION_PROCESS_OWNERSHIP_UNAVAILABLE",
  );
});

test("supervisor resolves start only after owned and completes once", async () => {
  const fixture = makeFakeHelper();
  fixture.onCommand = (command) => {
    if (command.type === "shutdown") fixture.exit(0);
  };
  const supervisor = createJobSupervisor({
    toolRoot: process.cwd(),
    helperPaths: fakePaths(),
    verifyHelper: async () => ({}),
    spawnProcess: () => fixture.child,
  });
  const startPromise = supervisor.start({ command: process.execPath, args: ["worker"] });
  await fixture.waitForCommand("start");
  let settled = false;
  void startPromise.then(() => { settled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  const startCommand = fixture.commands[0];
  fixture.emit({ type: "owned", id: startCommand.id, pid: 1234 });
  const handle = await startPromise;
  assert.equal(handle.pid, 1234);
  assert.match(handle.jobInstanceId, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.notEqual(handle.jobInstanceId, handle.id);
  assert.deepEqual(handle.helper, { pid: fixture.child.pid, creationFileTime: fixture.child.creationFileTime });
  assert.deepEqual(handle.child, { pid: 1234, creationFileTime: "133000000000000001" });
  fixture.emit({ type: "completed", id: handle.id, exitCode: 0 });
  assert.deepEqual(await handle.completion, {
    id: handle.id,
    pid: 1234,
    exitCode: 0,
    reason: "exit",
    timedOut: false,
  });
  await supervisor.shutdown();
});

test("v1 or malformed ready identity fails closed before any start command", async () => {
  const fixture = makeFakeHelper({ autoReady: false });
  const supervisor = createJobSupervisor({
    toolRoot: process.cwd(), helperPaths: fakePaths(), verifyHelper: async () => ({}), spawnProcess: () => fixture.child,
  });
  const start = supervisor.start({ command: process.execPath });
  fixture.emit({ type: "ready", protocolVersion: 1, pid: fixture.child.pid, creationFileTime: fixture.child.creationFileTime });
  await assert.rejects(start, (error) => error instanceof ProcessOwnershipError && error.stage === "protocol");
  assert.equal(fixture.commands.length, 0);
  await supervisor.shutdown();
});

test("owned acknowledgement rejects JSON number FILETIME and mismatched job instance", async () => {
  for (const message of [
    { creationFileTime: 133000000000000001 },
    { jobInstanceId: "10000000-0000-4000-8000-000000000001" },
  ]) {
    const fixture = makeFakeHelper();
    const supervisor = createJobSupervisor({
      toolRoot: process.cwd(), helperPaths: fakePaths(), verifyHelper: async () => ({}), spawnProcess: () => fixture.child,
    });
    const start = supervisor.start({ command: process.execPath });
    const command = await fixture.waitForCommand("start");
    fixture.emit({ type: "owned", id: command.id, pid: 1234, ...message });
    await assert.rejects(start, (error) => error instanceof ProcessOwnershipError && error.stage === "protocol");
    await supervisor.shutdown();
  }
});

test("terminate and shutdown are idempotent and drain active jobs", async () => {
  const fixture = makeFakeHelper();
  fixture.onCommand = (command) => {
    if (command.type === "start") fixture.emit({ type: "owned", id: command.id, pid: 4567 });
    if (command.type === "terminate") fixture.emit({ type: "completed", id: command.id, exitCode: 1, reason: "terminated" });
    if (command.type === "shutdown") fixture.exit(0);
  };
  const supervisor = createJobSupervisor({
    toolRoot: process.cwd(),
    helperPaths: fakePaths(),
    verifyHelper: async () => ({}),
    spawnProcess: () => fixture.child,
  });
  const handle = await supervisor.start({ command: process.execPath });
  const first = handle.terminate();
  const second = handle.terminate();
  assert.deepEqual(await first, await second);
  assert.equal(fixture.commands.filter((value) => value.type === "terminate").length, 1);
  await Promise.all([supervisor.shutdown(), supervisor.shutdown()]);
  assert.equal(supervisor.activeCount, 0);
});

test("helper rejection and helper crash use the unified ownership error", async () => {
  const fixture = makeFakeHelper();
  const supervisor = createJobSupervisor({
    toolRoot: process.cwd(),
    helperPaths: fakePaths(),
    verifyHelper: async () => ({}),
    spawnProcess: () => fixture.child,
  });
  const start = supervisor.start({ command: process.execPath });
  const command = await fixture.waitForCommand("start");
  fixture.emit({ type: "error", id: command.id, stage: "assign", message: "assign failed", win32Error: 5 });
  await assert.rejects(start, (error) =>
    error instanceof ProcessOwnershipError &&
    error.code === "ENTRY_ACTION_PROCESS_OWNERSHIP_UNAVAILABLE" &&
    error.stage === "assign");

  const secondStart = supervisor.start({ command: process.execPath });
  const second = await fixture.waitForCommand("start", 2);
  fixture.emit({ type: "owned", id: second.id, pid: 999 });
  const handle = await secondStart;
  fixture.exit(9);
  await assert.rejects(handle.completion, (error) =>
    error instanceof ProcessOwnershipError &&
    error.code === "ENTRY_ACTION_PROCESS_OWNERSHIP_UNAVAILABLE");
  await supervisor.shutdown();
});

test("stderr capture is bounded", async () => {
  const fixture = makeFakeHelper();
  const supervisor = createJobSupervisor({
    toolRoot: process.cwd(),
    helperPaths: fakePaths(),
    verifyHelper: async () => ({}),
    spawnProcess: () => fixture.child,
    maxStderrBytes: 32,
  });
  const start = supervisor.start({ command: process.execPath });
  await fixture.waitForCommand("start");
  fixture.child.stderr.write("x".repeat(100));
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(Buffer.byteLength(supervisor.stderr) <= 32);
  fixture.exit(1);
  await assert.rejects(start, ProcessOwnershipError);
  await supervisor.shutdown();
});

test("an unresponsive terminate kills the helper and fails the owned completion", async () => {
  const fixture = makeFakeHelper();
  fixture.onCommand = (command) => {
    if (command.type === "start") fixture.emit({ type: "owned", id: command.id, pid: 777 });
  };
  const supervisor = createJobSupervisor({
    toolRoot: process.cwd(),
    helperPaths: fakePaths(),
    verifyHelper: async () => ({}),
    spawnProcess: () => fixture.child,
    terminationTimeoutMs: 20,
  });
  const handle = await supervisor.start({ command: process.execPath });
  await assert.rejects(handle.terminate(), ProcessOwnershipError);
  await assert.rejects(handle.completion, ProcessOwnershipError);
  assert.equal(supervisor.activeCount, 0);
  await supervisor.shutdown();
});

test("start fails within the ownership acknowledgement bound when helper stays silent", async () => {
  const fixture = makeFakeHelper();
  const supervisor = createJobSupervisor({
    toolRoot: process.cwd(),
    helperPaths: fakePaths(),
    verifyHelper: async () => ({}),
    spawnProcess: () => fixture.child,
    ownershipAckTimeoutMs: 20,
    hardKillTimeoutMs: 20,
  });
  const startedAt = Date.now();
  await assert.rejects(
    () => supervisor.start({ command: process.execPath }),
    (error) => error instanceof ProcessOwnershipError && error.stage === "owned",
  );
  assert.ok(Date.now() - startedAt < 500);
  assert.equal(fixture.killCalls, 1);
  assert.equal(supervisor.activeCount, 0);
  await supervisor.shutdown();
});

test("kill false with no exit still settles terminate and detaches after the second hard bound", async () => {
  const fixture = makeFakeHelper({ killNoExit: true });
  fixture.onCommand = (command) => {
    if (command.type === "start") fixture.emit({ type: "owned", id: command.id, pid: 778 });
  };
  const supervisor = createJobSupervisor({
    toolRoot: process.cwd(),
    helperPaths: fakePaths(),
    verifyHelper: async () => ({}),
    spawnProcess: () => fixture.child,
    terminationTimeoutMs: 20,
    hardKillTimeoutMs: 20,
  });
  const handle = await supervisor.start({ command: process.execPath });
  const startedAt = Date.now();
  await assert.rejects(handle.terminate(), ProcessOwnershipError);
  assert.ok(Date.now() - startedAt < 500);
  assert.equal(fixture.killCalls, 1);
  assert.equal(fixture.unrefCalls, 1);
  assert.equal(supervisor.activeCount, 0);
  await supervisor.shutdown();
});

test("shutdown settles after both bounds when kill returns false and helper never exits", async () => {
  const fixture = makeFakeHelper({ killNoExit: true });
  fixture.onCommand = (command) => {
    if (command.type === "start") fixture.emit({ type: "owned", id: command.id, pid: 779 });
    if (command.type === "terminate") fixture.emit({ type: "completed", id: command.id, exitCode: 0 });
  };
  const supervisor = createJobSupervisor({
    toolRoot: process.cwd(),
    helperPaths: fakePaths(),
    verifyHelper: async () => ({}),
    spawnProcess: () => fixture.child,
    shutdownTimeoutMs: 20,
    hardKillTimeoutMs: 20,
  });
  const handle = await supervisor.start({ command: process.execPath });
  fixture.emit({ type: "completed", id: handle.id, exitCode: 0 });
  await handle.completion;
  const startedAt = Date.now();
  await supervisor.shutdown();
  assert.ok(Date.now() - startedAt < 500);
  assert.equal(fixture.killCalls, 1);
  assert.equal(fixture.unrefCalls, 1);
});

test("a timed-out generation cannot contaminate the next helper with late ready, stderr, or exit", async () => {
  const first = makeFakeHelper({ autoReady: false, killNoExit: true });
  const second = makeFakeHelper();
  const fixtures = [first, second];
  const supervisor = createJobSupervisor({
    toolRoot: process.cwd(),
    helperPaths: fakePaths(),
    verifyHelper: async () => ({}),
    spawnProcess: () => fixtures.shift().child,
    startupTimeoutMs: 20,
    hardKillTimeoutMs: 20,
  });
  await assert.rejects(() => supervisor.start({ command: process.execPath }), (error) => error.stage === "startup");

  const nextStart = supervisor.start({ command: process.execPath });
  const command = await second.waitForCommand("start");
  first.emitLate({ type: "ready", protocolVersion: 1, pid: 1 });
  first.emitStderrLate("stale-generation-error");
  first.exit(9);
  second.emit({ type: "owned", id: command.id, pid: 2002 });
  const handle = await nextStart;
  assert.equal(handle.pid, 2002);
  assert.doesNotMatch(supervisor.stderr, /stale-generation-error/);
  second.emit({ type: "completed", id: command.id, exitCode: 0 });
  await handle.completion;
  second.onCommand = (value) => {
    if (value.type === "shutdown") second.exit(0);
  };
  await supervisor.shutdown();
});

test("unsupported platform fails closed without spawning", async () => {
  let spawnCalls = 0;
  const supervisor = createJobSupervisor({
    toolRoot: process.cwd(),
    platform: "linux",
    arch: "x64",
    helperPaths: fakePaths(),
    spawnProcess: () => { spawnCalls += 1; },
  });
  await assert.rejects(
    () => supervisor.start({ command: process.execPath }),
    (error) => error.code === "ENTRY_ACTION_PROCESS_OWNERSHIP_UNAVAILABLE" && error.stage === "verify",
  );
  assert.equal(spawnCalls, 0);
});

function fakePaths() {
  return {
    directory: path.resolve("fake-helper"),
    sourcePath: path.resolve("fake-helper/JobHelper.cs"),
    executablePath: path.resolve("fake-helper/data-editor-job-helper.exe"),
    manifestPath: path.resolve("fake-helper/job-helper.manifest.json"),
  };
}

function makeFakeHelper(options = {}) {
  const child = new EventEmitter();
  child.pid = 8123;
  child.creationFileTime = "133000000000000000";
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  const commands = [];
  const waiters = [];
  let stdinBuffer = "";
  child.stdin = new Writable({
    write(chunk, _encoding, callback) {
      stdinBuffer += chunk.toString();
      for (;;) {
        const newline = stdinBuffer.indexOf("\n");
        if (newline < 0) break;
        const command = JSON.parse(stdinBuffer.slice(0, newline));
        stdinBuffer = stdinBuffer.slice(newline + 1);
        commands.push(command);
        for (const waiter of [...waiters]) waiter();
        fixture.onCommand?.(command);
      }
      callback();
    },
  });
  child.kill = () => {
    fixture.killCalls += 1;
    if (!options.killNoExit) fixture.exit(null, "SIGTERM");
    return !options.killNoExit;
  };
  child.unref = () => {
    fixture.unrefCalls += 1;
  };
  const fixture = {
    child,
    commands,
    onCommand: null,
    killCalls: 0,
    unrefCalls: 0,
    emit(message) {
      const start = commands.findLast((command) => command.type === "start");
      const normalized = message.type === "owned" ? {
        ...message,
        id: message.id ?? start?.id,
        jobInstanceId: message.jobInstanceId ?? start?.jobInstanceId,
        helperPid: message.helperPid ?? child.pid,
        helperCreationFileTime: message.helperCreationFileTime ?? child.creationFileTime,
        creationFileTime: message.creationFileTime ?? "133000000000000001",
      } : message;
      child.stdout.write(`${JSON.stringify(normalized)}\n`);
    },
    emitLate(message) {
      child.stdout.emit("data", `${JSON.stringify(message)}\n`);
    },
    emitStderrLate(value) {
      child.stderr.emit("data", value);
    },
    exit(code, signal = null) {
      child.emit("exit", code, signal);
    },
    async waitForCommand(type, count = 1) {
      while (commands.filter((command) => command.type === type).length < count) {
        await new Promise((resolve) => waiters.push(resolve));
      }
      return commands.filter((command) => command.type === type)[count - 1];
    },
  };
  if (options.autoReady !== false) {
    setImmediate(() => fixture.emit({
      type: "ready",
      protocolVersion: 2,
      pid: child.pid,
      creationFileTime: child.creationFileTime,
    }));
  }
  return fixture;
}
