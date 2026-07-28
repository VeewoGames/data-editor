import { writeFile } from "node:fs/promises";
import path from "node:path";
import { createJobSupervisor } from "../../src/job-supervisor.mjs";

const [infoPath, pidFile, helperDirectory] = process.argv.slice(2);
const supervisor = createJobSupervisor({
  toolRoot: path.resolve("."),
  helperPaths: {
    directory: helperDirectory,
    sourcePath: path.resolve("native/job-helper/JobHelper.cs"),
    executablePath: path.join(helperDirectory, "data-editor-job-helper.exe"),
    manifestPath: path.join(helperDirectory, "job-helper.manifest.json"),
  },
});
const worker = path.resolve("tests/fixtures/job-tree-worker.mjs");
const handle = await supervisor.start({
  command: process.execPath,
  args: [worker, "--mode=tree", `--pid-file=${pidFile}`],
});
await writeFile(infoPath, JSON.stringify({
  hostPid: process.pid,
  helperPid: supervisor.helperPid,
  rootPid: handle.pid,
}), "utf8");
setInterval(() => {}, 1000);
