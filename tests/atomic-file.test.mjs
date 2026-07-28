import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, open, readFile, readdir, rm, writeFile } from "node:fs/promises";
import {
  atomicReplace,
  atomicWrite,
  defaultAtomicReplaceOptions,
  exclusiveCreateLock,
} from "../src/atomic-file.mjs";

async function makeTempDir(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "data-editor-atomic-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("exclusiveCreateLock writes durable payload and preserves EEXIST", async (t) => {
  const root = await makeTempDir(t);
  const lockPath = path.join(root, "writer.lock");
  await exclusiveCreateLock(lockPath, { owner: "first" });
  assert.deepEqual(JSON.parse(await readFile(lockPath, "utf8")), { owner: "first" });

  await assert.rejects(
    () => exclusiveCreateLock(lockPath, { owner: "second" }),
    (error) => error?.code === "EEXIST",
  );
  assert.deepEqual(JSON.parse(await readFile(lockPath, "utf8")), { owner: "first" });
});

test("exclusiveCreateLock writes, syncs, and closes in order", async () => {
  const events = [];
  await exclusiveCreateLock(path.resolve("writer.lock"), "payload", {
    ops: {
      open: async (_target, flags) => {
        events.push(`open:${flags}`);
        return {
          writeFile: async () => events.push("write"),
          sync: async () => events.push("sync"),
          close: async () => events.push("close"),
        };
      },
      rm: async () => events.push("rm"),
    },
  });
  assert.deepEqual(events, ["open:wx", "write", "sync", "close"]);
});

test("exclusiveCreateLock cleans up only a lock created by the failing call", async (t) => {
  const root = await makeTempDir(t);
  const lockPath = path.join(root, "writer.lock");
  const writeError = Object.assign(new Error("injected write failure"), { code: "EIO" });
  await assert.rejects(
    () => exclusiveCreateLock(lockPath, "payload", {
      ops: {
        async open(target, flags) {
          const handle = await open(target, flags);
          return {
            writeFile: async () => { throw writeError; },
            sync: () => handle.sync(),
            close: () => handle.close(),
          };
        },
      },
    }),
    (error) => error === writeError,
  );
  await assert.rejects(() => readFile(lockPath), (error) => error?.code === "ENOENT");
});

test("exclusiveCreateLock reports primary and cleanup failures without retrying close", async () => {
  const primaryError = Object.assign(new Error("write failed"), { code: "EIO" });
  const closeError = Object.assign(new Error("close cleanup failed"), { code: "EIO" });
  const rmError = Object.assign(new Error("remove cleanup failed"), { code: "EPERM" });
  let closeCalls = 0;
  await assert.rejects(
    () => exclusiveCreateLock(path.resolve("writer.lock"), "payload", {
      ops: {
        open: async () => ({
          writeFile: async () => { throw primaryError; },
          sync: async () => {},
          close: async () => {
            closeCalls += 1;
            throw closeError;
          },
        }),
        rm: async () => { throw rmError; },
      },
    }),
    (error) => {
      assert.equal(error instanceof AggregateError, true);
      assert.equal(error.cause, primaryError);
      assert.equal(error.primaryError, primaryError);
      assert.deepEqual(error.cleanupErrors, [closeError, rmError]);
      assert.deepEqual(error.errors, [primaryError, closeError, rmError]);
      return true;
    },
  );
  assert.equal(closeCalls, 1);
});

test("exclusiveCreateLock preserves EEXIST without cleanup of another owner's lock", async () => {
  const existsError = Object.assign(new Error("already exists"), { code: "EEXIST" });
  let removeCalls = 0;
  await assert.rejects(
    () => exclusiveCreateLock(path.resolve("writer.lock"), "payload", {
      ops: {
        open: async () => { throw existsError; },
        rm: async () => { removeCalls += 1; },
      },
    }),
    (error) => error === existsError,
  );
  assert.equal(removeCalls, 0);
});

test("exclusiveCreateLock does not retry a close that already failed", async () => {
  const closeError = Object.assign(new Error("close failed"), { code: "EIO" });
  let closeCalls = 0;
  await assert.rejects(
    () => exclusiveCreateLock(path.resolve("writer.lock"), "payload", {
      ops: {
        open: async () => ({
          writeFile: async () => {},
          sync: async () => {},
          close: async () => {
            closeCalls += 1;
            throw closeError;
          },
        }),
        rm: async () => {},
      },
    }),
    (error) => error === closeError,
  );
  assert.equal(closeCalls, 1);
});

test("atomicWrite cleans a synced temp file when sync fails and leaves target unchanged", async (t) => {
  const root = await makeTempDir(t);
  const target = path.join(root, "state.json");
  await writeFile(target, "original", "utf8");
  const syncError = Object.assign(new Error("injected sync failure"), { code: "EIO" });
  await assert.rejects(
    () => atomicWrite(target, "replacement", {
      ops: {
        async open(tempPath, flags) {
          const handle = await open(tempPath, flags);
          return {
            writeFile: (...args) => handle.writeFile(...args),
            sync: async () => { throw syncError; },
            close: () => handle.close(),
          };
        },
      },
    }),
    (error) => error === syncError,
  );
  assert.equal(await readFile(target, "utf8"), "original");
  assert.deepEqual(await readdir(root), ["state.json"]);
});

test("atomicWrite cleans its temp file when writing fails and leaves target unchanged", async (t) => {
  const root = await makeTempDir(t);
  const target = path.join(root, "state.json");
  await writeFile(target, "original", "utf8");
  const writeError = Object.assign(new Error("injected write failure"), { code: "EIO" });
  await assert.rejects(
    () => atomicWrite(target, "replacement", {
      ops: {
        async open(tempPath, flags) {
          const handle = await open(tempPath, flags);
          return {
            writeFile: async () => { throw writeError; },
            sync: () => handle.sync(),
            close: () => handle.close(),
          };
        },
      },
    }),
    (error) => error === writeError,
  );
  assert.equal(await readFile(target, "utf8"), "original");
  assert.deepEqual(await readdir(root), ["state.json"]);
});

test("atomicWrite reports primary and cleanup failures without retrying close", async () => {
  const primaryError = Object.assign(new Error("write failed"), { code: "EIO" });
  const closeError = Object.assign(new Error("close cleanup failed"), { code: "EIO" });
  const rmError = Object.assign(new Error("remove cleanup failed"), { code: "EPERM" });
  let closeCalls = 0;
  await assert.rejects(
    () => atomicWrite(path.resolve("state.json"), "replacement", {
      ops: {
        randomUUID: () => "fixed",
        open: async () => ({
          writeFile: async () => { throw primaryError; },
          sync: async () => {},
          close: async () => {
            closeCalls += 1;
            throw closeError;
          },
        }),
        rm: async () => { throw rmError; },
      },
    }),
    (error) => {
      assert.equal(error instanceof AggregateError, true);
      assert.equal(error.cause, primaryError);
      assert.equal(error.primaryError, primaryError);
      assert.deepEqual(error.cleanupErrors, [closeError, rmError]);
      assert.deepEqual(error.errors, [primaryError, closeError, rmError]);
      return true;
    },
  );
  assert.equal(closeCalls, 1);
});

test("atomicWrite does not retry a close that already failed", async () => {
  const closeError = Object.assign(new Error("close failed"), { code: "EIO" });
  let closeCalls = 0;
  await assert.rejects(
    () => atomicWrite(path.resolve("state.json"), "replacement", {
      ops: {
        randomUUID: () => "fixed",
        open: async () => ({
          writeFile: async () => {},
          sync: async () => {},
          close: async () => {
            closeCalls += 1;
            throw closeError;
          },
        }),
        rm: async () => {},
      },
    }),
    (error) => error === closeError,
  );
  assert.equal(closeCalls, 1);
});

test("concurrent atomicWrite calls leave one complete payload and no temp files", async (t) => {
  const root = await makeTempDir(t);
  const target = path.join(root, "state.json");
  const payloads = Array.from({ length: 24 }, (_, index) => JSON.stringify({
    index,
    body: String(index).repeat(4096),
  }));
  await Promise.all(payloads.map((payload) => atomicWrite(target, payload)));
  const finalText = await readFile(target, "utf8");
  assert.equal(payloads.includes(finalText), true);
  assert.deepEqual(await readdir(root), ["state.json"]);
});

test("atomicWrite closes the temp file before rename", async () => {
  const events = [];
  await atomicWrite(path.resolve("state.json"), "payload", {
    ops: {
      randomUUID: () => "fixed",
      open: async () => ({
        writeFile: async () => events.push("write"),
        sync: async () => events.push("sync"),
        close: async () => events.push("close"),
      }),
      rename: async () => events.push("rename"),
      rm: async () => events.push("rm"),
    },
  });
  assert.deepEqual(events, ["write", "sync", "close", "rename"]);
});

test("atomicWrite does not create a missing business directory", async (t) => {
  const root = await makeTempDir(t);
  const missingDirectory = path.join(root, "missing");
  await assert.rejects(
    () => atomicWrite(path.join(missingDirectory, "state.json"), "payload"),
    (error) => error?.code === "ENOENT",
  );
  assert.deepEqual(await readdir(root), []);
});

test("atomicWrite preserves a colliding temp file it did not create", async (t) => {
  const root = await makeTempDir(t);
  const target = path.join(root, "state.json");
  const tempPath = path.join(root, ".data-editor-atomic-fixed.tmp");
  await writeFile(target, "original", "utf8");
  await writeFile(tempPath, "other writer", "utf8");
  await assert.rejects(
    () => atomicWrite(target, "replacement", { ops: { randomUUID: () => "fixed" } }),
    (error) => error?.code === "EEXIST",
  );
  assert.equal(await readFile(target, "utf8"), "original");
  assert.equal(await readFile(tempPath, "utf8"), "other writer");
});

test("atomicWrite replaces a file with a long legal basename without temp-name overflow", async (t) => {
  const root = await makeTempDir(t);
  const target = path.join(root, `${"x".repeat(225)}.json`);
  await writeFile(target, "before", "utf8");
  await atomicWrite(target, "complete replacement");
  assert.equal(await readFile(target, "utf8"), "complete replacement");
  assert.deepEqual(await readdir(root), [path.basename(target)]);
});

test("atomicReplace retries only transient errors within the configured bound", async () => {
  const transient = Object.assign(new Error("busy"), { code: "EBUSY" });
  const events = [];
  let attempts = 0;
  await atomicReplace(path.resolve(".state.tmp"), path.resolve("state.json"), {
    maxRetries: 2,
    retryDelayMs: 3,
    ops: {
      rename: async () => {
        attempts += 1;
        if (attempts < 3) throw transient;
      },
      delay: async (milliseconds) => events.push(milliseconds),
    },
  });
  assert.equal(attempts, 3);
  assert.deepEqual(events, [3, 3]);
  assert.deepEqual(defaultAtomicReplaceOptions, { maxRetries: 20, retryDelayMs: 10 });
});

test("atomicReplace throws the original transient error after retries are exhausted", async () => {
  const firstError = Object.assign(new Error("first busy"), { code: "EPERM" });
  const laterError = Object.assign(new Error("still busy"), { code: "EPERM" });
  let attempts = 0;
  await assert.rejects(
    () => atomicReplace(path.resolve(".state.tmp"), path.resolve("state.json"), {
      maxRetries: 1,
      retryDelayMs: 0,
      ops: {
        rename: async () => {
          attempts += 1;
          throw attempts === 1 ? firstError : laterError;
        },
        delay: async () => {},
      },
    }),
    (error) => error === firstError,
  );
  assert.equal(attempts, 2);
});

for (const errorCode of ["EPERM", "EBUSY"]) {
  test(`atomicWrite preserves target and cleans temp when atomicReplace exhausts ${errorCode}`, async (t) => {
    const root = await makeTempDir(t);
    const target = path.join(root, "state.json");
    await writeFile(target, "original bytes", "utf8");
    const replaceError = Object.assign(new Error(`injected ${errorCode}`), { code: errorCode });
    let renameCalls = 0;
    await assert.rejects(
      () => atomicWrite(target, "replacement bytes", {
        maxRetries: 2,
        retryDelayMs: 0,
        ops: {
          rename: async () => {
            renameCalls += 1;
            throw replaceError;
          },
          delay: async () => {},
        },
      }),
      (error) => error === replaceError,
    );
    assert.equal(renameCalls, 3);
    assert.equal(await readFile(target, "utf8"), "original bytes");
    assert.deepEqual(await readdir(root), ["state.json"]);
  });
}

test("atomicReplace does not retry permanent errors", async () => {
  const permanent = Object.assign(new Error("denied"), { code: "EACCES" });
  let attempts = 0;
  await assert.rejects(
    () => atomicReplace(path.resolve(".state.tmp"), path.resolve("state.json"), {
      ops: {
        rename: async () => {
          attempts += 1;
          throw permanent;
        },
        delay: async () => assert.fail("permanent failures must not wait"),
      },
    }),
    (error) => error === permanent,
  );
  assert.equal(attempts, 1);
});

test("atomicReplace rejects cross-directory replacement before rename", async () => {
  let attempts = 0;
  await assert.rejects(
    () => atomicReplace(path.resolve("source", "state.tmp"), path.resolve("target", "state.json"), {
      ops: { rename: async () => { attempts += 1; } },
    }),
    /same directory and volume/,
  );
  assert.equal(attempts, 0);
});

test("atomicWrite replaces an existing file through the real filesystem", { skip: process.platform !== "win32" }, async (t) => {
  const root = await makeTempDir(t);
  const target = path.join(root, "state.json");
  await writeFile(target, "before", "utf8");
  await atomicWrite(target, "after");
  assert.equal(await readFile(target, "utf8"), "after");
  assert.deepEqual(await readdir(root), ["state.json"]);
});
