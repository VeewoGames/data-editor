import test from "node:test";
import assert from "node:assert/strict";
import {
  buildWindowsCommandLine,
  quoteWindowsCommandLineArgument,
  spawnPersistentProcess,
} from "../src/persistent-process.mjs";

test("non-Windows persistent processes use a detached hidden session", async () => {
  const calls = [];
  let unrefCount = 0;
  const child = { pid: 4321, unref: () => { unrefCount += 1; } };

  const result = await spawnPersistentProcess(
    "/usr/local/bin/node",
    ["/workspace/recovery-bridge.mjs", "--port", "8791"],
    { cwd: "/workspace", env: { TEST_VALUE: "yes" } },
    {
      platform: "darwin",
      spawnImpl: (...args) => {
        calls.push(args);
        return child;
      },
    },
  );

  assert.deepEqual(result, { pid: 4321, child });
  assert.equal(unrefCount, 1);
  assert.deepEqual(calls, [[
    "/usr/local/bin/node",
    ["/workspace/recovery-bridge.mjs", "--port", "8791"],
    {
      cwd: "/workspace",
      detached: true,
      env: { TEST_VALUE: "yes" },
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    },
  ]]);
});

test("Windows persistent processes use the hidden WMI broker", async () => {
  const calls = [];
  const result = await spawnPersistentProcess(
    "C:\\Program Files\\nodejs\\node.exe",
    ["C:\\Code\\data editor\\recovery-bridge.mjs", "--project", "C:\\Code\\Nocturnel"],
    { cwd: "C:\\Code\\data editor", env: { SystemRoot: "D:\\Windows", TEST_VALUE: "yes" } },
    {
      platform: "win32",
      execFileImpl: (file, args, options, callback) => {
        calls.push([file, args, options]);
        callback(null, '{"returnValue":0,"processId":9876}\r\n', "");
      },
    },
  );

  assert.deepEqual(result, { pid: 9876, child: null });
  assert.equal(calls.length, 1);
  const [file, args, options] = calls[0];
  assert.equal(file, "D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
  assert.deepEqual(args.slice(0, 4), ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand"]);
  assert.equal(options.windowsHide, true);
  assert.equal(options.env.TEST_VALUE, "yes");

  const script = Buffer.from(args[4], "base64").toString("utf16le");
  assert.match(script, /Win32_ProcessStartup/u);
  assert.match(script, /Win32_Process'\)\.Create/u);
  assert.match(script, /CreateFlags = 1544/u);
  assert.match(script, /EnvironmentVariables/u);
  assert.doesNotMatch(script, /TEST_VALUE/u);
});

test("Windows command-line quoting preserves spaces, quotes, and trailing slashes", () => {
  assert.equal(quoteWindowsCommandLineArgument("plain"), "plain");
  assert.equal(quoteWindowsCommandLineArgument(""), '\"\"');
  assert.equal(quoteWindowsCommandLineArgument("C:\\Program Files\\node.exe"), '\"C:\\Program Files\\node.exe\"');
  assert.equal(quoteWindowsCommandLineArgument('say\"hello'), '\"say\\\"hello\"');
  assert.equal(quoteWindowsCommandLineArgument("C:\\Program Files\\"), '\"C:\\Program Files\\\\\"');
  assert.equal(
    buildWindowsCommandLine("C:\\Program Files\\node.exe", ["C:\\Code\\data editor\\bridge.mjs", "--port", "8791"]),
    '\"C:\\Program Files\\node.exe\" \"C:\\Code\\data editor\\bridge.mjs\" --port 8791',
  );
});

test("Windows broker failures surface the WMI return value", async () => {
  await assert.rejects(
    () => spawnPersistentProcess(
      "C:\\node.exe",
      ["C:\\bridge.mjs"],
      { cwd: "C:\\Code", env: { SystemRoot: "C:\\Windows" } },
      {
        platform: "win32",
        execFileImpl: (_file, _args, _options, callback) => {
          callback(null, '{"returnValue":9,"processId":0}\n', "");
        },
      },
    ),
    /return value 9/u,
  );
});
